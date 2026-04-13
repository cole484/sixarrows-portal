// netlify/functions/product-catalog.js
// ─────────────────────────────────────────────────────────────────────────────
//  Product Catalog API — serves real products matched to client fingerprints
//
//  POST /.netlify/functions/product-catalog
//  Body:
//    {
//      category:    'Cabinetry' | 'Countertops' | ...,   // optional filter
//      style:       'Modern Farmhouse' | ...,             // optional filter
//      tier:        'Essential' | 'Elevated' | 'Showpiece', // optional filter
//      fingerprint: { warmth: { score: 8 }, ... },        // optional: taste match scoring
//      limit:       20,                                    // default 50
//    }
//
//  Response:
//    {
//      products: [
//        {
//          id, name, vendor, category, imageUrl, vendorUrl,
//          styleFit, tier, temperature, materialFeel, surface,
//          visualWeight, riskLevel, priceRange, notes,
//          tasteMatchScore   // 0-100 if fingerprint provided
//        }
//      ],
//      total: number
//    }
// ─────────────────────────────────────────────────────────────────────────────

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_DB_ID = 'a25f42825d174d2c8bb7c0f631d5835e';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Taste dimension mapping (fingerprint dimension → product tag)
// ─────────────────────────────────────────────────────────────────────────────

const TASTE_TO_TAG = {
  warmth:               'Temperature',
  naturalManufactured:  'Material Feel',
  mattePolished:        'Surface',
  quietExpressive:      'Visual Weight',
  riskTolerance:        'Risk Level',
};

function computeTasteMatch(product, fingerprint) {
  if (!fingerprint) return null;

  let totalDiff = 0;
  let count = 0;

  for (const [fpDim, tagName] of Object.entries(TASTE_TO_TAG)) {
    const fpVal = fingerprint[fpDim]?.score ?? fingerprint[fpDim];
    const prodVal = product[tagName];
    if (fpVal != null && prodVal != null) {
      // Difference on 1-10 scale, max diff = 9
      totalDiff += Math.abs(fpVal - prodVal);
      count++;
    }
  }

  if (count === 0) return null;

  // Average diff normalized to 0-100 (100 = perfect match)
  const avgDiff = totalDiff / count;
  return Math.round(Math.max(0, 100 - (avgDiff / 9) * 100));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Query Notion database
// ─────────────────────────────────────────────────────────────────────────────

async function queryProducts({ category, style, tier, limit = 50 }) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('Missing NOTION_TOKEN');

  // Build filter — only return Approved products
  const andFilters = [
    { property: 'Status', select: { equals: 'Approved' } },
  ];

  if (category) {
    andFilters.push({ property: 'Category', select: { equals: category } });
  }
  if (tier) {
    andFilters.push({ property: 'Tier', select: { equals: tier } });
  }
  if (style) {
    andFilters.push({ property: 'Style Fit', multi_select: { contains: style } });
  }

  const filter = andFilters.length === 1
    ? andFilters[0]
    : { and: andFilters };

  const results = [];
  let startCursor = undefined;
  let fetched = 0;

  // Paginate through results
  while (fetched < limit) {
    const body = {
      filter,
      page_size: Math.min(100, limit - fetched),
      sorts: [{ property: 'Product Name', direction: 'ascending' }],
    };
    if (startCursor) body.start_cursor = startCursor;

    const res = await fetch(`${NOTION_API}/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion query error: ${res.status} — ${err}`);
    }

    const data = await res.json();

    for (const page of data.results) {
      results.push(extractProduct(page));
      fetched++;
      if (fetched >= limit) break;
    }

    if (!data.has_more) break;
    startCursor = data.next_cursor;
  }

  return results;
}

function extractProduct(page) {
  const p = page.properties;
  return {
    id:           page.id,
    name:         p['Product Name']?.title?.[0]?.plain_text || '',
    vendor:       p['Vendor']?.rich_text?.[0]?.plain_text || '',
    skuModel:     p['SKU/Model']?.rich_text?.[0]?.plain_text || '',
    category:     p['Category']?.select?.name || '',
    room:         (p['Room']?.multi_select || []).map(r => r.name),
    imageUrl:     p['Image URL']?.url || null,
    vendorUrl:    p['Vendor URL']?.url || null,
    styleFit:     (p['Style Fit']?.multi_select || []).map(s => s.name),
    tier:         p['Tier']?.select?.name || '',
    temperature:  p['Temperature']?.number ?? null,
    materialFeel: p['Material Feel']?.number ?? null,
    surface:      p['Surface']?.number ?? null,
    visualWeight: p['Visual Weight']?.number ?? null,
    riskLevel:    p['Risk Level']?.number ?? null,
    priceRange:   p['Price Range']?.rich_text?.[0]?.plain_text || '',
    notes:        p['Notes']?.rich_text?.[0]?.plain_text || '',
    foxNotes:     p['Fox Notes']?.rich_text?.[0]?.plain_text || '',
    pairings:     p['Pairings']?.rich_text?.[0]?.plain_text || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Handler
// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    const products = await queryProducts({
      category: body.category,
      style:    body.style,
      tier:     body.tier,
      limit:    body.limit || 50,
    });

    // Score taste match if fingerprint provided
    if (body.fingerprint) {
      for (const prod of products) {
        prod.tasteMatchScore = computeTasteMatch(prod, body.fingerprint);
      }
      // Sort by taste match (best first)
      products.sort((a, b) => (b.tasteMatchScore || 0) - (a.tasteMatchScore || 0));
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ products, total: products.length }),
    };

  } catch (err) {
    console.error('[product-catalog] Error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
