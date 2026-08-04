// netlify/functions/plan-convert-background.js
//
// Converts an uploaded plan PDF to PNG, one plan row per page.
//
// This is a Netlify background function. The -background suffix is what
// gives it a 15 minute budget instead of the 10 second synchronous
// limit, and it is required here: a 24x36 architectural sheet at print
// resolution is not a 10 second rasterize. The caller gets an immediate
// 202 and the editor polls the plan row until status flips to ready.
//
// POST body: { clientKey, planId, sourceUrl, label, planType }
//
// planId is the row the browser already created with status =
// 'converting' for page 1. Any further pages get their own rows.

import * as mupdf from 'mupdf';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

// Long edge of the rendered PNG. Big enough to zoom into a dimension
// string on a full sheet, small enough to stay a reasonable download.
const TARGET_LONG_EDGE = 3600;
const MAX_PAGES = 25;

function sbHeaders(extra = {}) {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    ...extra,
  };
}

async function patchPlan(planId, fields) {
  const res = await fetch(
    `${SB_URL()}/rest/v1/plans?id=eq.${encodeURIComponent(planId)}`,
    {
      method: 'PATCH',
      headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
      body: JSON.stringify(fields),
    }
  );
  if (!res.ok) console.error('patchPlan failed:', res.status, await res.text());
}

async function insertPlan(row) {
  const res = await fetch(`${SB_URL()}/rest/v1/plans`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error('insertPlan failed:', res.status, await res.text());
    return null;
  }
  const rows = await res.json();
  return rows?.[0] || null;
}

async function uploadPng(path, bytes) {
  const res = await fetch(`${SB_URL()}/storage/v1/object/plans/${path}`, {
    method: 'POST',
    headers: sbHeaders({ 'Content-Type': 'image/png', 'x-upsert': 'true' }),
    body: bytes,
  });
  if (!res.ok) throw new Error(`Storage upload ${path}: ${res.status} ${await res.text()}`);
  return `${SB_URL()}/storage/v1/object/public/plans/${path}`;
}

// Render one page at a scale that puts its long edge near the target.
// mupdf works in points at 72 per inch, so the scale factor is just the
// ratio of the pixel target to the page's point size.
function renderPage(doc, pageIndex) {
  const page = doc.loadPage(pageIndex);
  const bounds = page.getBounds();
  const wPt = bounds[2] - bounds[0];
  const hPt = bounds[3] - bounds[1];
  const longPt = Math.max(wPt, hPt);

  // Clamp so a small page is not blown up into a blurry giant and a
  // huge page does not blow past what a browser will happily decode.
  const scale = Math.max(1, Math.min(6, TARGET_LONG_EDGE / (longPt || 1)));

  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false,  // no alpha, plans are opaque line art
    true    // render annotations, some sheets carry markup
  );
  const png = pixmap.asPNG();
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();

  // mupdf holds native memory until these are dropped.
  pixmap.destroy();
  page.destroy();

  return { png, width, height };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { clientKey, planId, sourceUrl, label, planType } = payload;
  if (!clientKey || !planId || !sourceUrl) {
    return { statusCode: 400, body: 'clientKey, planId and sourceUrl required' };
  }

  try {
    const srcRes = await fetch(sourceUrl);
    if (!srcRes.ok) throw new Error(`Could not fetch source PDF: ${srcRes.status}`);
    const buf = new Uint8Array(await srcRes.arrayBuffer());

    const doc = mupdf.Document.openDocument(buf, 'application/pdf');
    const pageCount = Math.min(doc.countPages(), MAX_PAGES);
    if (pageCount < 1) throw new Error('PDF has no pages');

    const baseLabel = label || 'Plan';

    for (let i = 0; i < pageCount; i++) {
      const { png, width, height } = renderPage(doc, i);
      const path = `${clientKey}/${planId}-p${i + 1}.png`;
      const imageUrl = await uploadPng(path, png);

      const pageLabel = pageCount > 1 ? `${baseLabel} Sheet ${i + 1}` : baseLabel;

      if (i === 0) {
        // Page 1 fills in the row the browser already created, so the
        // editor's poll resolves against the id it is watching.
        await patchPlan(planId, {
          image_url: imageUrl,
          image_width: width,
          image_height: height,
          label: pageLabel,
          page: 1,
          status: 'ready',
          error: '',
        });
      } else {
        await insertPlan({
          client_id: clientKey,
          plan_type: planType || 'floor',
          label: pageLabel,
          image_url: imageUrl,
          source_url: sourceUrl,
          page: i + 1,
          image_width: width,
          image_height: height,
          status: 'ready',
          sort_order: i,
        });
      }
    }

    if (doc.countPages() > MAX_PAGES) {
      console.warn(`PDF had ${doc.countPages()} pages, converted first ${MAX_PAGES}`);
    }

    return { statusCode: 200, body: JSON.stringify({ pages: pageCount }) };
  } catch (err) {
    console.error('plan-convert error:', err.message);
    // Write the failure onto the row so the editor can stop polling and
    // show staff what went wrong instead of spinning forever.
    await patchPlan(planId, { status: 'failed', error: String(err.message).slice(0, 400) });
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
