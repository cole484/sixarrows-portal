// netlify/functions/sheet-sab-budget-sync.js
// Reads the Budget tab (SAB pre-construction) from a Google Sheet
// Detects main category rows by: has category name in col A, no vendor in col B, has status in col C
// Imports them as budget_categories in Supabase
//
// Column mapping for Budget tab:
//   A (0) = Category name
//   B (1) = Contractor / Vendor (blank for main categories)
//   C (2) = Status (In Progress / Confirmed / Need Estimate / blank)
//   D (3) = Cost

import { respond, corsHeaders } from './lib/supabase-client.js';

const GS_KEY  = () => process.env.GOOGLE_API_KEY;
const SB_URL  = () => process.env.SUPABASE_URL;
const SB_KEY  = () => process.env.SUPABASE_ANON_KEY;

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseCurrency(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Map Google Sheet status to portal status
function mapStatus(sheetStatus) {
  const s = (sheetStatus || '').toLowerCase().trim();
  if (s === 'confirmed')     return 'complete';
  if (s === 'in progress')   return 'active';
  return 'pending'; // Need Estimate, blank, anything else
}

function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',
  };
}

async function fetchTabValues(sheetId, tabTitle, apiKey) {
  const range = `'${tabTitle}'!A:M`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;
  const res   = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.values || [];
}

async function getTabList(sheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets metadata error ${res.status}`);
  const data = await res.json();
  return (data.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title }));
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const { clientId, sheetUrl } = event.queryStringParameters || {};
  if (!clientId || !sheetUrl) return respond(400, { error: 'clientId and sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId)  return respond(400, { error: 'Could not parse sheet ID from URL' });

  const apiKey = GS_KEY();
  if (!apiKey)   return respond(500, { error: 'GOOGLE_API_KEY not configured' });

  // Find the Budget tab
  let tabs, budgetTab;
  try {
    tabs = await getTabList(sheetId, apiKey);
    budgetTab = tabs.find(t => t.title.toLowerCase() === 'budget') || tabs[0];
  } catch(err) {
    return respond(502, { error: `Could not read spreadsheet: ${err.message}` });
  }

  // Fetch the Budget tab values
  let rows;
  try {
    rows = await fetchTabValues(sheetId, budgetTab.title, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read tab "${budgetTab.title}": ${err.message}` });
  }

  if (!rows.length) return respond(200, { synced: 0, message: 'Budget tab is empty' });

  // Parse main category rows
  // Main category = has name in col A, no vendor in col B, has status in col C
  const TOP_LEVEL_STATUSES = ['in progress', 'confirmed', 'need estimate', 'not started'];
  const categories = [];

  // Known top-level category names to help identify them
  const knownCategories = [
    'design & planning', 'construction costs', 'mechanical systems',
    'interior finishes', 'exterior work', 'utilities & hookups',
    'miscellaneous', 'other costs', 'management fee',
  ];

  for (let i = 1; i < rows.length; i++) { // skip header row 0
    const row = rows[i];
    const name   = (row[0] || '').toString().trim();
    const vendor = (row[1] || '').toString().trim();
    const status = (row[2] || '').toString().trim();
    const cost   = parseCurrency(row[3]);

    if (!name || name === 'Category') continue;

    // Detect main category: no vendor AND (has a known status OR is a known category name)
    const hasStatus   = TOP_LEVEL_STATUSES.includes(status.toLowerCase());
    const isKnown     = knownCategories.some(k => name.toLowerCase().includes(k));
    const noVendor    = !vendor;

    if (noVendor && (hasStatus || isKnown)) {
      categories.push({
        name,
        status: mapStatus(status),
        cost,
        sortOrder: categories.length,
      });
    }
  }

  if (!categories.length) {
    return respond(200, { synced: 0, message: 'No main categories detected in Budget tab', tab: budgetTab.title });
  }

  // Delete existing budget_categories for this client and re-insert
  try {
    // Delete existing
    await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: sbHeaders(),
    });

    // Insert new categories
    const inserts = categories.map((cat, idx) => ({
      client_id:  clientId,
      name:       cat.name,
      status:     cat.status,
      total:      cat.cost,
      spent:      0,
      sort_order: idx,
    }));

    const insertRes = await fetch(`${SB_URL()}/rest/v1/budget_categories`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(inserts),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      throw new Error(`Supabase insert failed: ${err}`);
    }

    return respond(200, {
      synced:     categories.length,
      tab:        budgetTab.title,
      categories: categories.map(c => ({ name: c.name, status: c.status, cost: c.cost })),
    });

  } catch(err) {
    return respond(500, { error: err.message });
  }
};
