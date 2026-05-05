// netlify/functions/product-meta.js
// Fetches Open Graph + JSON-LD metadata for a product URL pasted into
// the selections app, used by the Design Book to render images.
//
// URL-based:
//   GET    /?url=ENCODED_URL                       → cached or fresh metadata
//   POST   /?refresh=1     body { urls:[...] }    → bulk fetch fresh
//   POST   /?invalidate=1  body { urls:[...] }    → wipe cache for those URLs
//   DELETE                  body { urls:[...] }    → same as invalidate
//
// Text-based (for plain-text products with no URL):
//   GET   /?text=PRODUCT_DESCRIPTION&hint=cat     → image search via Brave
//   POST  body { texts:[{ key, text, hint }] }    → bulk text search
//
// Resolution cascade for URLs (each step's result is cached):
//   1. Direct fetch (Open Graph + JSON-LD)
//   2. Microlink fallback (handles antibot — needs PRO for Lowe's etc.)
//   3. Wayback Machine (Internet Archive snapshot if URL is dead/blocked)
//
// Resolution for text:
//   Brave Image Search API → first result thumbnail
//
// Cache TTL: 7 days. Schema: see supabase/add-product-meta.sql.

import { respond, corsHeaders } from './lib/supabase-client.js';
import { createHash } from 'node:crypto';

const SB_URL  = () => process.env.SUPABASE_URL;
const SB_KEY  = () => process.env.SUPABASE_ANON_KEY;
const ML_KEY  = () => process.env.MICROLINK_API_KEY    || '';
const BR_KEY  = () => process.env.BRAVE_SEARCH_API_KEY || '';
const AI_KEY  = () => process.env.ANTHROPIC_API_KEY    || '';
const TTL_MS  = 7 * 24 * 60 * 60 * 1000;

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

