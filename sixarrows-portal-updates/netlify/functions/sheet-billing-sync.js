// netlify/functions/sheet-billing-sync.js
// Reads the Billing tab from a client's Google Sheet using column Z tags
// Returns structured budget data for the construction phase portal
//
// Column Z (index 25) = "Budget Portal Category" header, then:
//   "Main Category"    — top-level groups (Design & Planning, Mech Systems, etc.)
//   "Sub Main Category"— line items under each main category
//   "Total Costs"      — total row (col Z = "Main Category" with "Total" in name)
//   "Forecasted Total" — forecast row
//
// Column mapping:
//   A (0)  = Category name
//   B (1)  = Budgeted Cost
//   D (3)  = Actual Cost
//   F (5)  = Overage (Actual - Budget)
//   G (6)  = Draw Date
//   H (7)  = Funded By
//   J (9)  = Notes
//   Z (25) = Budget Portal Category tag

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

// Fetch values from a tab
async function fetchTabValues(sheetId, tabTitle, apiKey) {
  const range = `'${tabTitle}'!A:Z`;
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

// Parse the billing sheet rows into structured data
function parseBillingData(rows) {
  const result = {
    mainCategories: [],  // { name, budget, actual, overage, pct, subCategories[] }
    totalBudget:    0,
    totalActual:    0,
    totalOverage:   0,
    forecastTotal:  0,
    lastUpdated:    null,
  };

  let currentMain = null;

  for (const row of rows) {
    const tag  = (row[25] || '').toString().trim();
    const name = (row[0]  || '').toString().trim();

    if (!name || !tag || tag === 'Budget Portal Category') continue;

    const budget  = parseCurrency(row[1]);
    const actual  = parseCurrency(row[3]);
    const overage = parseCurrency(row[5]);
    const drawDate = formatDate(row[6]);
    const fundedBy = (row[7] || '').toString().trim();
    const notes    = (row[9] || '').toString().trim();

    if (tag === 'Main Category') {
      // Check if this is the Total row
      if (name.toLowerCase().includes('total')) {
        result.totalBudget  = budget;
        result.totalActual  = actual;
        result.totalOverage = overage;
        currentMain = null;
        continue;
      }
      // Regular main category
      currentMain = {
        name,
        budget,
        actual,
        overage,
        pct: budget > 0 ? Math.round(actual / budget * 100) : 0,
        subCategories: [],
      };
      result.mainCategories.push(currentMain);

    } else if (tag === 'Sub Main Category' && currentMain) {
      currentMain.subCategories.push({
        name,
        budget,
        actual,
        overage,
        drawDate,
        fundedBy,
        notes,
      });

    } else if (tag === 'Forecasted Total') {
      result.forecastTotal = budget; // forecast is in the budget col
    }
  }

  // Recalculate totals from main categories if sheet totals are 0
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
  });
};
