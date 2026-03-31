// netlify/functions/client-updates.js
// Manages project updates via Supabase
// GET    — returns approved updates for a client
// POST   — posts a new approved update (admin)
// DELETE — removes an update by id (admin)

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const clientId = event.queryStringParameters?.clientId;
  if (!clientId) return respond(400, { error: 'clientId required' });

  // ── GET: return approved updates ────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const url = `${SB_URL()}/rest/v1/updates?client_id=eq.${clientId}&approved=eq.true&order=created_at.desc&select=*`;
      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase GET updates: ${res.status}`);
      const updates = await res.json();
      return respond(200, { updates: updates || [] });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── POST: create a new update ───────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { title, updateBody, date } = body;
      if (!title || !updateBody) return respond(400, { error: 'title and updateBody required' });

      const url = `${SB_URL()}/rest/v1/updates`;
      const res = await fetch(url, {
        method: 'POST',
        headers: sbHeaders(),
        body: JSON.stringify({
          client_id:   clientId,
          title,
          body:        updateBody,
          date:        date || new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
          approved:    true,
          approved_at: new Date().toISOString(),
          manual:      true,
        }),
      });
      if (!res.ok) throw new Error(`Supabase POST updates: ${res.status} ${await res.text()}`);
      const created = await res.json();
      return respond(200, { success: true, update: created?.[0] });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── DELETE: remove an update ────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const updateId = event.queryStringParameters?.updateId;
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
