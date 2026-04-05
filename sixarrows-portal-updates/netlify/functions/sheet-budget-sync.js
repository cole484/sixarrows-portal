// netlify/functions/sheet-budget-sync.js
// Google Sheets API v4 budget sync
// Requires: GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY in Netlify env vars
//
// MODE 1: GET ?clientId=x&sheetUrl=x         → sync statuses
// MODE 2: GET ?clientId=x&sheetUrl=x&syncCategories=1  → import categories from col Z

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
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractGid(url) {
  const m = url.match(/[#&?]gid=(\d+)/);
  return m ? m[1] : null;
}

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
  };
}

// Get all sheet tab names and find the right one by gid
async function getAllTabs(sheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    let msg = `Sheets metadata error ${res.status}`;
    try { msg = JSON.parse(txt).error?.message || msg; } catch(e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.sheets || []).map(s => ({
    id:    String(s.properties.sheetId),
    title: s.properties.title,
    index: s.properties.index,
  }));
}

// Fetch values from a specific tab by name
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

function extractMainCategories(rows) {
  return rows
    .filter(row => (row[25] || '').toString().trim().toLowerCase() === 'main category')
    .map(row => ({
      name:   (row[0] || '').toString().trim(),
      total:  parseFloat((row[3] || '').toString().replace(/[$,\s]/g, '')) || 0,
      status: normalizeStatus((row[2] || '').toString().trim()),
    }))
    .filter(c => c.name);
}

function extractCategoryStatuses(rows) {
  const out = {};
  for (const row of rows) {
    const name = (row[0] || '').toString().trim();
    const tag  = (row[25] || '').toString().trim().toLowerCase();
    if (!name) continue;
    if (tag === 'main category') {
      out[name] = { status: normalizeStatus((row[2] || '').toString().trim()) };
    }
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const { clientId, sheetUrl, syncCategories } = event.queryStringParameters || {};

  if (!clientId) return respond(400, { error: 'clientId required' });
  if (!sheetUrl) return respond(400, { error: 'sheetUrl required' });

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) return respond(400, { error: 'Could not parse sheet ID from URL' });

  const apiKey = GS_KEY();
  if (!apiKey) return respond(500, {
    error: 'GOOGLE_API_KEY not set. Add it in Netlify → Site configuration → Environment variables, then redeploy.',
  });

  // Step 1: get all tabs and find the right one
  let tabs, targetTab;
  try {
    tabs = await getAllTabs(sheetId, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read spreadsheet metadata: ${err.message}` });
  }

  if (tabs.length === 0) {
    return respond(502, { error: 'Spreadsheet has no tabs' });
  }

  // Match by gid if present, otherwise use first tab
  const gid = extractGid(sheetUrl);
  if (gid) {
    targetTab = tabs.find(t => t.id === gid) || tabs[0];
  } else {
    targetTab = tabs[0];
  }

  // Step 2: fetch values from that tab
  let rows;
  try {
    rows = await fetchTabValues(sheetId, targetTab.title, apiKey);
  } catch(err) {
    return respond(502, { error: `Could not read tab "${targetTab.title}": ${err.message}` });
  }

  if (!rows.length) {
    return respond(200, { synced: 0, message: `Tab "${targetTab.title}" appears empty`, categories: [] });
  }

  const hdrs = sbHeaders();

  // MODE 2: import categories
  if (syncCategories === '1') {
    const cats = extractMainCategories(rows);

    if (!cats.length) {
      return respond(200, {
        synced: 0,
        message: `No "Main Category" tags found in column Z of tab "${targetTab.title}". Check the dropdown values.`,
        debug: { tabTitle: targetTab.title, totalRows: rows.length, sampleRow: rows[1] || [] },
      });
    }

    // Delete existing categories
    await fetch(`${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}`, {
      method: 'DELETE', headers: hdrs,
    });

    // Insert fresh from sheet
    const insertRes = await fetch(`${SB_URL()}/rest/v1/budget_categories`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=representation' },
      body: JSON.stringify(cats.map((c, i) => ({
        client_id: clientId, name: c.name, total: c.total,
        spent: 0, status: c.status, sort_order: i + 1, sub_categories: [],
      }))),
    });

    if (!insertRes.ok) {
      return respond(502, { error: `Database insert failed: ${await insertRes.text()}` });
    }

    const inserted = await insertRes.json();
    return respond(200, {
      synced: inserted.length,
      message: `Imported ${inserted.length} categories from "${targetTab.title}"`,
      categories: inserted.map(c => ({ name: c.name, total: c.total, status: c.status })),
    });
  }

  // MODE 1: status sync
  const sheetStatuses = extractCategoryStatuses(rows);

  if (!Object.keys(sheetStatuses).length) {
    return respond(200, { synced: 0, message: 'No tagged category rows found', categories: {} });
  }

  const catsRes = await fetch(
    `${SB_URL()}/rest/v1/budget_categories?client_id=eq.${clientId}&select=id,name,status&order=sort_order.asc`,
    { headers: hdrs }
  );
  if (!catsRes.ok) return respond(502, { error: 'Could not fetch budget categories from database' });

  const dbCats  = await catsRes.json();
  const updates = [];

  for (const dbCat of dbCats) {
    const key = Object.keys(sheetStatuses).find(k =>
      k.toLowerCase() === dbCat.name.toLowerCase() ||
      k.toLowerCase().split(' ')[0] === dbCat.name.toLowerCase().split(' ')[0]
    );
    if (key) {
      const { status } = sheetStatuses[key];
      if (status !== dbCat.status) {
        const pr = await fetch(`${SB_URL()}/rest/v1/budget_categories?id=eq.${dbCat.id}`, {
          method: 'PATCH',
          headers: { ...hdrs, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status }),
        });
        if (pr.ok) updates.push({ name: dbCat.name, from: dbCat.status, to: status });
      }
    }
  }

  return respond(200, {
    synced:  updates.length,
    message: updates.length > 0 ? `Updated ${updates.length} category statuses` : 'All statuses up to date',
    updates,
  });
};
