// netlify/functions/sheet-billing-sync.js
// Reads the Billing tab from a client's Google Sheet using column Z tags
// Returns structured budget data for the construction phase portal
//
// Column tags (must live in the header row of the Billing tab):
//   "Main Category"    — top-level groups (Design & Planning, Mech Systems, etc.)
//   "Sub Main Category"— line items under each main category
//   "Total Costs"      — total row (col Z = "Main Category" with "Total" in name)
//   "Forecasted Total" — forecast row
//
// Columns are auto-detected by their header text (case-insensitive) so
// clients can arrange their sheet however they want without matching
// fixed positions. Any of these header words identifies each role:
//   name    ← "Category" | "Item" | "Description" | "Name"
//   budget  ← anything containing "Budget" (except "Budget Portal Category")
//   actual  ← "Actual" | "Spent" | "Committed" | "Paid"
//   overage ← "Overage" | "Variance"
//   date    ← "Draw Date" | "Date"
//   funded  ← "Funded" | "Funding" | "Source"
//   notes   ← "Notes" | "Note" | "Comment"
//   tag     ← "Budget Portal Category" | "Portal Category" | "Portal Tag"
//
// Percentage columns and anything that doesn't match are ignored.

import { respond, corsHeaders } from './lib/supabase-client.js';

