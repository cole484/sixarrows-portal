// netlify/functions/product-intake.js
// ─────────────────────────────────────────────────────────────────────────────
//  Product Intake — AI-powered product cataloging for Fox
//
//  Accepts a vendor product URL, fetches the page, uses Claude to extract
//  product data and suggest taste dimension tags, then optionally saves
//  to the Notion product catalog.
//
//  POST /.netlify/functions/product-intake
//  Body:
//    {
//      url:    'https://vendor.com/product-page',    // required
//      action: 'analyze' | 'save',                   // default 'analyze'
//      product: { ... }                              // required when action='save'
//    }
//
//  Response (analyze):
//    {
//      product: {
//        name, vendor, category, imageUrl, styleFit, tier,
//        temperature, materialFeel, surface, visualWeight, riskLevel,
//        priceRange, notes, vendorUrl
//      }
//    }
//
//  Response (save):
//    { saved: true, notionUrl: '...' }
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_DB_ID = 'a25f42825d174d2c8bb7c0f631d5835e';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Product extraction prompt
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a senior interior designer cataloging products for an AI design recommendation system called Fox. Fox matches products to client taste profiles using 5 taste dimensions on a 1-10 scale.

Your job: extract product information from the provided web page content and assign taste dimension scores.

## Taste Dimensions (1-10 scale)

**Temperature** (1=Cool → 10=Warm)
- Cool (1-3): Chrome, bright whites, blue-grey undertones, glass, cool metals
- Neutral (4-6): Brushed nickel, balanced whites, greige tones
- Warm (7-10): Brass, bronze, honey tones, warm whites, rich woods

**Material Feel** (1=Manufactured → 10=Natural)
- Manufactured (1-3): Engineered quartz, porcelain, uniform finishes, laminate
- Mixed (4-6): Some natural variation but still consistent
- Natural (7-10): Real stone with veining, visible wood grain, handmade tile, patina

**Surface** (1=Matte → 10=Polished)
- Matte (1-3): Honed stone, matte finishes, brushed metals, flat sheens
- Satin (4-6): Soft sheen, eggshell, satin metals
- Polished (7-10): High gloss, polished marble, chrome, lacquer

**Visual Weight** (1=Quiet → 10=Expressive)
- Quiet (1-3): Understated, lets materials speak, minimal presence
- Moderate (4-6): Has character but doesn't dominate
- Expressive (7-10): Statement piece, dramatic, commands attention

**Risk Level** (1=Safe/Proven → 10=Adventurous)
- Safe (1-3): Classic subway tile, standard Shaker, widely used and proven
- Moderate (4-6): Current but not trendy, somewhat distinctive
- Adventurous (7-10): Unusual material, unexpected combination, artisanal, uncommon

## Categories
Choose exactly one: Cabinetry, Countertops, Backsplash Tile, Floor Tile, Plumbing Fixtures, Cabinet Hardware, Lighting, Paint, Flooring, Vanities, Mirrors, Accessories

## Style Fit
Choose 1-3 that best fit: Modern Farmhouse, Transitional, Modern Traditional, Organic Modern, Clean Modern, Warm Luxury

## Tier
- Essential: Good quality, smart choice, workhorse product
- Elevated: Designer-level, noticeably premium
- Showpiece: Magazine-cover, investment piece

## Rooms
Choose 1+ that apply: Kitchen, Primary Bath, Powder Room, Living Room, Exterior, All Rooms

## Response Format
Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "Product name as it should appear in catalog",
  "vendor": "Brand or manufacturer name",
  "skuModel": "Exact SKU or model number if found on page, or null",
  "category": "one of the categories above",
  "room": ["Kitchen", "Primary Bath"],
  "imageUrl": "URL of the best product image from the page, or null",
  "styleFit": ["style1", "style2"],
  "tier": "Essential|Elevated|Showpiece",
  "temperature": 7,
  "materialFeel": 8,
  "surface": 3,
  "visualWeight": 4,
  "riskLevel": 3,
  "priceRange": "$X - $Y or approximate",
  "notes": "Brief design notes: material, finish, dimensions, lead time if mentioned. 1-2 sentences max.",
  "foxNotes": "Why a designer would choose this product for a specific client personality. Reference taste dimensions. 1-2 sentences.",
  "pairings": "What this product works well with — other materials, finishes, styles. Comma-separated list."
}`;

// ─────────────────────────────────────────────────────────────────────────────
//  Fetch and clean page content
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPageContent(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);

  const html = await res.text();

  // Strip scripts, styles, SVGs, and compress whitespace
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!\-\-[\s\S]*?\-\->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Also extract image URLs from the original HTML
  const imgUrls = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith('http') && !src.includes('icon') && !src.includes('logo') && !src.includes('svg')) {
      imgUrls.push(src);
    }
  }

  // Also check og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch) imgUrls.unshift(ogMatch[1]);

  // Truncate to ~12k chars to fit in context
  if (text.length > 12000) text = text.slice(0, 12000) + '… [truncated]';

  return { text, imageUrls: imgUrls.slice(0, 5) };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Call Claude to extract product data
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeProduct(pageContent, imageUrls, vendorUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const userMessage = `Here is the content from a vendor product page at ${vendorUrl}:

