// netlify/functions/visual-selections.js
//
// Plans and pins read/write for the visual selections staff tool, plus
// create and update for pin-authored selection_items.
//
// GET    ?clientKey=X                      → { plans, pins, items }
// POST   ?clientKey=X&action=create_plan    → body: plan fields
// POST   ?clientKey=X&action=update_plan    → body: { id, ...fields }
// POST   ?clientKey=X&action=delete_plan    → body: { id }
// POST   ?clientKey=X&action=create_pin     → body: { plan_id, selection_item_id, x, y, room, created_from }
// POST   ?clientKey=X&action=move_pin       → body: { id, x, y }
// POST   ?clientKey=X&action=delete_pin     → body: { id }
// POST   ?clientKey=X&action=create_item    → body: selection_item fields (source = 'pin')
// POST   ?clientKey=X&action=update_item    → body: { id, ...fields }
// POST   ?clientKey=X&action=sign_upload    → body: { filename, kind }
//
// Coordinates are percentages of plan width and height, 0 to 100. They
// are validated here as well as by a check constraint, because a pixel
// value leaking in would be silently wrong rather than loud.

import { respond, corsHeaders } from './lib/supabase-client.js';

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

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    ...options,
    headers: sbHeaders(options.headers || {}),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const REP = { 'Prefer': 'return=representation' };

function pct(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  if (n < 0 || n > 100) throw new Error(`${name} must be a percentage between 0 and 100, got ${n}`);
  return n;
}

// Only these columns are writable from the browser. Anything else in
// the body is dropped rather than passed through to PostgREST, which
// would 400 on an unknown column and look like a save bug.
const PLAN_FIELDS = ['plan_type', 'label', 'image_url', 'source_url', 'page',
                     'image_width', 'image_height', 'status', 'error', 'sort_order'];
const ITEM_FIELDS = ['category', 'wave', 'room', 'room_id', 'label', 'product',
                     'image_url', 'vendor', 'cost', 'product_link', 'notes', 'detail', 'archived'];

function project(body, allowed) {
  const out = {};
  allowed.forEach(f => {
    if (body[f] !== undefined) out[f] = body[f];
  });
  return out;
}

// A plan or pin must belong to the client named in the query string.
// Without this any client key could edit any other client's plan.
async function assertPlanOwned(planId, clientKey) {
  const rows = await sbFetch(
    `plans?id=eq.${encodeURIComponent(planId)}&client_id=eq.${encodeURIComponent(clientKey)}&select=id`
  );
  if (!rows || !rows.length) throw new Error('Plan not found for this client');
}

async function assertItemOwned(itemId, clientKey) {
  const rows = await sbFetch(
    `selection_items?id=eq.${encodeURIComponent(itemId)}&client_id=eq.${encodeURIComponent(clientKey)}&select=id`
  );
  if (!rows || !rows.length) throw new Error('Selection item not found for this client');
}

