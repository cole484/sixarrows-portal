// netlify/functions/sheet-budget-sync.js
// Reads a client's Google Sheet budget, extracts main category statuses,
// updates Supabase budget_categories table, returns updated statuses
//
// The sheet structure:
//   Column A = Category / line item name
//   Column B = Contractor / Vendor (empty on main category rows)
//   Column C = Status
//
// Main categories are identified by: Col A has text AND Col B is empty
// Status mapping: "Not Started" → pending | "In Progress" → active | "Confirmed" → complete
//
// Requires sheet to be set to "Anyone with link can view"

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

// The 8 main budget categories — used for fuzzy matching
const MAIN_CATEGORIES = [
  'Design & Planning',
  'Construction Costs',
  'Mechanical Systems',
  'Interior Finishes',
  'Exterior Work',
  'Utilities & Hookups',
  'Miscellaneous',
  'Other Costs',
  'Other Costs & Management Fee',
];

// Status value mapping from sheet → Supabase
const STATUS_MAP = {
  'not started':  'pending',
  'in progress':  'active',
  'confirmed':    'complete',
  // Handle variations
  'need estimate': 'pending',
  'pending':       'pending',
  'complete':      'complete',
  'completed':     'complete',
};

function normalizeStatus(raw) {
  if (!raw) return null;
  return STATUS_MAP[raw.toLowerCase().trim()] || null;
}

// Extract Google Sheet ID from URL
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Parse CSV text into array of rows
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    // Simple CSV parse — handles quoted fields
    const cells = [];
    let inQuotes = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
      if (ch === '"' && inQuotes) { inQuotes = false; continue; }
      if (ch === ',' && !inQuotes) { cells.push(cell.trim()); cell = ''; continue; }
      cell += ch;
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  return rows;
}

// Find main category statuses from parsed CSV rows
function extractCategoryStatuses(rows) {
  const statuses = {};

  for (const row of rows) {
    const colA = (row[0] || '').trim();
    const colB = (row[1] || '').trim();
    const colC = (row[2] || '').trim();

    if (!colA || !colC) continue;
    // Skip header row
    if (colA.toLowerCase() === 'category') continue;

    // Main category = col B is empty (no contractor)
    if (colB !== '') continue;

    // Check if col A fuzzy-matches any main category
    const matched = MAIN_CATEGORIES.find(cat => {
      const catLower  = cat.toLowerCase();
      const aLower    = colA.toLowerCase();
      // Match if either contains the other
      return aLower.includes(catLower.split(' ')[0].toLowerCase()) ||
             catLower.includes(aLower.split(' ')[0].toLowerCase()) ||
             aLower === catLower;
    });

    if (matched) {
      const normalized = normalizeStatus(colC);
      if (normalized) {
        // Use the canonical category name from MAIN_CATEGORIES
        statuses[matched] = {
          sheetName:  colA,
          sheetStatus: colC,
          status:      normalized,
        };
      }
    }
  }

  return statuses;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const clientId  = event.queryStringParameters?.clientId;
  const sheetUrl  = event.queryStringParameters?.sheetUrl;

  if (!clientId) return respond(400, { error: 'clientId required' });
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  // Extract sheet ID and build CSV export URL
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Invalid Google Sheet URL' });

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;

  try {
    // Fetch the sheet as CSV
    const sheetRes = await fetch(csvUrl, {
      headers: { 'Accept': 'text/csv' },
      redirect: 'follow',
    });

    if (!sheetRes.ok) {
      return respond(502, {
        error: 'Could not read Google Sheet. Make sure it is set to "Anyone with link can view".',
        status: sheetRes.status,
      });
    }

    const csvText = await sheetRes.text();
    const rows = parseCSV(csvText);
    const categoryStatuses = extractCategoryStatuses(rows);

    if (Object.keys(categoryStatuses).length === 0) {
      return respond(200, {
        synced: 0,
        message: 'No main category statuses found in sheet. Check column A/B/C structure.',
        categories: {},
      });
    }

    // Update Supabase budget_categories for this client
    const sbHeaders = {
      'apikey': SB_KEY(),
      'Authorization': `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
    };

    // Fetch existing categories to get their IDs
    const catsRes = await fetch(
      `${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}&select=id,name,status&order=sort_order.asc`,
      { headers: sbHeaders }
    );

    if (!catsRes.ok) {
      return respond(502, { error: 'Could not fetch budget categories from database' });
    }

    const dbCats = await catsRes.json();
    const updates = [];

    for (const dbCat of dbCats) {
      // Find matching sheet status (fuzzy match on name)
      const match = Object.entries(categoryStatuses).find(([catName]) => {
        const catLower = catName.toLowerCase();
        const dbLower  = dbCat.name.toLowerCase();
        return catLower.includes(dbLower.split(' ')[0].toLowerCase()) ||
               dbLower.includes(catLower.split(' ')[0].toLowerCase()) ||
               dbLower === catLower;
      });

      if (match) {
        const [, { status }] = match;
        if (status !== dbCat.status) {
          // Update this category's status
          const patchRes = await fetch(
            `${SB_URL()}/rest/v1/budget_categories?id=eq.${dbCat.id}`,
            {
              method: 'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ status }),
            }
          );
          if (patchRes.ok) {
            updates.push({ name: dbCat.name, from: dbCat.status, to: status });
          }
        }
      }
    }

    return respond(200, {
      synced: updates.length,
      message: updates.length > 0
        ? `Updated ${updates.length} category status${updates.length > 1 ? 'es' : ''}`
        : 'All categories already up to date',
      updates,
      categories: categoryStatuses,
    });

  } catch (err) {
    console.error('sheet-budget-sync error:', err);
    return respond(500, { error: err.message });
  }
};
