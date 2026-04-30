// netlify/functions/sheet-sab-budget-sync.js
// Reads the Budget tab (SAB pre-construction) from a Google Sheet
// Uses column Z "Budget Portal Category" tags — same pattern as Billing tab
//
// Column Z tags: "Main Category" | "Sub Main Category" | "Forecasted Total"
// Column mapping:
//   A (0) = Category name
//   B (1) = Contractor / Vendor
//   C (2) = Status (In Progress / Confirmed / Need Estimate / blank)
//   D (3) = Cost / estimate amount
//   Z (25) = Budget Portal Category tag (auto-detected by header scan)

import { respond, corsHeaders } from './lib/supabase-client.js';

const GS_KEY = () => process.env.GOOGLE_API_KEY;
const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
  };
}

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseCurrency(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, '').replace(/#DIV\/0!/g, ''));
  return isNaN(n) ? 0 : n;
}

// Map sheet status column (C) to portal display status
function mapStatus(sheetStatus) {
  const s = (sheetStatus || '').toLowerCase().trim();
  if (s === 'confirmed')       return 'complete';
  if (s === 'in progress')     return 'active';
  if (s === 'need estimate' || s === 'needs estimate') return 'pending';
  return 'pending';
}

async function getTabList(sheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets metadata error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.sheets || []).map(s => ({
    id:    s.properties.sheetId,
    title: s.properties.title,
    cols:  s.properties.gridProperties?.columnCount || 0,
  }));
}

async function fetchTabValues(sheetId, tabTitle, apiKey) {
  const range = `'${tabTitle}'!A:Z`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;
  const res   = await fetch(url);
  if (!res.ok) throw new Error(`Sheets values error ${res.status}: ${await res.text()}`);
  const data  = await res.json();
  return data.values || [];
}

function parseBudgetData(rows) {
  if (!rows.length) return { mainCategories: [], totalCost: 0, forecastTotal: 0 };

  // Detect tag column from header row — same as billing sync
  const headerRow = rows[0];
  let tagCol = -1;
  for (let i = 0; i < headerRow.length; i++) {
    const h = (headerRow[i] || '').toString().toLowerCase().trim();
    if (h.includes('budget portal') || h.includes('portal category')) {
      tagCol = i;
      break;
    }
  }
  if (tagCol === -1) tagCol = headerRow.length - 1; // fallback to last col

  const NAME_COL   = 0;
  const STATUS_COL = 2;
  const COST_COL   = 3;

  const result = { mainCategories: [], totalCost: 0, forecastTotal: 0 };
  let currentMain = null;

  for (const row of rows) {
    const tag    = (row[tagCol]    || '').toString().trim();
    const name   = (row[NAME_COL]  || '').toString().trim();
    const status = (row[STATUS_COL]|| '').toString().trim();
    const cost   = parseCurrency(row[COST_COL]);

    if (!name || !tag || tag.toLowerCase() === 'budget portal category') continue;

    if (tag === 'Main Category') {
      if (name.toLowerCase().includes('total')) {
        result.totalCost = cost;
        currentMain = null;
        continue;
      }
      currentMain = {
        name,
        status:  mapStatus(status),
        cost,
        subCategories: [],
      };
      result.mainCategories.push(currentMain);

    } else if (tag === 'Sub Main Category' && currentMain) {
      currentMain.subCategories.push({ name, status: mapStatus(status), cost });

    } else if (tag.toLowerCase().includes('forecast')) {
      result.forecastTotal = cost;
    }
  }

  // Calculate total from categories if not in sheet
  if (result.totalCost === 0 && result.mainCategories.length > 0) {
    result.totalCost = result.mainCategories.reduce((s, c) => s + c.cost, 0);
  }
  if (result.forecastTotal === 0) result.forecastTotal = result.totalCost;

  return result;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const { sheetUrl, clientId } = event.queryStringParameters || {};
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });
  if (!clientId) return respond(400, { error: 'clientId required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId)  return respond(400, { error: 'Could not parse sheet ID from URL' });

  const apiKey = GS_KEY();
  if (!apiKey)   return respond(500, { error: 'GOOGLE_API_KEY not configured' });

  if (!SB_URL() || !SB_KEY()) return respond(500, { error: 'Supabase not configured' });

  // Find the Budget tab
  let tabs, budgetTab;
  try {
    tabs = await getTabList(sheetId, apiKey);
    budgetTab = tabs.find(t => t.title.toLowerCase() === 'budget') || tabs[0];
  } catch(err) {
    return respond(502, { error: `Could not read spreadsheet: ${err.message}` });
  }

  // Fetch Budget tab values
  let rows;
  try {
    rows = await fetchTabValues(sheetId, budgetTab.title, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read tab "${budgetTab.title}": ${err.message}` });
  }

  if (!rows.length) return respond(200, {
    synced: 0, tab: budgetTab.title, mainCategories: [], totalCost: 0, categories: [],
    message: 'Budget tab is empty',
  });

  const data = parseBudgetData(rows);

  if (!data.mainCategories.length) {
    return respond(200, {
      synced: 0, tab: budgetTab.title, mainCategories: [], totalCost: 0, categories: [],
      message: `No "Main Category" tags found in column Z of tab "${budgetTab.title}". Check that the Budget Portal Category column has dropdown values.`,
      debug: { tabTitle: budgetTab.title, totalRows: rows.length, sampleRow: rows[1] || [] },
    });
  }

  // Persist to Supabase — delete existing rows for this client, then insert fresh
  const hdrs = sbHeaders();
  try {
    const delRes = await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: hdrs,
    });
    if (!delRes.ok) {
      const t = await delRes.text();
      console.error('SAB sync delete failed:', delRes.status, t);
      return respond(502, { error: `Could not clear existing budget: ${t}` });
    }

    const payload = data.mainCategories.map((c, i) => ({
      client_id: clientId,
      name:      c.name,
      total:     c.cost || 0,
      spent:     0,
      status:    c.status || 'pending',
      sort_order: i + 1,
      sub_categories: (c.subCategories || []).map(s => ({
        name:   s.name,
        status: s.status || 'pending',
        cost:   s.cost || 0,
      })),
    }));

    const insRes = await fetch(`${SB_URL()}/rest/v1/budget_categories`, {
      method:  'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body:    JSON.stringify(payload),
    });
    if (!insRes.ok) {
      const t = await insRes.text();
      console.error('SAB sync insert failed:', insRes.status, t);
      return respond(502, { error: `Database insert failed: ${t}` });
    }
    const inserted = await insRes.json();

    return respond(200, {
      synced:        inserted.length,
      tab:           budgetTab.title,
      mainCategories: data.mainCategories,
      totalCost:     data.totalCost,
      forecastTotal: data.forecastTotal,
      categoryCount: data.mainCategories.length,
      categories:    inserted.map(c => ({ name: c.name, total: c.total, status: c.status })),
      message:       `Imported ${inserted.length} categories from "${budgetTab.title}"`,
    });
  } catch (err) {
    console.error('SAB sync persist error:', err.message);
    return respond(500, { error: err.message });
  }
};
