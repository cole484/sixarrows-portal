// netlify/functions/quote-lookup.js
//
// Answers one question for a project: which of these subcontractors have
// already given us a price, what is it, and is it still good?
//
// This is the thing that decides whether a quote request goes out at all. Cole:
// on most of these projects we have received quotes already, and they are in
// the client's Drive folder. Sending a quote request to somebody who quoted the
// job in March is not automation, it is a system that does not know what the
// company knows.
//
//   GET /?project=Johnson              read from the cache only, report
//   GET /?project=Johnson&read=6       also open up to 6 unread quotes
//   GET /?project=Johnson&sub=goodnight   narrow the work, not just the printout
//   GET /?project=Johnson&force=1&read=3  re-read, ignoring the cache
//   GET /?format=text                  plain text instead of JSON
//
// Reading is opt-in and capped, same as the compliance sweep, because opening a
// document takes seconds and this function answers an HTTP request. A run with
// read= unset costs one Drive listing and one Supabase query however many
// quotes are on file.

import {
  folderForProject, listQuoteFiles, groupQuotesBySub, readQuoteFile,
  quoteState, PROJECT_FOLDERS,
} from './lib/quote-docs.js';
import { loadCacheIndex } from './lib/doc-cache.js';
import { setReadBudget, readsUsed, anthropicConfigured } from './lib/doc-ai.js';
import { corsHeaders } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const SUBS_DB_ID     = '1944737b-ea6f-8086-8f45-f6b479ed36bb';

const DEFAULT_BUDGET_MS = 20000;

function nHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function prop(page, name) {
  const p = page?.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':     return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'rich_text': return p.rich_text?.map(t => t.plain_text).join('').trim() || null;
    case 'select':    return p.select?.name || null;
    case 'email':     return p.email || null;
    default:          return null;
  }
}

async function nQueryAll(dbId, token) {
  const all = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST', headers: nHeaders(token), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion query ${dbId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    all.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return all;
}

const money = v => (typeof v === 'number' ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'no price read');

