// netlify/functions/selection-items-sync.js
//
// Projects the Wave Selections blob into selection_items rows so pins
// have a real uuid to foreign key against.
//
// GET  ?clientKey=X          → sync and return the current item list
// POST ?clientKey=X          → sync only, returns counts
//
// Reconciliation is matched on (client_id, item_key). The key is built
// from ids that do not change, so re-running this is safe and the uuid
// a pin points at stays put.
//
// Field ownership, which is the whole reason this is not a copy:
//   owned by the blob  → category, wave, room, room_id, label,
//                        product, image_url, detail. Refreshed here.
//   owned by the pin UI → vendor, cost, product_link, notes.
//                        Never written by this function.
//
// Items that vanish from the blob are archived rather than deleted, so
// pins pointing at them still resolve and staff can see what happened.

import { respond, corsHeaders } from './lib/supabase-client.js';
import { parseSelections } from '../../portal/lib/parse-selections.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders(extra = {}) {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// The blob stores some suffixes as objects and some as JSON strings,
// depending on which version of the app last wrote them.
function coerce(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    if (!value.trim()) return fallback;
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

// selection_items.client_id references clients(id), but the Wave
// Selections blob is keyed by clients.selections_client_key. They are
// usually the same string and occasionally are not, so resolve rather
// than assume. See the note in CLAUDE.md about p.selectionsClientKey.
async function resolveSelectionsKey(clientId) {
  const url = `${SB_URL()}/rest/v1/clients`
    + `?id=eq.${encodeURIComponent(clientId)}&select=id,selections_client_key`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return clientId;
  const rows = await res.json();
  return rows?.[0]?.selections_client_key || clientId;
}

async function loadBlob(selectionsKey) {
  const url = `${SB_URL()}/rest/v1/selections`
    + `?client_id=eq.${encodeURIComponent(selectionsKey)}&select=suffix,data`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase GET selections: ${res.status} ${await res.text()}`);
  const rows = await res.json();

  const bySuffix = {};
  (rows || []).forEach(r => { bySuffix[r.suffix] = r.data; });

  return {
    answers:          coerce(bySuffix.ans, {}),
    rooms:            coerce(bySuffix.rms, []),
    lightingTypes:    coerce(bySuffix.ltx, {}),
    plumbingFixtures: coerce(bySuffix.pfx, {}),
    fpUnits:          coerce(bySuffix.fpu, []),
    specSel:          coerce(bySuffix.spc, {}),
  };
}

async function loadExisting(clientKey) {
  const url = `${SB_URL()}/rest/v1/selection_items`
    + `?client_id=eq.${encodeURIComponent(clientKey)}&select=*`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase GET selection_items: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Upsert on (client_id, item_key). The on_conflict target goes in the
// URL rather than the Prefer header, which is the form that works
// across PostgREST versions.
async function upsertItems(rows) {
  if (!rows.length) return [];
  const url = `${SB_URL()}/rest/v1/selection_items?on_conflict=client_id%2Citem_key`;
  const res = await fetch(url, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert selection_items: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function setArchived(ids, archived) {
  if (!ids.length) return;
  const inList = ids.map(id => `"${id}"`).join(',');
  const url = `${SB_URL()}/rest/v1/selection_items?id=in.(${inList})`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders({ 'Prefer': 'return=minimal' }),
    body: JSON.stringify({ archived }),
  });
  if (!res.ok) throw new Error(`Supabase archive selection_items: ${res.status} ${await res.text()}`);
}

export async function syncClient(clientKey) {
  const selectionsKey = await resolveSelectionsKey(clientKey);
  const blob = await loadBlob(selectionsKey);
  const parsed = parseSelections(blob);
  const existing = await loadExisting(clientKey);

  const existingByKey = new Map();
  existing.forEach(row => {
    if (row.item_key) existingByKey.set(row.item_key, row);
  });

  // Only the blob-owned columns are written. Leaving vendor, cost,
  // product_link and notes out of the payload is what keeps the
  // merge-duplicates upsert from clobbering pin-authored data.
  const rows = parsed.map(item => ({
    client_id: clientKey,
    item_key:  item.key,
    source:    'wave',
    category:  item.category,
    wave:      item.wave,
    room:      item.room || '',
    room_id:   item.roomId || '',
    label:     item.label || '',
    product:   item.product || '',
    image_url: item.imageUrl || '',
    detail:    item.detail || {},
    archived:  false,
  }));

  const saved = await upsertItems(rows);

  // Anything derived before but absent now gets archived. Pin-authored
  // rows have a null item_key and are never touched here.
  const liveKeys = new Set(parsed.map(i => i.key));
  const toArchive = existing
    .filter(r => r.item_key && !liveKeys.has(r.item_key) && !r.archived)
    .map(r => r.id);
  await setArchived(toArchive, true);

  return {
    selectionsKey,
    parsed: parsed.length,
    upserted: saved.length || rows.length,
    created: rows.filter(r => !existingByKey.has(r.item_key)).length,
    archived: toArchive.length,
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (!SB_URL() || !SB_KEY()) {
    return respond(503, { error: 'Storage not configured' });
  }

  const clientKey = event.queryStringParameters?.clientKey;
  if (!clientKey) return respond(400, { error: 'clientKey required' });

  try {
    const stats = await syncClient(clientKey);

    if (event.httpMethod === 'GET') {
      const url = `${SB_URL()}/rest/v1/selection_items`
        + `?client_id=eq.${encodeURIComponent(clientKey)}&select=*`
        + `&order=category.asc,room.asc,label.asc`;
      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase GET selection_items: ${res.status}`);
      return respond(200, { clientKey, stats, items: await res.json() });
    }

    return respond(200, { clientKey, stats });
  } catch (err) {
    console.error('selection-items-sync error:', err.message);
    return respond(500, { error: err.message });
  }
};
