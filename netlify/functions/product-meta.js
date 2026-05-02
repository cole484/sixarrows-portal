// netlify/functions/product-meta.js
// Fetches Open Graph + JSON-LD metadata for a product URL pasted into
// the selections app, used by the Design Book to render images.
//
// GET    /?url=ENCODED_URL                  → cached (or fresh) metadata
// POST   /?refresh=1   body { urls: [...] } → bulk fetch fresh, ignore cache
// DELETE /?clientUrls=1 body { urls: [...] }→ invalidate cache for these URLs
//
// Response shape:
//   { url, urlHash, retailer, title, image, price, priceCurrency, error,
//     fetchedAt, cached }
//
// Cache TTL: 7 days (rows older than that get re-fetched on read).
// Schema: see supabase/add-product-meta.sql.

import { respond, corsHeaders } from './lib/supabase-client.js';
import { createHash } from 'node:crypto';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const ML_KEY = () => process.env.MICROLINK_API_KEY || '';   // optional — works unauthenticated too
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
  };
}

// Normalize a URL so the same product on the same retailer maps to one
// cache row regardless of tracking params. Strips utm_*, gclid, gad_*,
// gbraid, fbclid, msclkid, mc_cid, mc_eid, _bta_*, ref, srsltid params.
const TRACKING_PARAMS = new Set([
  'gclid','gclsrc','gbraid','wbraid','gad_source','gad_campaignid',
  'fbclid','msclkid','mc_cid','mc_eid','_bta_c','_bta_tid',
  'ref','ref_','ref_src','referrer','source','srsltid',
  'cm_mmc','mtc','fp','utm_source','utm_medium','utm_campaign',
  'utm_term','utm_content','utm_id','spm','spreadType',
]);
function canonicalize(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // Remove tracking params + any utm_*
    const keep = [];
    for (const [k, v] of u.searchParams.entries()) {
      const lk = k.toLowerCase();
      if (TRACKING_PARAMS.has(lk)) continue;
      if (lk.startsWith('utm_')) continue;
      keep.push([k, v]);
    }
    u.search = '';
    keep.forEach(([k, v]) => u.searchParams.append(k, v));
    u.hash = '';
    return u.toString();
  } catch (e) { return rawUrl; }
}
function hashUrl(url) {
  return createHash('sha256').update(url.toLowerCase()).digest('hex');
}
function inferRetailer(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const map = {
      'lowes.com':       'Lowe’s',
      'homedepot.com':   'The Home Depot',
      'menards.com':     'Menards',
      'fergusonhome.com':'Ferguson Home',
      'shop.moen.com':   'Moen',
      'moen.com':        'Moen',
      'amazon.com':      'Amazon',
      'wayfair.com':     'Wayfair',
      'build.com':       'Build.com',
      'amerisink.com':   'AmeriSink',
      'kohler.com':      'Kohler',
      'delta.com':       'Delta',
      'deltafaucet.com': 'Delta Faucet',
      'overstock.com':   'Overstock',
    };
    if (map[host]) return map[host];
    // Fall back to capitalized hostname (strip TLD)
    const base = host.split('.').slice(0, -1).join('.') || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return ''; }
}

// ── HTML parsing ────────────────────────────────────────────────────────
function pickAttr(html, regex) {
  const m = html.match(regex);
  return m ? decodeHtmlEntities(m[1].trim()) : '';
}
function decodeHtmlEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&apos;/g, '\'')
    .replace(/&#x27;/g, '\'').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseOG(html) {
  // Open Graph tags: <meta property="og:image" content="..."> (also accept name=)
  const get = key => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
            || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i');
    let m = html.match(re);
    if (m) return decodeHtmlEntities(m[1].trim());
    // Try reversed attribute order
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i');
    m = html.match(re2);
    return m ? decodeHtmlEntities(m[1].trim()) : '';
  };
  return {
    image:    get('og:image:secure_url') || get('og:image'),
    title:    get('og:title'),
    siteName: get('og:site_name'),
  };
}

function parseTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim().replace(/\s+/g, ' ')) : '';
}