function renderText(report) {
  const L = [];
  L.push(`QUOTES ON FILE  ${report.project}`);
  L.push(report.generatedAt);
  L.push('');
  L.push(`${report.filesInFolder} documents in the project folder, ${report.matched} matched to a subcontractor, ${report.unmatched.length} matched to nobody.`);
  if (report.read) L.push(`${report.read} opened this run.`);
  if (report.truncated) L.push('Stopped early on the time budget. Run again to continue.');
  L.push('');

  const order = { current: 0, stale: 1, unread: 2, none: 3 };
  const rows = [...report.subs].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.sub.localeCompare(b.sub));

  for (const r of rows) {
    if (r.state === 'none') continue;
    L.push(`${r.sub}`);
    L.push(`  ${r.state.toUpperCase()}  ${money(r.total)}   ${r.file || ''}`);
    L.push(`  ${r.reason}`);
    if (r.coversWholeScope === false && r.pricedSeparately?.length) {
      L.push('  Not the whole job. Priced separately:');
      for (const x of r.pricedSeparately) L.push(`    - ${x}`);
    }
    if (r.exclusions?.length) {
      L.push('  Excluded:');
      for (const x of r.exclusions) L.push(`    - ${x}`);
    }
    if (r.alternates?.length) {
      L.push(`  Also on file: ${r.alternates.map(a => `${a.file} (${money(a.total)})`).join(', ')}`);
    }
    L.push('');
  }

  const none = rows.filter(r => r.state === 'none');
  if (none.length) {
    L.push('NO QUOTE ON FILE');
    L.push('A quote request is the right first move for these.');
    for (const r of none) L.push(`  ${r.sub}`);
    L.push('');
  }

  if (report.unmatched.length) {
    L.push('MATCHED NO SUBCONTRACTOR');
    L.push('A price we hold from somebody who is not in the Subcontractors database, or whose');
    L.push('name there does not resemble the filename.');
    for (const f of report.unmatched) L.push(`  ${f.name}   (read as "${f.vendor}")`);
  }

  return L.join('\n');
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };

  const q        = event.queryStringParameters || {};
  const project  = q.project || 'Johnson';
  const focus    = (q.sub || '').toLowerCase().trim();
  const readCap  = Math.max(0, Number(q.read) || 0);
  const force    = q.force === '1';
  const budgetMs = Math.max(3000, Number(q.budgetMs) || DEFAULT_BUDGET_MS);
  const asText   = q.format === 'text';

  const token = process.env.NOTION_TOKEN;
  const gKey  = process.env.GOOGLE_API_KEY;

  const reply = (code, body) => ({
    statusCode: code,
    headers: {
      ...corsHeaders(),
      'Content-Type': asText ? 'text/plain; charset=utf-8' : 'application/json',
    },
    body: asText && typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  });

  if (!token) return reply(500, { error: 'NOTION_TOKEN is not set.' });
  if (!gKey)  return reply(500, { error: 'GOOGLE_API_KEY is not set.' });

  const folder = folderForProject(project);
  if (!folder) {
    return reply(400, {
      error: `No Drive folder is mapped for project "${project}".`,
      known: Object.keys(PROJECT_FOLDERS),
      fix: 'Add it to PROJECT_FOLDERS in netlify/functions/lib/quote-docs.js.',
    });
  }

  // Reading is capped per run and the cap is reset here rather than trusted to
  // start at zero, because module state survives a warm container.
  setReadBudget(readCap);
  const started = Date.now();

  try {
    const [subPages, files, cacheRes] = await Promise.all([
      nQueryAll(SUBS_DB_ID, token),
      listQuoteFiles(folder, gKey),
      loadCacheIndex(),
    ]);

    const subs = subPages
      .map(p => ({ id: p.id, name: prop(p, 'Subcontractor Name'), status: prop(p, 'Status') }))
      .filter(s => s.name);

    const { bySub, unmatched } = groupQuotesBySub(files, subs, project);

    // A focus narrows the work rather than the printout. Narrowing only what
    // gets rendered is how a check on one subcontractor quietly opened
    // documents for seventy others.
    const targets = subs.filter(s => !focus || s.name.toLowerCase().includes(focus));

    const rows = [];
    let truncated = false;

    for (const sub of targets) {
      const list = bySub.get(sub.id) || [];
      if (!list.length) {
        rows.push({ sub: sub.name, subId: sub.id, state: 'none', reason: quoteState(null).reason, file: null, total: null });
        continue;
      }

      if (Date.now() - started > budgetMs) { truncated = true; break; }

      const reads = [];
      for (const f of list.slice(0, 4)) {
        reads.push(await readQuoteFile(f, gKey, { cache: cacheRes.index, cacheOnly: readCap === 0, force }));
      }

      const best = reads[0];
      const { state, reason } = quoteState(best);
      rows.push({
        sub: sub.name, subId: sub.id,
        state, reason,
        file: best.file,
        total: best.total ?? null,
        coversWholeScope: best.coversWholeScope ?? null,
        quoteDate: best.quoteDate || null,
        validUntil: best.validUntil || null,
        validityText: best.validityText || null,
        scope: best.scope || null,
        pricedSeparately: best.pricedSeparately || [],
        exclusions: best.exclusions || [],
        lineItems: best.lineItems || [],
        confidence: best.confidence || 'none',
        error: best.error || null,
        alternates: reads.slice(1).map(r => ({ file: r.file, total: r.total ?? null })),
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      project,
      folder,
      filesInFolder: files.length,
      matched: [...bySub.values()].reduce((n, l) => n + l.length, 0),
      subsWithQuote: rows.filter(r => r.state !== 'none').length,
      read: readsUsed(),
      readCap,
      truncated,
      elapsedMs: Date.now() - started,
      readerConfigured: anthropicConfigured(),
      cacheError: cacheRes.error || null,
      subs: rows,
      unmatched: unmatched.map(f => ({ name: f.name, vendor: f.vendor, modifiedTime: f.modifiedTime })),
    };

    return reply(200, asText ? renderText(report) : report);
  } catch (err) {
    console.error('quote-lookup failed:', err.message);
    return reply(500, { error: err.message });
  }
};