const GS_KEY = () => process.env.GOOGLE_API_KEY;

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseCurrency(val) {
  if (val === null || val === undefined || val === '') return 0;
  const str = String(val).replace(/[$,\s]/g, '').replace('#DIV/0!', '').trim();
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function formatDate(val) {
  if (!val || val === 'NaN') return null;
  const str = String(val).trim();
  if (!str || str === 'nan') return null;
  // Try to parse as date
  const d = new Date(str);
  if (isNaN(d.getTime())) return str; // return as-is if not parseable
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Get sheet metadata and find the Billing tab
async function getTabInfo(sheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    let msg = `Sheets API error ${res.status}`;
    try { msg = JSON.parse(txt).error?.message || msg; } catch(e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const tabs = (data.sheets || []).map(s => ({
    id: String(s.properties.sheetId),
    title: s.properties.title,
    index: s.properties.index,
  }));
  // Prefer tab named "Billing", fall back to first tab
  return tabs.find(t => t.title.toLowerCase() === 'billing') || tabs[0];
}

// Fetch values from a tab — fetch A:AA to handle sheets with tags in column AA
async function fetchTabValues(sheetId, tabTitle, apiKey) {
  const range = `'${tabTitle}'!A:AA`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    let msg = `Sheets values error ${res.status}`;
    try { msg = JSON.parse(txt).error?.message || msg; } catch(e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return data.values || [];
}

// Auto-detect column indices by scanning header cells. Each role gets
// assigned the FIRST cell whose text matches its matcher — so a sheet
// with "Percentage" columns between Budget/Actual/Overage still ends
// up mapping Budget → the "Budget" cell, not the neighboring
// "Percentage" one. Tag matcher runs first so "Budget Portal Category"
// binds to `tag` and never accidentally satisfies the `budget` matcher.
function detectColumns(headerRow) {
  const cols = {
    name: -1, budget: -1, actual: -1, overage: -1,
    date: -1, funded: -1, notes:  -1, tag:     -1,
  };
  const matchers = [
    { key: 'tag',     re: /budget\s*portal|portal\s*category|portal\s*tag/i },
    { key: 'name',    re: /^\s*(category|item|description|name)\s*$/i },
    { key: 'overage', re: /overages?|variance|difference/i },
    { key: 'actual',  re: /^\s*(actual|spent|committed|paid)/i },
    { key: 'budget',  re: /budget/i },
    { key: 'funded',  re: /funded|funding|source/i },
    { key: 'date',    re: /(draw\s*date|date)/i },
    { key: 'notes',   re: /^\s*(notes?|comment)/i },
  ];
  headerRow.forEach((cell, i) => {
    const text = (cell || '').toString().trim();
    if (!text) return;
    // Percentage columns are visual clutter, never a role we care about
    if (/^\s*(percentage|%)\s*$/i.test(text)) return;
    for (const m of matchers) {
      if (m.re.test(text)) {
        if (cols[m.key] === -1) cols[m.key] = i;
        break;  // one role per column
      }
    }
  });
  return cols;
}

// Parse the billing sheet rows into structured data
function parseBillingData(rows) {
  const result = {
    mainCategories: [],
    totalBudget:    0,
    totalActual:    0,
    totalOverage:   0,
    forecastTotal:  0,
    // Diagnostic — mirrored to admin/debug consumers, harmless to clients
    detectedColumns: null,
  };

  if (!rows.length) return result;

  const headerRow = rows[0] || [];
  const cols = detectColumns(headerRow);
  result.detectedColumns = cols;

  // Sensible fallbacks so a partially-labeled sheet still renders SOMETHING
  const NAME_COL   = cols.name   !== -1 ? cols.name   : 0;
  const BUDGET_COL = cols.budget !== -1 ? cols.budget : 1;
  const ACTUAL_COL = cols.actual !== -1 ? cols.actual : 3;
  const OVER_COL   = cols.overage;
  const DATE_COL   = cols.date;
  const FUNDED_COL = cols.funded;
  const NOTES_COL  = cols.notes;
  // Tag column has a stronger fallback — last column tends to be Z in
  // template-based sheets. Without it we can't classify anything.
  const TAG_COL    = cols.tag !== -1 ? cols.tag : (headerRow.length - 1);

  const cellStr = (row, idx) => (idx >= 0 && row[idx] != null) ? String(row[idx]).trim() : '';
  const cellNum = (row, idx) => (idx >= 0)                     ? parseCurrency(row[idx]) : 0;

  let currentMain = null;

  // Skip the header row (row 0) — it's just labels, not data.
  for (let ri = 1; ri < rows.length; ri++) {
    const row  = rows[ri];
    const tag  = cellStr(row, TAG_COL);
    const name = cellStr(row, NAME_COL);
    if (!name || !tag) continue;
    // Skip a tag cell that's just the header itself (edge case)
    if (/^\s*(budget\s*portal|portal\s*category|portal\s*tag)/i.test(tag)) continue;

    const budget   = cellNum(row, BUDGET_COL);
    const actual   = cellNum(row, ACTUAL_COL);
    const overage  = cellNum(row, OVER_COL);
    const drawDate = DATE_COL >= 0 ? formatDate(row[DATE_COL]) : null;
    const fundedBy = cellStr(row, FUNDED_COL);
    const notes    = cellStr(row, NOTES_COL);

    if (/^\s*main\s*category\s*$/i.test(tag)) {
      if (name.toLowerCase().includes('total')) {
        result.totalBudget  = budget;
        result.totalActual  = actual;
        result.totalOverage = overage;
        currentMain = null;
        continue;
      }
      currentMain = { name, budget, actual, overage,
        pct: budget > 0 ? Math.round(actual / budget * 100) : 0,
        subCategories: [] };
      result.mainCategories.push(currentMain);

    } else if (/^\s*sub\s*main\s*category\s*$/i.test(tag) && currentMain) {
      currentMain.subCategories.push({ name, budget, actual, overage, drawDate, fundedBy, notes });

    } else if (tag.toLowerCase().includes('forecast')) {
      result.forecastTotal = budget;
    }
  }

  // Recalculate totals from categories if sheet totals are 0
  if (result.totalBudget === 0 && result.mainCategories.length > 0) {
    result.totalBudget  = result.mainCategories.reduce((s, c) => s + c.budget, 0);
    result.totalActual  = result.mainCategories.reduce((s, c) => s + c.actual, 0);
    result.totalOverage = result.mainCategories.reduce((s, c) => s + c.overage, 0);
  }
  if (result.forecastTotal === 0) result.forecastTotal = result.totalBudget;

  return result;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const { sheetUrl } = event.queryStringParameters || {};
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Could not parse sheet ID from URL' });

  const apiKey = GS_KEY();
  if (!apiKey) return respond(500, { error: 'GOOGLE_API_KEY not configured in Netlify' });

  // Find the Billing tab
  let tab;
  try {
    tab = await getTabInfo(sheetId, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read spreadsheet: ${err.message}` });
  }

  // Fetch values
  let rows;
  try {
    rows = await fetchTabValues(sheetId, tab.title, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read tab "${tab.title}": ${err.message}` });
  }

  if (!rows.length) {
    return respond(200, { error: 'Billing tab appears empty', tab: tab.title });
  }

  const data = parseBillingData(rows);

  return respond(200, {
    tab:              tab.title,
    mainCategories:   data.mainCategories,
    totalBudget:      data.totalBudget,
    totalActual:      data.totalActual,
    totalOverage:     data.totalOverage,
    forecastTotal:    data.forecastTotal,
    categoryCount:    data.mainCategories.length,
    // Diagnostic — which column index got mapped to which role. Handy for
    // sheet-setup debugging without needing the debug-sheet endpoint.
    detectedColumns:  data.detectedColumns,
  });
};
