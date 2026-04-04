// netlify/functions/sheet-budget-sync.js
//
// Uses Google Sheets API v4 to read budget sheets — works with all account types.
// Requires GOOGLE_API_KEY environment variable in Netlify.
//
// Two modes:
//
// MODE 1 — Status sync (called on budget page load)
//   GET ?clientId=xxx&sheetUrl=xxx
//   Updates existing Supabase category statuses from sheet
//
// MODE 2 — Category import (called from admin "Sync Categories" button)
//   GET ?clientId=xxx&sheetUrl=xxx&syncCategories=1
//   Reads column Z for "Main Category" rows, replaces Supabase categories
//
// Sheet structure:
//   Col A (0)  = Category name
//   Col B (1)  = Contractor
//   Col C (2)  = Status
//   Col D (3)  = Cost / subtotal
//   Col Z (25) = Tag: "Main Category" | "Sub Main Category" | blank

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const GS_KEY = () => process.env.GOOGLE_API_KEY;

// Status mapping: sheet value → portal enum
const STATUS_MAP = {
  'not started':      'pending',
  'need estimate':    'pending',
  'pending':          'pending',
  'need to confirm':  'active',
  'in progress':      'active',
  'active':           'active',
  'confirmed':        'complete',
  'complete':         'complete',
  'completed':        'complete',
};

function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'string') return 'pending';
  return STATUS_MAP[raw.toLowerCase().trim()] || 'pending';
}

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ── Fetch sheet data via Google Sheets API v4 ────────────────────────────────
// Returns a 2D array of cell values (rows × cols), or throws on error
async function fetchSheetValues(sheetId, range) {
  const apiKey = GS_KEY();
  if (!apiKey) throw new Error('GOOGLE_API_KEY environment variable not set in Netlify');

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `Google Sheets API error ${res.status}`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson.error?.message || errMsg;
    } catch(e) {}

    // Friendly messages for common errors
    if (res.status === 403) {
      throw new Error('Sheet access denied. Make sure the sheet is shared as "Anyone with the link can view" and the Google Sheets API is enabled in your Google Cloud project.');
    }
    if (res.status === 404) {
      throw new Error('Sheet not found. Check the URL is correct and the sheet exists.');
    }
    throw new Error(errMsg);
  }

  const data = await res.json();
  return data.values || []; // 2D array, rows may be shorter than max cols if trailing cells are empty
}

// ── Supabase helper headers ──────────────────────────────────────────────────
function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
  };
}

// ── MODE 2: extract Main Category rows using column Z tag ────────────────────
function extractMainCategories(rows) {
  const cats = [];
  for (const row of rows) {
    // Pad row to at least 26 cols so col Z (index 25) is always accessible
    const tag = (row[25] || '').toString().trim();
    if (tag.toLowerCase() !== 'main category') continue;

    const name      = (row[0] || '').toString().trim();
    const statusRaw = (row[2] || '').toString().trim();
    const costRaw   = (row[3] || '').toString().replace(/[$,]/g, '').trim();
    const cost      = parseFloat(costRaw);

    if (!name) continue;

    cats.push({
      name,
      total:  isNaN(cost) ? 0 : cost,
      status: normalizeStatus(statusRaw),
    });
  }
  return cats;
}

// ── MODE 1: extract status map for fuzzy matching against existing cats ───────
function extractCategoryStatuses(rows) {
  const statuses = {};
  for (const row of rows) {
    const name       = (row[0] || '').toString().trim();
    const contractor = (row[1] || '').toString().trim();
    const statusRaw  = (row[2] || '').toString().trim();
    const tag        = (row[25] || '').toString().trim();

    // For status sync, use tagged Main Category rows if present, else fall back to old heuristic
    const isMainCat = tag.toLowerCase() === 'main category' || (!contractor && name);
    if (!name || !isMainCat) continue;

    const status = normalizeStatus(statusRaw);
    statuses[name] = { status };
  }
  return statuses;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const clientId  = event.queryStringParameters?.clientId;
  const sheetUrl  = event.queryStringParameters?.sheetUrl;
  const syncCats  = event.queryStringParameters?.syncCategories === '1';

  if (!clientId) return respond(400, { error: 'clientId required' });
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Invalid Google Sheet URL — could not extract sheet ID' });

  // Fetch all data from the Budget sheet
  // Range A:Z covers all columns we care about
  let rows;
  try {
    rows = await fetchSheetValues(sheetId, 'Budget!A:Z');
  } catch(err) {
    // Try without sheet name if "Budget" tab doesn't exist
    try {
      rows = await fetchSheetValues(sheetId, 'A:Z');
    } catch(err2) {
      return respond(502, { error: err.message });
    }
  }

  if (!rows || rows.length === 0) {
    return respond(200, { synced: 0, message: 'Sheet appears to be empty', categories: [] });
  }

  const hdrs = sbHeaders();

  // ── MODE 2: import categories from column Z ─────────────────────────────
  if (syncCats) {
    const cats = extractMainCategories(rows);

    if (cats.length === 0) {
      return respond(200, {
        synced: 0,
        message: 'No rows tagged "Main Category" found in column Z. Make sure the dropdown is set to "Main Category" on your header rows.',
        categories: [],
      });
    }

    // Delete existing categories for this client
    await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: hdrs,
    });

    // Insert fresh categories from sheet
    const insertRows = cats.map((cat, i) => ({
      client_id:      clientId,
      name:           cat.name,
      total:          cat.total,
      spent:          0,
      status:         cat.status,
      sort_order:     i + 1,
      sub_categories: [],
    }));

    const insertRes = await fetch(`${SB_URL()}/rest/v1/budget_categories`, {
      method:  'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body:    JSON.stringify(insertRows),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      return respond(502, { error: `Database insert failed: ${err}` });
    }

    const inserted = await insertRes.json();
    return respond(200, {
      synced:     inserted.length,
      message:    `Imported ${inserted.length} categories from sheet`,
      categories: inserted.map(c => ({ name: c.name, total: c.total, status: c.status })),
    });
  }

  // ── MODE 1: status sync against existing Supabase categories ────────────
  const categoryStatuses = extractCategoryStatuses(rows);

  if (Object.keys(categoryStatuses).length === 0) {
    return respond(200, { synced: 0, message: 'No category rows found in sheet', categories: {} });
  }

  const catsRes = await fetch(
    `${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}&select=id,name,status&order=sort_order.asc`,
    { headers: hdrs }
  );

  if (!catsRes.ok) return respond(502, { error: 'Could not fetch budget categories from database' });

  const dbCats  = await catsRes.json();
  const updates = [];

  for (const dbCat of dbCats) {
    const dbLower = dbCat.name.toLowerCase();
    let match = Object.entries(categoryStatuses).find(([n]) => n.toLowerCase() === dbLower);
    if (!match) {
      match = Object.entries(categoryStatuses).find(([n]) =>
        n.toLowerCase().split(' ')[0] === dbLower.split(' ')[0]
      );
    }
    if (match) {
      const [, { status }] = match;
      if (status !== dbCat.status) {
        const patchRes = await fetch(`${SB_URL()}/rest/v1/budget_categories?id=eq.${dbCat.id}`, {
          method:  'PATCH',
          headers: { ...hdrs, 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ status }),
        });
        if (patchRes.ok) updates.push({ name: dbCat.name, from: dbCat.status, to: status });
      }
    }
  }

  return respond(200, {
    synced:  updates.length,
    message: updates.length > 0
      ? `Updated ${updates.length} category status${updates.length > 1 ? 'es' : ''}`
      : 'All categories already up to date',
    updates,
  });
};