---PAGE CONTENT---
${pageContent}
---END PAGE CONTENT---

${imageUrls.length > 0 ? `\nFound images on page:\n${imageUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : ''}

Extract the product information and assign taste dimension scores. Return ONLY the JSON object.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DESIGN_AGENT_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1024,
      temperature: 0.2,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  const product = JSON.parse(jsonStr.trim());
  product.vendorUrl = vendorUrl;

  // Validate required fields
  const required = ['name', 'vendor', 'category', 'temperature', 'materialFeel', 'surface', 'visualWeight', 'riskLevel'];
  for (const f of required) {
    if (product[f] === undefined || product[f] === null) {
      throw new Error(`AI extraction missing required field: ${f}`);
    }
  }

  // Clamp dimension scores to 1-10
  for (const dim of ['temperature', 'materialFeel', 'surface', 'visualWeight', 'riskLevel']) {
    product[dim] = Math.max(1, Math.min(10, Math.round(product[dim])));
  }

  return product;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Save to Notion
// ─────────────────────────────────────────────────────────────────────────────

async function saveToNotion(product) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('Missing NOTION_TOKEN');

  const properties = {
    'Product Name': { title: [{ text: { content: product.name } }] },
    'Vendor':       { rich_text: [{ text: { content: product.vendor || '' } }] },
    'Vendor URL':   product.vendorUrl ? { url: product.vendorUrl } : undefined,
    'Image URL':    product.imageUrl  ? { url: product.imageUrl }  : undefined,
    'Category':     { select: { name: product.category } },
    'Style Fit':    { multi_select: (product.styleFit || []).map(s => ({ name: s })) },
    'Room':         product.room?.length ? { multi_select: product.room.map(r => ({ name: r })) } : undefined,
    'Tier':         { select: { name: product.tier } },
    'SKU/Model':    product.skuModel ? { rich_text: [{ text: { content: product.skuModel } }] } : undefined,
    'Temperature':  { number: product.temperature },
    'Material Feel':{ number: product.materialFeel },
    'Surface':      { number: product.surface },
    'Visual Weight':{ number: product.visualWeight },
    'Risk Level':   { number: product.riskLevel },
    'Price Range':  product.priceRange ? { rich_text: [{ text: { content: product.priceRange } }] } : undefined,
    'Notes':        product.notes ? { rich_text: [{ text: { content: product.notes } }] } : undefined,
    'Fox Notes':    product.foxNotes ? { rich_text: [{ text: { content: product.foxNotes } }] } : undefined,
    'Pairings':     product.pairings ? { rich_text: [{ text: { content: product.pairings } }] } : undefined,
    'Status':       { select: { name: 'Review' } },
  };

  // Remove undefined properties
  for (const k of Object.keys(properties)) {
    if (properties[k] === undefined) delete properties[k];
  }

  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DB_ID },
      properties,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error: ${res.status} — ${err}`);
  }

  const page = await res.json();
  return { notionUrl: page.url, notionId: page.id };
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

  const action = body.action || 'analyze';

  try {
    // ── Analyze: fetch URL → extract product data via Claude ──
    if (action === 'analyze') {
      const url = body.url;
      if (!url || !url.startsWith('http')) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Valid URL required' }) };
      }

      console.log(`[product-intake] Analyzing: ${url}`);
      const { text, imageUrls } = await fetchPageContent(url);
      const product = await analyzeProduct(text, imageUrls, url);

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ product }),
      };
    }

    // ── Save: write product to Notion ──
    if (action === 'save') {
      const product = body.product;
      if (!product || !product.name) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Product data required' }) };
      }

      console.log(`[product-intake] Saving: ${product.name}`);
      const { notionUrl, notionId } = await saveToNotion(product);

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ saved: true, notionUrl, notionId }),
      };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

  } catch (err) {
    console.error('[product-intake] Error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