// Pull JSON-LD product blobs and extract first product image / price
function parseJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1].trim();
      if (!raw) continue;
      const obj = JSON.parse(raw);
      blocks.push(obj);
    } catch (e) { /* malformed JSON-LD, skip */ }
  }

  function walk(node) {
    if (!node) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = walk(n);
        if (r) return r;
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    const t = node['@type'];
    const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'));
    if (isProduct) return node;
    // Recurse into common containers (graphs, mainEntity, etc.)
    if (node['@graph']) return walk(node['@graph']);
    for (const k of ['mainEntity', 'item', 'itemListElement']) {
      if (node[k]) {
        const r = walk(node[k]);
        if (r) return r;
      }
    }
    return null;
  }

  for (const b of blocks) {
    const product = walk(b);
    if (!product) continue;
    const offers = product.offers || (product.aggregateOffer) || null;
    const offer = Array.isArray(offers) ? offers[0] : offers;
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    const price = offer && (offer.price || offer.lowPrice || offer.highPrice);
    return {
      title:         (product.name || '').toString(),
      image:         (image || '').toString(),
      price:         price !== undefined && price !== null && price !== '' ? Number(price) : null,
      priceCurrency: (offer && offer.priceCurrency) || 'USD',
    };
  }
  return null;
}

function absolutizeUrl(maybeRelative, baseUrl) {
  if (!maybeRelative) return '';
  try { return new URL(maybeRelative, baseUrl).toString(); } catch { return maybeRelative; }
}

