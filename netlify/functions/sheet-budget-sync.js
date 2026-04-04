// netlify/functions/sheet-budget-sync.js
//
// Two modes:
//
// MODE 1 — Status sync (existing behaviour, called on page load)
//   GET ?clientId=xxx&sheetUrl=xxx
//   Reads sheet, fuzzy-matches existing Supabase categories, updates statuses
//
// MODE 2 — Category import (new, called from admin "Sync Categories" button)
//   GET ?clientId=xxx&sheetUrl=xxx&syncCategories=1
//   Reads column Z for "Main Category" rows, deletes existing cats, inserts fresh from sheet
//   Returns the created categories
//
// Sheet structure:
//   Col A  = Category / line item name
//   Col B  = Contractor
//   Col C  = Status
//   Col D  = Cost / subtotal
//   Col Z  = Tag ("Main Category" | "Sub Main Category" | blank)
//
// Requires sheet to be shared: "Anyone with link can view"

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

// Status mapping: sheet value → Supabase enum
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

// Parse CSV — handles quoted fields with embedded commas/newlines
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) { rows.push([]); continue; }
    const cells = [];
    let inQuotes = false, cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuotes)  { inQuotes = true;  continue; }
      if (ch === '"' && inQuotes)   { inQuotes = false; continue; }
      if (ch === ',' && !inQuotes)  { cells.push(cell.trim()); cell = ''; continue; }
      cell += ch;
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  return rows;
}

// ── MODE 1: extract status map from existing rows (fuzzy match) ─────────────
function extractCategoryStatuses(rows) {
  const statuses = {};
  for (const row of rows) {
    const name       = row[0]?.trim();
    const contractor = row[1]?.trim();
    const statusRaw  = row[2]?.trim();
    if (!name || contractor) continue; // skip blank or line-item rows
    const status = normalizeStatus(statusRaw);
    if (status) statuses[name] = { status };
  }
  return statuses;
}

// ── MODE 2: extract Main Category rows from column Z ────────────────────────
function extractMainCategories(rows) {
  // Column Z = index 25
  const TAG_COL    = 25;
  const NAME_COL   = 0;
  const STATUS_COL = 2;
  const COST_COL   = 3;

  const cats = [];
  for (const row of rows) {
    const tag = row[TAG_COL]?.trim();
    if (!tag || tag.toLowerCase() !== 'main category') continue;

    const name      = row[NAME_COL]?.trim();
    const statusRaw = row[STATUS_COL]?.trim();
    const costRaw   = parseFloat(row[COST_COL]);

    if (!name) continue;

    cats.push({
      name,
      total:  isNaN(costRaw) ? 0 : costRaw,
      status: normalizeStatus(statusRaw),
    });
  }
  return cats;
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const clientId      = event.queryStringParameters?.clientId;
  const sheetUrl      = event.queryStringParameters?.sheetUrl;
  const syncCats      = event.queryStringParameters?.syncCategories === '1';

  if (!clientId) return respond(400, { error: 'clientId required' });
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Invalid Google Sheet URL' });

  // Fetch sheet as CSV
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  let rows;
  try {
    const res = await fetch(csvUrl, { headers: { 'Accept': 'text/csv' }, redirect: 'follow' });
    if (!res.ok) return respond(502, {
      error: 'Could not read Google Sheet. Ensure it is shared as "Anyone with link can view".',
      status: res.status,
    });
    rows = parseCSV(await res.text());
  } catch(err) {
    return respond(500, { error: `Sheet fetch failed: ${err.message}` });
  }

  // ── MODE 2: import categories from column Z ─────────────────────────────
  if (syncCats) {
    const cats = extractMainCategories(rows);
    if (cats.length === 0) {
      return respond(200, {
        synced: 0,
        message: 'No rows tagged "Main Category" found in column Z. Check the sheet.',
        categories: [],
      });
    }

    const hdrs = sbHeaders();

    // Delete existing categories for this client
    await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: hdrs,
    });

    // Insert fresh categories
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
      return respond(502, { error: `Insert failed: ${err}` });
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
    return respond(200, {
      synced: 0,
      message: 'No main category statuses found in sheet.',
      categories: {},
    });
  }

  const hdrs    = sbHeaders();
  const catsRes = await fetch(
    `${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}&select=id,name,status&order=sort_order.asc`,
    { headers: hdrs }
  );

  if (!catsRes.ok) return respond(502, { error: 'Could not fetch budget categories' });

  const dbCats  = await catsRes.json();
  const updates = [];

  for (const dbCat of dbCats) {
    const dbLower = dbCat.name.toLowerCase();

    // Try exact match first, then first-word match
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
    categories: categoryStatuses,
  });
};
