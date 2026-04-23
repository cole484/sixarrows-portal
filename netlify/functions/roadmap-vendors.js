// netlify/functions/roadmap-vendors.js
// Selections Roadmap vendor management
//
// GET  /?clientKey=<id>           → returns merged vendor list for all stops
//                                   (per-client overrides in `selections` table with
//                                    suffix='rdm_vendors' take precedence over defaults)
// GET  /?defaults=1               → returns just the global defaults (admin editor)
// POST /?defaults=1               → upsert defaults.  body: { rows: [{id?, stop_id, name, detail, tag, sort_order, is_active}] }
// POST /?defaults=1&delete=<id>   → delete one default row
// POST /?clientKey=<id>           → upsert per-client overrides. body: { overrides: { stop_id: [ {name, detail, tag, sort_order}, ... ] } }
//                                   Pass an empty array for a stop to fall back to defaults for that stop.
// DELETE /?clientKey=<id>         → wipe overrides for a client (revert to defaults)
//
// ── Stop-level settings (touch requirement + why-this-matters copy) ──
// GET  /?stopSettings=1           → all rows from roadmap_stop_settings
// POST /?stopSettings=1           → upsert one or more stop settings.
//                                   body: { rows: [{stop_id, touch, why}] }

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
  };
}

async function fetchDefaults() {
  const url = `${SB_URL()}/rest/v1/roadmap_vendor_defaults?select=*&order=stop_id,sort_order`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`defaults GET: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function fetchOverrides(clientKey) {
  const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${clientKey}&suffix=eq.rdm_vendors&select=data`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) return {};
  const rows = await res.json();
  return rows?.[0]?.data || {};
}

// Group an array of default rows by stop_id, filter inactive, sort by sort_order.
function groupDefaults(rows) {
  const byStop = {};
  (rows || []).forEach(r => {
    if (r.is_active === false) return;
    if (!byStop[r.stop_id]) byStop[r.stop_id] = [];
    byStop[r.stop_id].push({
      name:       r.name,
      detail:     r.detail || '',
      tag:        r.tag || null,
      sort_order: r.sort_order || 0,
    });
  });
  Object.keys(byStop).forEach(k => byStop[k].sort((a,b) => (a.sort_order||0) - (b.sort_order||0)));
  return byStop;
}