// Extract a clean human-readable product name from a retailer URL slug.
// Lowe's, Home Depot, Wayfair etc. all bake the product name into the
// URL path, so we can recover a usable search query even when the page
// itself blocks our scraper.
//
//   /pd/Project-Source-Pro-Flush-White-Toilet/5006032715
//      → "Project Source Pro Flush White Toilet"
//   /p/Delta-Classic-500-Tile-Bathtub-Kit/338165855
//      → "Delta Classic 500 Tile Bathtub Kit"
function extractQueryFromUrl(url) {
  try {
    const u = new URL(url);
    // Pick the longest hyphenated path segment — that's almost always
    // the product slug, not the category or numeric ID
    const segs = u.pathname.split('/').filter(Boolean);
    let best = '';
    for (const s of segs) {
      // Skip pure numbers (item IDs, SKUs) and very short bits
      if (/^\d+$/.test(s)) continue;
      if (s.length < 8) continue;
      // Slug-like has multiple hyphens or underscores
      if (!/[-_]/.test(s)) continue;
      if (s.length > best.length) best = s;
    }
    if (!best) return '';
    // Convert to space-separated, strip extension-y noise
    return best
      .replace(/\.html?$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch { return ''; }
}

function buildErrorString(errs) {
  if (!errs.length) return '';
  // Most informative line is usually the last attempted fallback's reason
  return errs.map(e => `${e.step}: ${e.msg}`).join(' · ').slice(0, 220);
}

// ── Wayback Machine fallback ────────────────────────────────────────────
// Internet Archive saves snapshots of nearly every product page from
// every major retailer. When the live page returns 4xx or no metadata,
// we ask Wayback for the closest snapshot URL, then run our standard
// scraper against the archived HTML. Free, no API key, no antibot
// because the archive is just static HTML.
async function waybackFetch(targetUrl) {
  // Step 1: ask Wayback if it has a snapshot
  const lookupUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(targetUrl)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let snapshotUrl = '';
  try {
    const res = await fetch(lookupUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`Wayback lookup ${res.status}`);
    const j = await res.json();
    snapshotUrl = j?.archived_snapshots?.closest?.url || '';
  } finally { clearTimeout(timer); }
  if (!snapshotUrl) throw new Error('No Wayback snapshot available');

  // Step 2: scrape the archived page same way we'd scrape a live one.
  // Wayback rewrites internal links so OG tags point at archived URLs;
  // that's fine — they still resolve to images via the Wayback CDN.
  const archived = await fetchMetadata(snapshotUrl);
  // Annotate retailer so admins can see this came from Wayback
  return { ...archived, retailer: (archived.retailer || inferRetailer(targetUrl)) + ' (archived)' };
}

// ── Brave Image Search ──────────────────────────────────────────────────
// Used as the primary path for plain-text products (no URL pasted) and
// as a last resort when both direct + Microlink + Wayback fail. Free
// tier of Brave Search API: 2000 queries/month with API key.
async function braveImageSearch(query) {
  const key = BR_KEY();
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY not set');
  const params = new URLSearchParams({ q: query, count: '5', safesearch: 'strict' });
  const url = `https://api.search.brave.com/res/v1/images/search?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept':              'application/json',
        'Accept-Encoding':     'gzip',
        'X-Subscription-Token': key,
      },
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  const first = (j.results || [])[0];
  if (!first) throw new Error('Brave returned no results');
  // Brave's response has thumbnail and properties.url for the original
  const image    = first.properties?.url || first.thumbnail?.src || '';
  const title    = first.title    || query;
  const retailer = first.source   || (first.url ? new URL(first.url).hostname.replace(/^www\./,'') : 'Brave search');
  if (!image) throw new Error('Brave result had no image URL');
  return {
    title,
    image,
    price: null,
    priceCurrency: '',
    retailer,
    sourceUrl: first.url || '',
  };
}

// ── Claude query polish ─────────────────────────────────────────────────
// Optional preprocessing for image search queries. Takes raw selection
// text like "GE Standard Depth 24.8 cu ft 3 door 33\" wide Model GNE25JYKFS"
// and returns "GE GNE25JYKFS refrigerator" — short, search-engine-friendly.
// Uses Haiku because it's fast and cheap (~$0.001 per call). Caller can
// skip this if ANTHROPIC_API_KEY isn't set.
async function polishQueryWithClaude(rawText, hint) {
  const key = AI_KEY();
  if (!key) return rawText;
  const ctx = hint ? ` (category: ${hint})` : '';
  const prompt = `Convert this construction product description into a short image-search query that will return a clean product photo. Output ONLY the query string, nothing else. Keep brand and model number when present. 6 words max.

Description${ctx}: ${rawText}

Query:`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          key,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 60,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return rawText;
    const j = await res.json();
    const out = (j.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    return out || rawText;
  } catch (e) {
    return rawText;   // fail open, just use the raw text
  } finally { clearTimeout(timer); }
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

  // Fetch fresh: cascade through direct → Microlink → Wayback → Brave (via slug).
  // Track each step's failure separately so the final error message can
  // surface the most informative reason without runaway concatenation.
  let meta = null;
  const errs = [];
  try {
    meta = await fetchMetadata(url);
  } catch (e) {
    errs.push({ step: 'direct',  msg: (e && e.message) ? e.message.slice(0, 120) : 'failed' });
  }

  // Microlink fallback — handles antibot retailers ON PAID PRO TIER.
  // On free tier most big-box retailers still fail with "EPROXYNEEDED".
  if (!meta || !meta.image) {
    try {
      const ml = await microlinkFetch(url);
      if (ml.image || ml.title) {
        const directPrice = (meta && meta.price !== undefined) ? meta.price : null;
        meta = {
          title:         ml.title         || (meta && meta.title)         || '',
          image:         ml.image         || (meta && meta.image)         || '',
          price:         ml.price ?? directPrice,
          priceCurrency: ml.priceCurrency || (meta && meta.priceCurrency) || '',
          retailer:      ml.retailer      || (meta && meta.retailer)      || retailer,
        };
      }
    } catch (e) {
      if (!meta) errs.push({ step: 'microlink', msg: (e && e.message) ? e.message.slice(0, 120) : 'failed' });
    }
  }

  // Wayback fallback. Honest caveat: most big-box retailers (Lowe's,
  // Home Depot, etc.) block the Wayback crawler via robots.txt so no
  // snapshots exist of their product pages. This layer mainly catches
  // smaller retailers and pages that 404'd after the URL was saved.
  if (!meta || !meta.image) {
    try {
      const wb = await waybackFetch(url);
      if (wb.image || wb.title) {
        const directPrice = (meta && meta.price !== undefined) ? meta.price : null;
        meta = {
          title:         wb.title         || (meta && meta.title)         || '',
          image:         wb.image         || (meta && meta.image)         || '',
          price:         wb.price ?? directPrice,
          priceCurrency: wb.priceCurrency || (meta && meta.priceCurrency) || '',
          retailer:      wb.retailer      || (meta && meta.retailer)      || retailer,
        };
      }
    } catch (e) {
      if (!meta) errs.push({ step: 'wayback', msg: (e && e.message) ? e.message.slice(0, 120) : 'failed' });
    }
  }

  // Final fallback: pull the product description out of the URL slug
  // and search Brave for it. This is what actually rescues Lowe's,
  // Home Depot, etc. — their URL slugs contain the human-readable
  // product name, and the same product is indexed across many other
  // sites that Brave can return images from. Requires BRAVE_SEARCH_API_KEY.
  if ((!meta || !meta.image) && BR_KEY()) {
    try {
      const slugQuery = extractQueryFromUrl(url);
      if (slugQuery) {
        let polished = slugQuery;
        try { polished = await polishQueryWithClaude(slugQuery, ''); } catch {}
        const br = await braveImageSearch(polished);
        if (br.image) {
          const directPrice = (meta && meta.price !== undefined) ? meta.price : null;
          meta = {
            title:         br.title    || (meta && meta.title) || slugQuery,
            image:         br.image,
            price:         (meta && meta.price) ?? directPrice,
            priceCurrency: (meta && meta.priceCurrency) || '',
            retailer:      `${retailer} (via search)`,
          };
        }
      }
    } catch (e) {
      if (!meta) errs.push({ step: 'brave-slug', msg: (e && e.message) ? e.message.slice(0, 120) : 'failed' });
    }
  }

  const errorStr = buildErrorString(errs);
  const result = meta ? {
    url_hash:       urlHash,
    url,
    retailer:       meta.retailer || retailer,
    title:          meta.title    || '',
    image:          meta.image    || '',
    price:          meta.price ?? null,
    price_currency: meta.priceCurrency || '',
    error:          (!meta.image && !meta.title) ? (errorStr || 'no metadata') : '',
    fetched_at:     new Date().toISOString(),
  } : {
    url_hash:       urlHash,
    url,
    retailer,
    title:          '',
    image:          '',
    price:          null,
    price_currency: '',
    error:          errorStr || 'fetch failed',
    fetched_at:     new Date().toISOString(),
  };

  await upsertCache(result);
  return shapeResponse(result, false);
}

// ── Text-based resolution (no URL) ──────────────────────────────────────
// Build a stable cache key per text+hint combination so the same query
// hits cache the second time. Stored alongside URL rows in product_meta
// table, distinguished by url field starting with "text:".
function textCacheUrl(query) {
  return 'text:' + query.toLowerCase().replace(/\s+/g, ' ').trim();
}
async function getOrFetchText(rawText, hint, forceFresh) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return shapeResponse({
    url_hash: hashUrl(textCacheUrl('empty')),
    url:      'text:empty',
    retailer: '',
    title:    '',
    image:    '',
    price:    null,
    price_currency: '',
    error:    'No product text provided',
    fetched_at: new Date().toISOString(),
  }, false);

  // Cache lookup uses the RAW text key — same description always maps to
  // the same row regardless of whether Claude polish is enabled.
  const cacheKey = textCacheUrl(trimmed + (hint ? ` | ${hint}` : ''));
  const urlHash  = hashUrl(cacheKey);

  if (!forceFresh) {
    const existing = await getCached(urlHash);
    if (existing) {
      const fresh = existing.fetched_at && (Date.now() - new Date(existing.fetched_at).getTime() < TTL_MS);
      if (fresh) return shapeResponse(existing, true);
    }
  }

  // Polish the query with Claude (cheap, fail-open) then send to Brave
  let polished = trimmed;
  try { polished = await polishQueryWithClaude(trimmed, hint); } catch {}

  let meta = null;
  let err  = '';
  try {
    meta = await braveImageSearch(polished);
  } catch (e) {
    err = e.message || 'Brave image search failed';
    // One retry with the un-polished query in case Claude made it worse
    if (polished !== trimmed) {
      try { meta = await braveImageSearch(trimmed); err = ''; }
      catch (e2) { err = `${err}; raw retry: ${e2.message || 'failed'}`; }
    }
  }

  const result = meta ? {
    url_hash:       urlHash,
    url:            cacheKey,
    retailer:       meta.retailer || '',
    title:          meta.title    || polished,
    image:          meta.image    || '',
    price:          null,
    price_currency: '',
    error:          '',
    fetched_at:     new Date().toISOString(),
  } : {
    url_hash:       urlHash,
    url:            cacheKey,
    retailer:       '',
    title:          '',
    image:          '',
    price:          null,
    price_currency: '',
    error:          err.slice(0, 240) || 'no image found',
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

    // ── POST: bulk URL fetch OR bulk text search ─────────────────────────
    if (event.httpMethod === 'POST') {
      const body  = JSON.parse(event.body || '{}');
      const force = qs.refresh === '1' || body.refresh === true;

      // Text-based bulk search (for plain-text products with no URL)
      if (Array.isArray(body.texts) && body.texts.length) {
        const slice = body.texts.slice(0, 50);
        const results = await Promise.all(slice.map(item =>
          getOrFetchText(item.text, item.hint, force)
            .then(r => ({ ...r, key: item.key }))
            .catch(err => ({ key: item.key, text: item.text, error: err.message || 'text search failed' }))
        ));
        return respond(200, { count: results.length, results });
      }

      // URL-based bulk fetch (existing path)
      const urls  = Array.isArray(body.urls) ? body.urls : [];
      const slice = urls.slice(0, 50);
      const results = await Promise.all(slice.map(u => getOrFetch(u, force)
        .catch(err => ({ url: u, error: err.message || 'fetch failed' }))));
      return respond(200, { count: results.length, results });
    }

    // ── GET: single URL or single text query ─────────────────────────────
    const url  = qs.url;
    const text = qs.text;
    const force = qs.refresh === '1';
    if (text) {
      const result = await getOrFetchText(text, qs.hint || '', force);
      return respond(200, result);
    }
    if (!url) return respond(400, { error: 'url or text required' });
    const result = await getOrFetch(url, force);
    return respond(200, result);
  } catch (e) {
    console.error('product-meta error:', e);
    return respond(500, { error: e.message });
  }
};
