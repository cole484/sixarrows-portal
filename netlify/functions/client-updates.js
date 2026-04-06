// netlify/functions/client-updates.js
// Manages project updates via Supabase
// GET    ?clientId=X            — approved updates for client portal
// GET    ?clientId=X&drafts=1   — unapproved AI drafts for admin review
// POST   ?clientId=X            — post a manual approved update
// PATCH  ?clientId=X&draftId=Y  — approve a draft (optionally with edited body)
// DELETE ?clientId=X&updateId=Y — delete any update

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const q        = event.queryStringParameters || {};
  const clientId = q.clientId;
  if (!clientId) return respond(400, { error: 'clientId required' });

  // ── GET: approved updates (client portal) or drafts (admin) ─────────────
  if (event.httpMethod === 'GET') {
    try {
      const isDrafts = q.drafts === '1';
      const filter   = isDrafts
        ? `client_id=eq.${clientId}&approved=eq.false&order=created_at.desc&select=*`
        : `client_id=eq.${clientId}&approved=eq.true&order=created_at.desc&select=*`;

      const url = `${SB_URL()}/rest/v1/updates?${filter}`;
      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase GET updates: ${res.status}`);
      const rows = await res.json();

      if (isDrafts) return respond(200, { drafts: rows || [] });
      // Map Supabase rows to the shape the portal expects
      const updates = (rows || []).map(r => ({
        id:    r.id,
        date:  r.date || new Date(r.created_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
        title: r.title,
        body:  r.body,
      }));
      return respond(200, { updates });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── POST: manual update (always approved immediately) ────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { title, updateBody, date } = body;
      if (!title || !updateBody) return respond(400, { error: 'title and updateBody required' });

      const url = `${SB_URL()}/rest/v1/updates`;
      const res = await fetch(url, {
        method:  'POST',
        headers: sbHeaders(),
        body:    JSON.stringify({
          client_id:   clientId,
          title,
          body:        updateBody,
          date:        date || new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
          approved:    true,
          approved_at: new Date().toISOString(),
          manual:      true,
          update_type: 'manual',
        }),
      });
      if (!res.ok) throw new Error(`Supabase POST updates: ${res.status} ${await res.text()}`);
      const created = await res.json();
      return respond(200, { success: true, update: created?.[0] });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── PATCH: approve a draft — optionally update body first ────────────────
  if (event.httpMethod === 'PATCH') {
    const draftId = q.draftId;
    if (!draftId) return respond(400, { error: 'draftId required' });
    try {
      const body    = JSON.parse(event.body || '{}');
      const now     = new Date().toISOString();
      const patch   = {
        approved:    true,
        approved_at: now,
      };
      // If admin edited the body before approving, update it
      if (body.body && body.body.trim()) patch.body = body.body.trim();

      const url = `${SB_URL()}/rest/v1/updates?id=eq.${draftId}&client_id=eq.${clientId}`;
      const res = await fetch(url, {
        method:  'PATCH',
        headers: sbHeaders(),
        body:    JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Supabase PATCH update: ${res.status} ${await res.text()}`);
      return respond(200, { success: true });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── DELETE: remove any update ────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const updateId = q.updateId;
    if (!updateId) return respond(400, { error: 'updateId required' });
    try {
      const url = `${SB_URL()}/rest/v1/updates?id=eq.${updateId}&client_id=eq.${clientId}`;
      const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase DELETE update: ${res.status}`);
      return respond(200, { success: true });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed' });
};
