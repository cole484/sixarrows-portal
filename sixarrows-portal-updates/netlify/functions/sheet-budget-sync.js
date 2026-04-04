// netlify/functions/sheet-budget-sync.js
//
// Uses Google Sheets API v4 to read budget sheets.
// Requires GOOGLE_API_KEY environment variable in Netlify.
//
// MODE 1 — Status sync (called on budget page load)
//   GET ?clientId=xxx&sheetUrl=xxx
//
// MODE 2 — Category import
//   GET ?clientId=xxx&sheetUrl=xxx&syncCategories=1

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const GS_KEY = () => process.env.GOOGLE_API_KEY;

const STATUS_MAP = {
  'not started':     'pending',
  'need estimate':   'pending',
  'pending':         'pending',
  'need to confirm': 'active',
  'in progress':     'active',
  'active':          'active',
  'confirmed':       'complete',
  'complete':        'complete',
  'completed':       'complete',
};

function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'string') return 'pending';
  return STATUS_MAP[raw.toLowerCase().trim()] || 'pending';
}

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function extractGid(url) {
  const match = url.match(/[#&?]gid=(\d+)/);
  return match ? match[1] : null;
}

function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
  };
}

// ── Get sheet tab name from gid via spreadsheet metadata ────────────────────
async function getSheetTabName(sheetId, gid, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const sheets = data.sheets || [];
  if (gid) {
    const match = sheets.find(s => String(s.properties.sheetId) === String(gid));
    if (match) return match.properties.title;
  }
  // Fall back to first sheet
  return sheets[0]?.properties?.title || null;
}

// ── Fetch sheet data via Google Sheets API v4 ────────────────────────────────
async function fetchSheetValues(sheetId, tabName, apiKey) {
  const range = tabName ? `${tabName}!A:Z` : 'A:Z';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    let errMsg = `Google Sheets API error ${res.status}`;
    try { errMsg = JSON.parse(errText).error?.message || errMsg; } catch(e) {}
    if (res.status === 403) throw new Error('Sheet access denied. Ensure the sheet is shared as "Anyone with the link can view" and Google Sheets API is enabled.');
    if (res.status === 404) throw new Error('Sheet or tab not found. Check the URL is correct.');
    throw new Error(errMsg);
  }

  const data = await res.json();
  return data.values || [];
}

// ── Extract Main Category rows (col Z = "Main Category") ────────────────────
function extractMainCategories(rows) {
  const cats = [];
  for (const row of rows) {
    const tag = (row[25] || '').toString().trim();
    if (tag.toLowerCase() !== 'main category') continue;
    const name      = (row[0] || '').toString().trim();
    const statusRaw = (row[2] || '').toString().trim();
    const costRaw   = (row[3] || '').toString().replace(/[$,\s]/g, '');
    const cost      = parseFloat(costRaw);
    if (!name) continue;
    cats.push({ name, total: isNaN(cost) ? 0 : cost, status: normalizeStatus(statusRaw) });
  }
  return cats;
}

// ── Extract status map from tagged rows ─────────────────────────────────────
function extractCategoryStatuses(rows) {
  const statuses = {};
  for (const row of rows) {
    const name    = (row[0] || '').toString().trim();
    const tag     = (row[25] || '').toString().trim();
    const status  = normalizeStatus((row[2] || '').toString().trim());
    if (!name) continue;
    // Use tagged Main Category rows if present, else fall back to rows with no contractor
    const isMain = tag.toLowerCase() === 'main category' || (!(row[1] || '').toString().trim() && name);
    if (isMain) statuses[name] = { status };
  }
  return statuses;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const clientId = event.queryStringParameters?.clientId;
  const sheetUrl = event.queryStringParameters?.sheetUrl;
  const syncCats = event.queryStringParameters?.syncCategories === '1';

  if (!clientId) return respond(400, { error: 'clientId required' });
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Invalid Google Sheet URL' });

  const apiKey = GS_KEY();
  if (!apiKey) return respond(500, { error: 'GOOGLE_API_KEY not configured in Netlify environment variables' });

  // Detect the correct tab name from the gid in the URL
  const gid = extractGid(sheetUrl);
  let tabName = null;
  try {
    tabName = await getSheetTabName(sheetId, gid, apiKey);
  } catch(e) {
    console.log('Could not fetch tab name, will try without:', e.message);
  }

  // Fetch sheet values
  let rows;
  try {
    rows = await fetchSheetValues(sheetId, tabName, apiKey);
  } catch(err) {
    return respond(502, { error: err.message });
  }

  if (!rows || rows.length === 0) {
    return respond(200, { synced: 0, message: 'Sheet appears empty', categories: [] });
  }

  const hdrs = sbHeaders();

  // ── MODE 2: import categories from column Z ─────────────────────────────
  if (syncCats) {
    const cats = extractMainCategories(rows);
    if (cats.length === 0) {
      return respond(200, {
        synced: 0,
        message: 'No rows tagged "Main Category" found in column Z.',
        categories: [],
        debug: { tabName, rowCount: rows.length, firstRow: rows[0] },
      });
    }

    // Delete existing and insert fresh
    await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: hdrs,
    });

    const insertRows = cats.map((cat, i) => ({
      client_id: clientId, name: cat.name, total: cat.total,
      spent: 0, status: cat.status, sort_order: i + 1, sub_categories: [],
    }));

    const insertRes = await fetch(`${SB_URL()}/rest/v1/budget_categories`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body: JSON.stringify(insertRows),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      return respond(502, { error: `Database insert failed: ${err}` });
    }

    const inserted = await insertRes.json();
    return respond(200, {
      synced: inserted.length,
      message: `Imported ${inserted.length} categories from sheet`,
      categories: inserted.map(c => ({ name: c.name, total: c.total, status: c.status })),
    });
  }

  // ── MODE 1: status sync against existing Supabase categories ────────────
  const categoryStatuses = extractCategoryStatuses(rows);
  if (Object.keys(categoryStatuses).length === 0) {
    return respond(200, { synced: 0, message: 'No category rows found', categories: {} });
  }

  const catsRes = await fetch(
    `${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}&select=id,name,status&order=sort_order.asc`,
    { headers: hdrs }
  );
  if (!catsRes.ok) return respond(502, { error: 'Could not fetch budget categories' });

  const dbCats = await catsRes.json();
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
          method: 'PATCH',
          headers: { ...hdrs, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status }),
        });
        if (patchRes.ok) updates.push({ name: dbCat.name, from: dbCat.status, to: status });
      }
    }
  }

  return respond(200, {
    synced: updates.length,
    message: updates.length > 0 ? `Updated ${updates.length} category statuses` : 'All categories up to date',
    updates,
  });
};
