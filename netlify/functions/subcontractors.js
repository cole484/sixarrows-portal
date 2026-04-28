// netlify/functions/subcontractors.js
// Subcontractor directory CRUD
//
// GET                  — list all subcontractors
// GET    ?id=xxx       — get one sub + task history + aggregated ratings
// POST                 — create subcontractor
// PATCH  ?id=xxx       — update subcontractor
// DELETE ?id=xxx       — delete (checks for active assignments)

import { respond, corsHeaders } from './lib/supabase-client.js';

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

function aggregateRatings(tasks) {
  const dims = ['perf_schedule', 'perf_invoice', 'perf_communication', 'perf_scope', 'perf_cleanliness'];
  const scores = { excellent: 4, good: 3, fair: 2, poor: 1 };
  const summary = {};

  for (const dim of dims) {
    const rated = (tasks || []).filter(t => t[dim] && t[dim] !== 'na');
    if (rated.length === 0) { summary[dim] = null; continue; }
    const avg = rated.reduce((s, t) => s + (scores[t[dim]] || 0), 0) / rated.length;
    const label = avg >= 3.5 ? 'excellent' : avg >= 2.5 ? 'good' : avg >= 1.5 ? 'fair' : 'poor';
    summary[dim] = { average: Math.round(avg * 10) / 10, label, count: rated.length };
  }

  return summary;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Auth check
  const token = (event.headers?.authorization || '').replace('Bearer ', '');
  if (token !== ADMIN_PASSWORD()) return respond(401, { error: 'Unauthorized' });

  const params = event.queryStringParameters || {};

  try {
    // ── GET: list all or fetch one ──
    if (event.httpMethod === 'GET') {
      if (params.id) {
        const [sub, tasks] = await Promise.all([
          sbFetch(`subcontractors?id=eq.${params.id}`).then(r => r?.[0]),
          sbFetch(`project_schedule?subcontractor_id=eq.${params.id}&select=id,task_name,phase,status,project_id,perf_schedule,perf_invoice,perf_communication,perf_scope,perf_cleanliness,perf_notes&order=sequence_order.asc`),
        ]);
        if (!sub) return respond(404, { error: 'Subcontractor not found' });
        const ratings = aggregateRatings(tasks);
        return respond(200, { ...sub, tasks: tasks || [], ratings });
      }

      const subs = await sbFetch('subcontractors?order=name.asc');
      return respond(200, subs || []);
    }

    // ── POST: create ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body.name) return respond(400, { error: 'name required' });

      const row = {
        name: body.name,
        trade: body.trade || null,
        phone: body.phone || null,
        email: body.email || null,
        company: body.company || null,
        is_preferred: body.is_preferred || false,
        notes: body.notes || null,
      };

      const inserted = await sbFetch('subcontractors', { method: 'POST', body: JSON.stringify(row) });
      return respond(200, inserted?.[0] || null);
    }

    // ── PATCH: update ──
    if (event.httpMethod === 'PATCH') {
      if (!params.id) return respond(400, { error: 'id query parameter required' });
      const body = JSON.parse(event.body || '{}');
      const allowed = ['name', 'trade', 'phone', 'email', 'company', 'is_preferred', 'notes'];
      const patch = {};
      for (const k of allowed) { if (body[k] !== undefined) patch[k] = body[k]; }
      if (Object.keys(patch).length === 0) return respond(400, { error: 'No valid fields to update' });

      const result = await sbFetch(`subcontractors?id=eq.${params.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return respond(200, result?.[0] || null);
    }

    // ── DELETE ──
    if (event.httpMethod === 'DELETE') {
      if (!params.id) return respond(400, { error: 'id query parameter required' });

      // Check for active (non-complete) assignments
      const activeTasks = await sbFetch(
        `project_schedule?subcontractor_id=eq.${params.id}&status=neq.complete&select=id,task_name&limit=5`
      );
      if (activeTasks && activeTasks.length > 0) {
        return respond(409, {
          error: 'Cannot delete — subcontractor has active task assignments',
          tasks: activeTasks.map(t => t.task_name),
        });
      }

      await sbFetch(`subcontractors?id=eq.${params.id}`, { method: 'DELETE' });
      return respond(200, { message: 'Subcontractor deleted' });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Subcontractors error:', err);
    return respond(500, { error: err.message || 'Internal error' });
  }
};