// Merge: for each stop, use the client's override if present, else the default group.
function mergeVendors(defaultsByStop, overrides) {
  const out = { ...defaultsByStop };
  Object.entries(overrides || {}).forEach(([stopId, arr]) => {
    if (Array.isArray(arr) && arr.length > 0) {
      const sorted = [...arr].sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
      out[stopId] = sorted.map(v => ({
        name:       v.name,
        detail:     v.detail || '',
        tag:        v.tag || null,
        sort_order: v.sort_order || 0,
      }));
    }
    // empty array → drop the override, fall back to defaults (no-op here because out already has defaults)
  });
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (!SB_URL() || !SB_KEY()) {
    return respond(503, { error: 'Supabase not configured' });
  }

  const qs = event.queryStringParameters || {};
  const isDefaultsMode     = qs.defaults === '1';
  const isStopSettingsMode = qs.stopSettings === '1';
  const clientKey = qs.clientKey || null;

  try {
    // ── GET ──────────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      if (isStopSettingsMode) {
        const url = `${SB_URL()}/rest/v1/roadmap_stop_settings?select=*&order=stop_id`;
        const res = await fetch(url, { headers: sbHeaders() });
        if (!res.ok) throw new Error(`stop_settings GET: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        return respond(200, { rows });
      }
      if (isDefaultsMode) {
        const rows = await fetchDefaults();
        return respond(200, { rows });
      }
      if (!clientKey) return respond(400, { error: 'clientKey or defaults=1 required' });

      const [rows, overrides, settingsRes] = await Promise.all([
        fetchDefaults(),
        fetchOverrides(clientKey),
        fetch(`${SB_URL()}/rest/v1/roadmap_stop_settings?select=*`, { headers: sbHeaders() }),
      ]);
      const defaultsByStop = groupDefaults(rows);
      const merged = mergeVendors(defaultsByStop, overrides);
      const stopSettings = {};
      if (settingsRes.ok) {
        const sRows = await settingsRes.json();
        (sRows || []).forEach(r => { stopSettings[r.stop_id] = { touch: r.touch, why: r.why || '' }; });
      }
      return respond(200, {
        clientKey,
        vendorsByStop: merged,
        overrideStopIds: Object.keys(overrides || {}),
        stopSettings,
      });
    }

    // ── POST ─────────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      // Stop settings edit (admin)
      if (isStopSettingsMode) {
        const rows = body.rows || (body.row ? [body.row] : []);
        if (!rows.length) return respond(400, { error: 'rows required' });
        // Upsert each (stop_id is PK)
        const upUrl = `${SB_URL()}/rest/v1/roadmap_stop_settings?on_conflict=stop_id`;
        const payload = rows.map(r => ({
          stop_id: r.stop_id,
          touch:   (r.touch || 'rec'),
          why:     r.why || '',
          updated_at: new Date().toISOString(),
        }));
        const res = await fetch(upUrl, {
          method: 'POST',
          headers: { ...sbHeaders(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`stop_settings upsert: ${res.status} ${await res.text()}`);
        return respond(200, { success: true, saved: payload.length });
      }

      // Defaults edit (admin)
      if (isDefaultsMode) {
        // Single-row delete via ?delete=<id>
        if (qs.delete) {
          const delUrl = `${SB_URL()}/rest/v1/roadmap_vendor_defaults?id=eq.${qs.delete}`;
          const res = await fetch(delUrl, { method: 'DELETE', headers: sbHeaders() });
          if (!res.ok) throw new Error(`delete: ${res.status} ${await res.text()}`);
          return respond(200, { success: true });
        }

        const rows = body.rows || (body.row ? [body.row] : []);
        if (!rows.length) return respond(400, { error: 'rows required' });

        // Split new rows (no id) from updates (have id)
        const inserts = rows.filter(r => !r.id).map(r => ({
          stop_id:    r.stop_id,
          name:       r.name,
          detail:     r.detail || '',
          tag:        r.tag || null,
          sort_order: r.sort_order ?? 0,
          is_active:  r.is_active !== false,
        }));
        const updates = rows.filter(r => r.id);

        if (inserts.length) {
          const insUrl = `${SB_URL()}/rest/v1/roadmap_vendor_defaults`;
          const res = await fetch(insUrl, {
            method: 'POST',
            headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
            body: JSON.stringify(inserts),
          });
          if (!res.ok) throw new Error(`insert: ${res.status} ${await res.text()}`);
        }

        // Update each by id (PATCH)
        for (const u of updates) {
          const upUrl = `${SB_URL()}/rest/v1/roadmap_vendor_defaults?id=eq.${u.id}`;
          const patch = {};
          ['stop_id','name','detail','tag','sort_order','is_active'].forEach(k => {
            if (u[k] !== undefined) patch[k] = u[k];
          });
          const res = await fetch(upUrl, {
            method: 'PATCH',
            headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
            body: JSON.stringify(patch),
          });
          if (!res.ok) throw new Error(`update: ${res.status} ${await res.text()}`);
        }
        return respond(200, { success: true, inserted: inserts.length, updated: updates.length });
      }

      // Per-client overrides
      if (!clientKey) return respond(400, { error: 'clientKey required' });
      const overrides = body.overrides || {};
      const upUrl = `${SB_URL()}/rest/v1/selections?on_conflict=client_id%2Csuffix`;
      const res = await fetch(upUrl, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify({
          client_id: clientKey,
          suffix: 'rdm_vendors',
          data: overrides,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`overrides upsert: ${res.status} ${await res.text()}`);
      return respond(200, { success: true });
    }

    // ── DELETE ───────────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      if (!clientKey) return respond(400, { error: 'clientKey required' });
      const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${clientKey}&suffix=eq.rdm_vendors`;
      const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
      if (!res.ok) throw new Error(`override delete: ${res.status}`);
      return respond(200, { success: true });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('roadmap-vendors error:', err.message);
    return respond(500, { error: err.message });
  }
};