// ── Fetch + parse a URL ─────────────────────────────────────────────────
async function fetchMetadata(canonicalUrl) {
  const headers = {
    // Identify as a real browser; many CDNs return short payloads to bots
    'User-Agent':       'Mozilla/5.0 (compatible; SixArrowsPortalBot/1.0; +https://sixarrowsconstruction.com)',
    'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':  'en-US,en;q=0.9',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(canonicalUrl, { headers, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  // Read up to ~600KB to keep things fast (most heads with metadata are <50KB)
  const reader = res.body?.getReader();
  let html = '';
  if (reader) {
    const decoder = new TextDecoder('utf-8');
    let total = 0;
    const max = 600 * 1024;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      html += decoder.decode(value, { stream: true });
      if (total >= max) { try { reader.cancel(); } catch {}; break; }
    }
  } else {
    html = await res.text();
  }

  const og = parseOG(html);
  const ld = parseJsonLd(html);
  const titleFallback = parseTitleTag(html);

  const title = (ld && ld.title) || og.title || titleFallback || '';
  const image = absolutizeUrl((ld && ld.image) || og.image, canonicalUrl);
  const price = ld && Number.isFinite(ld.price) ? ld.price : null;
  const priceCurrency = (ld && ld.priceCurrency) || (price ? 'USD' : '');
  const retailer = inferRetailer(canonicalUrl) || og.siteName || '';

  if (!image && !title && !price) throw new Error('No metadata found');

  return { title, image, price, priceCurrency, retailer };
}

// ── Microlink fallback ──────────────────────────────────────────────────
// Used when the direct fetch is blocked (Lowe's, Home Depot, etc. return
// 403) or when the page doesn't expose OG/JSON-LD in the form we expect
// (Menards, Ferguson). Microlink runs a real headless browser server-side
// and is whitelisted by every big-box retailer for link-preview use.
//
// Works unauthenticated (~50/day shared rate limit) or with an API key
// (50/day per key on free, 1k/day on paid). The function uses the key
// when MICROLINK_API_KEY env var is set, otherwise falls back to anon.
async function microlinkFetch(targetUrl) {
  const params = new URLSearchParams({ url: targetUrl, audio: 'false', video: 'false' });
  const headers = { 'Accept': 'application/json' };
  const apiKey = ML_KEY();
  if (apiKey) headers['x-api-key'] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  let res;
  try {
    res = await fetch(`https://api.microlink.io/?${params.toString()}`, { headers, signal: controller.signal });
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Microlink ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  if (j.status !== 'success' || !j.data) {
    throw new Error('Microlink ' + (j.status || 'no data'));
  }
  const d = j.data;
  // Microlink can return image as a string or an object with .url
  const imgRaw = d.image;
  const image = typeof imgRaw === 'string' ? imgRaw : (imgRaw && imgRaw.url) || '';
  const title = d.title || '';
  // Microlink's price extraction is best-effort
  const priceRaw = d.price;
  const price = typeof priceRaw === 'number' ? priceRaw
              : typeof priceRaw === 'string' ? parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || null
              : null;
  return {
    title,
    image,
    price,
    priceCurrency: d.currency || (price ? 'USD' : ''),
    retailer:      d.publisher || inferRetailer(targetUrl) || '',
  };
}

// ── Cache I/O ───────────────────────────────────────────────────────────
async function getCached(urlHash) {
  const url = `${SB_URL()}/rest/v1/product_meta?url_hash=eq.${urlHash}&select=*`;
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] || null;
}
async function upsertCache(row) {
  const url = `${SB_URL()}/rest/v1/product_meta?on_conflict=url_hash`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('product_meta upsert failed:', r.status, t);
  }
}
async function deleteCacheRows(hashes) {
  if (!hashes.length) return;
  const inList = hashes.map(h => `"${h}"`).join(',');
  const url = `${SB_URL()}/rest/v1/product_meta?url_hash=in.(${inList})`;
  await fetch(url, { method: 'DELETE', headers: sbHeaders() });
}

function shapeResponse(row, cached) {
  return {
    url:           row.url,
    urlHash:       row.url_hash,
    retailer:      row.retailer || '',
    title:         row.title    || '',
    image:         row.image    || '',
    price:         row.price ?? null,
    priceCurrency: row.price_currency || '',
    error:         row.error    || '',
    fetchedAt:     row.fetched_at || null,
    cached,
  };
}

async function getOrFetch(rawUrl, forceFresh) {
  const url      = canonicalize(rawUrl);
  const urlHash  = hashUrl(url);
  const retailer = inferRetailer(url);

  if (!forceFresh) {
    const existing = await getCached(urlHash);
    if (existing) {
      const fresh = existing.fetched_at && (Date.now() - new Date(existing.fetched_at).getTime() < TTL_MS);
      if (fresh) return shapeResponse(existing, true);
    }
  }

  // Fetch fresh: try direct first, then fall back to Microlink for big-box
  // retailers that block server fetches or JS-render their metadata.
  let meta = null;
  let directErr = '';
  try {
    meta = await fetchMetadata(url);
  } catch (e) {
    directErr = (e && e.message) ? e.message : 'direct fetch failed';
  }

  // Retry via Microlink when direct failed OR returned no usable image
  if (!meta || !meta.image) {
    try {
      const ml = await microlinkFetch(url);
      // Prefer Microlink result only if it actually got something useful
      if (ml.image || ml.title) {
        meta = {
          title:         ml.title         || (meta && meta.title)         || '',
          image:         ml.image         || (meta && meta.image)         || '',
          price:         (ml.price ?? null) ?? (meta && meta.price ?? null),
          priceCurrency: ml.priceCurrency || (meta && meta.priceCurrency) || '',
          retailer:      ml.retailer      || (meta && meta.retailer)      || retailer,
        };
      }
    } catch (e) {
      // If both paths failed, surface the more informative error
      if (!meta) directErr = `${directErr || 'no direct metadata'}; microlink: ${e.message || 'failed'}`;
    }
  }

  const result = meta ? {
    url_hash:       urlHash,
    url,
    retailer:       meta.retailer || retailer,
    title:          meta.title    || '',
    image:          meta.image    || '',
    price:          meta.price ?? null,
    price_currency: meta.priceCurrency || '',
    error:          (!meta.image && !meta.title) ? (directErr || 'no metadata') : '',
    fetched_at:     new Date().toISOString(),
  } : {
    url_hash:       urlHash,
    url,
    retailer,
    title:          '',
    image:          '',
    price:          null,
    price_currency: '',
    error:          directErr.slice(0, 240) || 'fetch failed',
    fetched_at:     new Date().toISOString(),
  };

  await upsertCache(result);
  return shapeResponse(result, false);
}

// ── Handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (!SB_URL() || !SB_KEY()) {
    return respond(503, { error: 'Supabase not configured' });
  }

  try {
    const qs = event.queryStringParameters || {};

    // ── DELETE: invalidate cache for a list of URLs (admin "refresh") ────
    if (event.httpMethod === 'DELETE' || qs.invalidate === '1') {
      const body  = JSON.parse(event.body || '{}');
      const urls  = Array.isArray(body.urls) ? body.urls : [];
      const hashes = urls.map(u => hashUrl(canonicalize(u)));
      await deleteCacheRows(hashes);
      return respond(200, { invalidated: hashes.length });
    }

    // ── POST: bulk fetch (admin "refresh now") ───────────────────────────
    if (event.httpMethod === 'POST') {
      const body  = JSON.parse(event.body || '{}');
      const urls  = Array.isArray(body.urls) ? body.urls : [];
      const force = qs.refresh === '1' || body.refresh === true;
      // Cap at 50 per request to stay under Netlify's 10s function timeout
      const slice = urls.slice(0, 50);
      const results = await Promise.all(slice.map(u => getOrFetch(u, force)
        .catch(err => ({ url: u, error: err.message || 'fetch failed' }))));
      return respond(200, { count: results.length, results });
    }

    // ── GET: single URL ──────────────────────────────────────────────────
    const url = qs.url;
    if (!url) return respond(400, { error: 'url required' });
    const force = qs.refresh === '1';
    const result = await getOrFetch(url, force);
    return respond(200, result);
  } catch (e) {
    console.error('product-meta error:', e);
    return respond(500, { error: e.message });
  }
};
