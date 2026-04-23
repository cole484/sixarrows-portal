// netlify/functions/action-items.js
// Action Queue API — feeds the PM's "Today" view.
//
// GET    ?projectId=xxx&status=open        — list items for a project
// GET    ?projectId=xxx                    — same (default: open)
// POST                                     — create a test/manual item
// PATCH  ?id=xxx&action=complete           — mark completed
// PATCH  ?id=xxx&action=snooze&until=ISO   — snooze until timestamp
// PATCH  ?id=xxx&action=dismiss            — dismiss (soft-archive)

import { respond, corsHeaders } from './lib/supabase-client.js';
import { createActionItem, closeActionItem, logEventSafe } from './lib/events.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';

function sbHeaders(prefer) {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    'Prefer': prefer || 'return=representation',
  };
}

async function sbFetch(path, options = {}) {
  const mergedHeaders = { ...sbHeaders(options.prefer), ...(options.headers || {}) };
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { ...options, headers: mergedHeaders });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function checkAuth(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === ADMIN_PASSWORD();
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (!checkAuth(event)) return respond(401, { error: 'Unauthorized' });

  try {
    const params = event.queryStringParameters || {};
    const projectId = params.projectId;

    if (event.httpMethod === 'GET') {
      if (!projectId) return respond(400, { error: 'projectId required' });
      const status = params.status || 'open';

      // Auto-unsnooze: any snoozed items whose snoozed_until has passed become open again.
      const now = new Date().toISOString();
      await sbFetch(
        `action_items?status=eq.snoozed&snoozed_until=lte.${encodeURIComponent(now)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'open', snoozed_until: null }), prefer: 'return=minimal' }
      );

      const items = await sbFetch(
        `action_items?project_id=eq.${encodeURIComponent(projectId)}&status=eq.${status}&order=priority.asc,created_at.desc`
      );
      return respond(200, { items: items || [] });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body.projectId || !body.kind || !body.title) {
        return respond(400, { error: 'projectId, kind, title required' });
      }
      const created = await createActionItem({
        projectId: body.projectId,
        kind: body.kind,
        title: body.title,
        body: body.body,
        priority: body.priority,
        taskId: body.taskId,
        relatedEntityType: body.relatedEntityType,
        relatedEntityId: body.relatedEntityId,
        dueAt: body.dueAt,
        dedupeKey: body.dedupeKey,
      });
      return respond(201, { item: created });
    }

    if (event.httpMethod === 'PATCH') {
      const id = params.id;
      const action = params.action;
      if (!id || !action) return respond(400, { error: 'id and action required' });

      if (action === 'complete') {
        await closeActionItem({ id, completedBy: 'pm' });
        return respond(200, { ok: true });
      }
      if (action === 'snooze') {
        const until = params.until || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        await sbFetch(`action_items?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'snoozed', snoozed_until: until }),
          prefer: 'return=minimal',
        });
        return respond(200, { ok: true, snoozed_until: until });
      }
      if (action === 'dismiss') {
        await sbFetch(`action_items?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'dismissed', completed_at: new Date().toISOString(), completed_by: 'pm' }),
          prefer: 'return=minimal',
        });
        return respond(200, { ok: true });
      }
      return respond(400, { error: `Unknown action: ${action}` });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('action-items error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};