async function assertPinOwned(pinId, clientKey) {
  const rows = await sbFetch(
    `pins?id=eq.${encodeURIComponent(pinId)}&select=id,plan_id,plans!inner(client_id)`
    + `&plans.client_id=eq.${encodeURIComponent(clientKey)}`
  );
  if (!rows || !rows.length) throw new Error('Pin not found for this client');
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
  const ck = encodeURIComponent(clientKey);

  try {
    // ── Read everything the editor needs in one round trip ────
    if (event.httpMethod === 'GET') {
      const plans = await sbFetch(
        `plans?client_id=eq.${ck}&select=*&order=sort_order.asc,created_at.asc`
      );
      const items = await sbFetch(
        `selection_items?client_id=eq.${ck}&select=*&order=category.asc,room.asc,label.asc`
      );

      // Pins are reached through their plan, so an empty plan list
      // means there is nothing to fetch.
      let pins = [];
      if (plans && plans.length) {
        const ids = plans.map(p => `"${p.id}"`).join(',');
        pins = await sbFetch(`pins?plan_id=in.(${ids})&select=*&order=created_at.asc`);
      }

      return respond(200, { clientKey, plans: plans || [], pins: pins || [], items: items || [] });
    }

    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'Method not allowed' });
    }

    const action = event.queryStringParameters?.action;
    const body = JSON.parse(event.body || '{}');

    switch (action) {
      // ── Plans ─────────────────────────────────────────────
      case 'create_plan': {
        const row = { client_id: clientKey, ...project(body, PLAN_FIELDS) };
        if (!row.label) return respond(400, { error: 'label required' });
        const saved = await sbFetch('plans', {
          method: 'POST', headers: REP, body: JSON.stringify(row),
        });
        return respond(200, { plan: saved?.[0] || null });
      }

      case 'update_plan': {
        if (!body.id) return respond(400, { error: 'id required' });
        await assertPlanOwned(body.id, clientKey);
        const saved = await sbFetch(`plans?id=eq.${encodeURIComponent(body.id)}`, {
          method: 'PATCH', headers: REP, body: JSON.stringify(project(body, PLAN_FIELDS)),
        });
        return respond(200, { plan: saved?.[0] || null });
      }

      case 'delete_plan': {
        if (!body.id) return respond(400, { error: 'id required' });
        await assertPlanOwned(body.id, clientKey);
        // Pins cascade with the plan. The selection_items they pointed
        // at are left alone, since they belong to the wave data.
        await sbFetch(`plans?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE' });
        return respond(200, { success: true });
      }

      // ── Pins ──────────────────────────────────────────────
      case 'create_pin': {
        if (!body.plan_id || !body.selection_item_id) {
          return respond(400, { error: 'plan_id and selection_item_id required' });
        }
        await assertPlanOwned(body.plan_id, clientKey);
        await assertItemOwned(body.selection_item_id, clientKey);

        const row = {
          plan_id: body.plan_id,
          selection_item_id: body.selection_item_id,
          x: pct(body.x, 'x'),
          y: pct(body.y, 'y'),
          room: body.room || '',
          created_from: body.created_from || null,
        };
        const saved = await sbFetch('pins', {
          method: 'POST', headers: REP, body: JSON.stringify(row),
        });
        return respond(200, { pin: saved?.[0] || null });
      }

      case 'move_pin': {
        if (!body.id) return respond(400, { error: 'id required' });
        await assertPinOwned(body.id, clientKey);
        const saved = await sbFetch(`pins?id=eq.${encodeURIComponent(body.id)}`, {
          method: 'PATCH',
          headers: REP,
          body: JSON.stringify({ x: pct(body.x, 'x'), y: pct(body.y, 'y') }),
        });
        return respond(200, { pin: saved?.[0] || null });
      }

      case 'delete_pin': {
        if (!body.id) return respond(400, { error: 'id required' });
        await assertPinOwned(body.id, clientKey);
        await sbFetch(`pins?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE' });
        return respond(200, { success: true });
      }

      // ── Selection items authored in the pin UI ────────────
      case 'create_item': {
        const fields = project(body, ITEM_FIELDS);
        if (!fields.category) return respond(400, { error: 'category required' });
        if (!fields.label) return respond(400, { error: 'label required' });
        const row = {
          client_id: clientKey,
          item_key: null,      // not derived from the blob, so no key
          source: 'pin',
          ...fields,
        };
        const saved = await sbFetch('selection_items', {
          method: 'POST', headers: REP, body: JSON.stringify(row),
        });
        return respond(200, { item: saved?.[0] || null });
      }

      case 'update_item': {
        if (!body.id) return respond(400, { error: 'id required' });
        await assertItemOwned(body.id, clientKey);
        // Editing an item updates every pin that references it, which
        // is the point of the duplicate-pin model.
        const saved = await sbFetch(`selection_items?id=eq.${encodeURIComponent(body.id)}`, {
          method: 'PATCH', headers: REP, body: JSON.stringify(project(body, ITEM_FIELDS)),
        });
        return respond(200, { item: saved?.[0] || null });
      }

      // ── Signed direct upload ──────────────────────────────
      // The browser has no Supabase credentials, and routing file
      // bytes through this function would hit the request body limit
      // on a real plan set. So it gets a one-shot signed URL and PUTs
      // straight to storage instead.
      case 'sign_upload': {
        const filename = String(body.filename || 'upload');
        const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
        const safeKind = body.kind === 'shot' ? 'shots' : 'plans';
        // crypto.randomUUID is available on the Node 18+ runtime.
        const path = `${clientKey}/${safeKind}/${crypto.randomUUID()}.${ext}`;

        const res = await fetch(
          `${SB_URL()}/storage/v1/object/upload/sign/plans/${path}`,
          { method: 'POST', headers: sbHeaders(), body: JSON.stringify({}) }
        );
        if (!res.ok) {
          throw new Error(`Storage sign: ${res.status} ${await res.text()}`);
        }
        const signed = await res.json();

        // Supabase returns a path-relative signed url including the token.
        const putUrl = `${SB_URL()}/storage/v1${signed.url.startsWith('/') ? '' : '/'}${signed.url}`;
        return respond(200, {
          putUrl,
          path,
          publicUrl: `${SB_URL()}/storage/v1/object/public/plans/${path}`,
        });
      }

      default:
        return respond(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('visual-selections error:', err.message);
    return respond(500, { error: err.message });
  }
};
