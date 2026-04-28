// netlify/functions/client-schedule.js
// Read-only schedule endpoint for the client portal.
// No admin auth required — mirrors the notion-timeline.js pattern.
//
// GET ?projectId=xxx  — returns schedule data in the same shape
//                       as notion-timeline.js for drop-in replacement

import { respond, corsHeaders, supabase } from './lib/supabase-client.js';

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function statusToGroup(status) {
  switch (status) {
    case 'complete':            return 'completed';
    case 'in_progress':         return 'active';
    case 'scheduled':           return 'scheduled';
    case 'needs_scheduling':    return 'scheduled';
    case 'not_started':         return 'scheduled';
    case 'not_ready':           return 'upcoming';
    case 'waiting_on_client':   return 'waiting';
    case 'on_hold':             return 'on_hold';
    case 'blocked':             return 'needs_scheduling';
    default:                    return 'scheduled';
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'GET only' });
  }

  const projectId = (event.queryStringParameters || {}).projectId;
  if (!projectId) return respond(400, { error: 'projectId required' });

  try {
    // 1. Fetch client
    const client = await supabase('clients', {
      select: 'id,build_start_date,target_end_date,computed_end_date',
      filters: [{ col: 'id', op: 'eq', val: projectId }],
      single: true,
    });
    if (!client) return respond(404, { error: 'Client not found' });

    // 2. Fetch schedule rows
    const rows = await supabase('project_schedule', {
      filters: [{ col: 'project_id', op: 'eq', val: projectId }],
      order: 'sequence_order.asc',
    });

    if (!rows || rows.length === 0) {
      return respond(200, {
        tasks: [], milestones: [],
        totalTasks: 0, completedCount: 0, overallPct: 0,
        activeTask: null, nextMilestone: null,
        buildStart: client.build_start_date,
        targetEnd: client.target_end_date,
        computedEnd: client.computed_end_date,
      });
    }

    // 3. Map to notion-timeline compatible shape
    const allTasks = rows
      .filter(r => r.status !== 'skipped')
      .map(r => ({
        id: r.id,
        name: r.task_name,
        status: r.status,
        group: statusToGroup(r.status),
        startDate: r.planned_start || r.actual_start,
        dateLabel: fmtDate(r.planned_start || r.actual_start),
        phase: r.phase,
        trade: r.trade,
        clientNote: r.client_note || null,
        definitionOfDone: r.definition_of_done || null,
        duration: r.duration_days,
        sequence: r.sequence_order,
        isMilestone: r.is_milestone,
        isGate: r.is_gate,
        selectionsGate: r.selections_gate,
        alertLevel: r.alert_level,
      }));

    // 4. Extract milestones
    const milestones = allTasks
      .filter(t => t.isMilestone || t.isGate)
      .map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        group: t.group,
        startDate: t.startDate,
        dateLabel: t.dateLabel,
        sequence: t.sequence,
      }));

    // 5. Build rolling window: last 3 completed + 1 active + 8 upcoming
    const completed = allTasks.filter(t => t.group === 'completed');
    const active    = allTasks.filter(t => t.group === 'active');
    const upcoming  = allTasks.filter(t => t.group !== 'completed' && t.group !== 'active');

    const windowTasks = [];
    // Last 3 completed
    const recentCompleted = completed.slice(-3);
    recentCompleted.forEach(t => { t.windowRole = 'completed'; windowTasks.push(t); });
    // First active
    if (active.length > 0) {
      active[0].windowRole = 'active';
      windowTasks.push(active[0]);
    }
    // First 8 upcoming
    upcoming.slice(0, 8).forEach(t => { t.windowRole = 'upcoming'; windowTasks.push(t); });

    // 6. Compute stats
    const totalTasks = allTasks.length;
    const completedCount = completed.length;
    const overallPct = totalTasks > 0 ? Math.round(completedCount / totalTasks * 100) : 0;
    const activeTask = active.length > 0 ? active[0] : null;
    const nextMilestone = milestones.find(m => m.group !== 'completed') || null;

    return respond(200, {
      tasks: windowTasks,
      milestones,
      totalTasks,
      completedCount,
      overallPct,
      activeTask,
      nextMilestone,
      buildStart: client.build_start_date,
      targetEnd: client.target_end_date,
      computedEnd: client.computed_end_date,
    });

  } catch (err) {
    console.error('client-schedule error:', err);
    return respond(500, { error: err.message || 'Internal error' });
  }
};
