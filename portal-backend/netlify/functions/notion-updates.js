// netlify/functions/notion-updates.js
// Manages the update approval workflow
// GET: returns pending drafts + approved updates for a client
// POST: approves a draft update (makes it visible to the client)
// DELETE: removes an approved update

// NOTE: This function uses Netlify Blobs for storage (built-in, no extra setup)
// When Supabase is added in Session 3, this moves to a proper database table

import { getStore } from '@netlify/blobs';

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const clientId = event.queryStringParameters?.clientId;
  if (!clientId) return respond(400, { error: 'clientId query parameter required' });

  const store = getStore({ name: 'portal-updates', consistency: 'strong' });
  const storeKey = `updates-${clientId}`;

  try {
    // ── GET: return updates for client ────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      let data = null;
      try {
        const raw = await store.get(storeKey, { type: 'json' });
        data = raw;
      } catch (e) {
        data = null;
      }

      const updates  = data?.approved || [];
      const drafts   = data?.drafts   || [];

      return respond(200, { updates, drafts });
    }

    // ── POST: approve a draft or post a new manual update ─────────────────────
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action, update, draftIndex } = body;

      let data = null;
      try {
        data = await store.get(storeKey, { type: 'json' });
      } catch (e) { /* first write */ }

      const current = data || { approved: [], drafts: [] };

      if (action === 'approve-draft' && typeof draftIndex === 'number') {
        // Move a draft to approved
        const draft = current.drafts[draftIndex];
        if (!draft) return respond(404, { error: 'Draft not found' });
        const approved = { ...draft, approved: true, approvedAt: new Date().toISOString() };
        current.approved.unshift(approved); // newest first
        current.drafts.splice(draftIndex, 1);

      } else if (action === 'post-update' && update) {
        // Post a manually written update
        current.approved.unshift({
          title: update.title,
          body: update.body,
          date: update.date || new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
          approved: true,
          approvedAt: new Date().toISOString(),
          manual: true,
        });

      } else if (action === 'add-drafts' && Array.isArray(body.drafts)) {
        // Bulk-add auto-generated drafts (called by admin panel after timeline sync)
        const newDrafts = body.drafts.filter(d => {
          // Don't add duplicate drafts (same title)
          return !current.drafts.some(existing => existing.title === d.title)
              && !current.approved.some(existing => existing.title === d.title);
        });
        current.drafts.push(...newDrafts);

      } else {
        return respond(400, { error: 'Invalid action or missing parameters' });
      }

      // Keep only last 50 approved updates
      current.approved = current.approved.slice(0, 50);

      await store.setJSON(storeKey, current);
      return respond(200, { success: true, approved: current.approved, drafts: current.drafts });
    }

    // ── DELETE: remove an approved update ─────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const index = parseInt(event.queryStringParameters?.index || '-1');
      if (index < 0) return respond(400, { error: 'index required' });

      let data = null;
      try {
        data = await store.get(storeKey, { type: 'json' });
      } catch (e) {}

      if (!data) return respond(404, { error: 'No updates found' });

      data.approved.splice(index, 1);
      await store.setJSON(storeKey, data);
      return respond(200, { success: true, approved: data.approved });
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('notion-updates error:', err);
    return respond(500, { error: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}
