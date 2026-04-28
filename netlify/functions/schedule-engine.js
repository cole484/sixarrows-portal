// netlify/functions/schedule-engine.js
// Construction Scheduling Engine v2 — CPM, CRUD, dependencies, notes
//
// POST  ?projectId=xxx&action=instantiate   — Create schedule from templates
// GET   ?projectId=xxx&action=calculate     — Run CPM forward/backward pass
// GET   ?projectId=xxx&action=schedule      — Read-only fetch of schedule
// POST  ?projectId=xxx&action=validate      — Run sequencing rule validator
// PATCH ?projectId=xxx&action=update-task   — Update task fields + recalc CPM
// POST  ?projectId=xxx&action=add-task      — Add a custom task
// POST  ?projectId=xxx&action=delete-task   — Delete a task
// POST  ?projectId=xxx&action=add-dep       — Add a dependency edge
// POST  ?projectId=xxx&action=remove-dep    — Remove a dependency edge
// POST  ?projectId=xxx&action=add-note      — Add a task note
// GET   ?projectId=xxx&action=get-notes&taskId=yyy — Get notes for a task

import { respond, corsHeaders } from './lib/supabase-client.js';
import { logEventSafe } from './lib/events.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';

// ── Supabase helpers ───────────────────────────────────────

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
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    ...options,
    headers: mergedHeaders,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Date arithmetic (calendar days, no weekends) ───────────

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function subtractDays(dateStr, days) {
  return addDays(dateStr, -days);
}

function daysBetween(a, b) {
  return Math.round(
    (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000
  );
}

function maxDate(...dates) {
  const valid = dates.filter(Boolean);
  return valid.length ? valid.sort().pop() : null;
}

function minDate(...dates) {
  const valid = dates.filter(Boolean);
  return valid.length ? valid.sort().shift() : null;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── Selection gate resolution ──────────────────────────────

async function resolveGates(projectId) {
  const clientKey = projectId;
  const rows = await sbFetch(
    `selections?client_id=eq.${encodeURIComponent(clientKey)}&select=suffix,data`
  );

  const sel = {};
  for (const row of (rows || [])) {
    sel[row.suffix] = row.data || {};
  }

  const sav = sel.sav || {};
  const ans = sel.ans || {};

  return {
    fireplace:         !!(ans.fireplace_fp_want && ans.fireplace_fp_want !== ''),
    appliances:        sav.appliances === true,
    exterior_finishes: sav.exterior_finishes === true,
    plumbing:          sav.plumbing === true,
    lighting:          sav.lighting === true,
    countertops:       !!(ans.countertops_ct_kit && ans.countertops_ct_product),
    hardware:          sav.hardware === true,
    doors:             sav.doors === true,
    tile:              sav.tile === true,
    flooring:          sav.flooring === true,
    paint:             sav.paint === true,
  };
}

// ── Sequencing validation rules ────────────────────────────

const SEQUENCING_RULES = [
  { before: 'Insulation install',           after: 'Insulation inspection',        message: 'Insulation must be inspected before closing walls' },
  { before: 'Insulation inspection',        after: 'Drywall hang',                 message: 'Insulation inspection must pass before drywall' },
  { before: 'Drywall sanding & prime coat', after: 'Cabinet install',              message: 'Cabinets should install after drywall is primed' },
  { before: 'Cabinet install',              after: 'Countertop template & install', message: 'Countertops require cabinets installed first' },
  { before: 'Drywall sanding & prime coat', after: 'Tile install',                message: 'Tile should install after drywall in wet areas' },
  { before: 'Tile install',                 after: 'Hardwood / flooring install',  message: 'Tile before hardwood to protect finish floors' },
  { before: 'Interior trim & millwork',     after: 'Paint finish coats',           message: 'Trim must be installed before finish paint coats' },
  { before: 'Interior door hang',           after: 'Paint finish coats',           message: 'Doors must be hung before finish paint coats' },
  { before: 'MEP rough-in inspection',      after: 'Insulation install',           message: 'MEP inspection must pass before insulation' },
  { before: 'Framing inspection',           after: 'Plumbing rough-in',            message: 'Framing inspection required before plumbing rough-in' },
  { before: 'Framing inspection',           after: 'Electrical rough-in',          message: 'Framing inspection required before electrical rough-in' },
  { before: 'Framing inspection',           after: 'HVAC rough-in',               message: 'Framing inspection required before HVAC rough-in' },
];

// ── CPM Engine ─────────────────────────────────────────────

async function runCPM(projectId) {
  // 1. Load data
  const [client, allTasks, deps] = await Promise.all([
    sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}&select=*`).then(r => r?.[0]),
    sbFetch(`project_schedule?project_id=eq.${encodeURIComponent(projectId)}&order=sequence_order.asc`),
    sbFetch(`task_dependencies?project_id=eq.${encodeURIComponent(projectId)}`),
  ]);

  if (!client) throw { status: 404, message: `Client not found: ${projectId}` };
  if (!client.build_start_date) throw { status: 400, message: 'build_start_date not set on client' };
  if (!allTasks || allTasks.length === 0) throw { status: 404, message: 'No schedule found for project' };

  const buildStart = client.build_start_date;
  const targetEnd = client.target_end_date;

  // 2. Handle skipped tasks — rewire dependencies
  const skippedIds = new Set(allTasks.filter(t => t.status === 'skipped').map(t => t.id));
  const tasks = allTasks.filter(t => t.status !== 'skipped');
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  let edges = (deps || []).filter(
    d => !skippedIds.has(d.task_id) || !skippedIds.has(d.blocked_by_task_id)
  );

  for (const sid of skippedIds) {
    const predsOfSkipped = (deps || []).filter(d => d.task_id === sid).map(d => d.blocked_by_task_id).filter(id => !skippedIds.has(id));
    const succsOfSkipped = (deps || []).filter(d => d.blocked_by_task_id === sid).map(d => d.task_id).filter(id => !skippedIds.has(id));
    for (const succ of succsOfSkipped) {
      for (const pred of predsOfSkipped) {
        edges.push({ task_id: succ, blocked_by_task_id: pred });
      }
    }
  }

  edges = edges.filter(d => !skippedIds.has(d.task_id) && !skippedIds.has(d.blocked_by_task_id));

  // 3. Build adjacency
  const predecessors = new Map();
  const successors = new Map();
  for (const t of tasks) {
    predecessors.set(t.id, new Set());
    successors.set(t.id, new Set());
  }
  for (const d of edges) {
    if (taskMap.has(d.task_id) && taskMap.has(d.blocked_by_task_id)) {
      predecessors.get(d.task_id).add(d.blocked_by_task_id);
      successors.get(d.blocked_by_task_id).add(d.task_id);
    }
  }

  // 4. Topological sort (Kahn's algorithm)
  const inDegree = new Map();
  for (const t of tasks) inDegree.set(t.id, predecessors.get(t.id).size);

  const queue = [];
  for (const t of tasks) { if (inDegree.get(t.id) === 0) queue.push(t); }

  const sorted = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a.sequence_order - b.sequence_order);
    const t = queue.shift();
    sorted.push(t);
    for (const sId of successors.get(t.id)) {
      inDegree.set(sId, inDegree.get(sId) - 1);
      if (inDegree.get(sId) === 0) queue.push(taskMap.get(sId));
    }
  }

  if (sorted.length !== tasks.length) {
    const remaining = tasks.filter(t => !sorted.find(s => s.id === t.id)).map(t => t.task_name);
    throw { status: 422, message: 'Cycle detected in dependency graph', tasks: remaining };
  }

  // 5. Forward pass
  const ES = new Map();
  const EF = new Map();

  for (const task of sorted) {
    if (task.status === 'complete' && task.actual_finish) {
      ES.set(task.id, task.actual_start || task.planned_start || buildStart);
      EF.set(task.id, task.actual_finish);
      continue;
    }
    if (task.status === 'in_progress' && task.actual_start) {
      ES.set(task.id, task.actual_start);
      EF.set(task.id, addDays(task.actual_start, task.duration_days));
      continue;
    }

    const preds = predecessors.get(task.id);
    if (preds.size === 0) {
      ES.set(task.id, buildStart);
    } else {
      const predFinishes = [...preds].map(p => EF.get(p)).filter(Boolean);
      ES.set(task.id, predFinishes.length > 0 ? maxDate(...predFinishes) : buildStart);
    }
    EF.set(task.id, addDays(ES.get(task.id), task.duration_days));
  }

  // 6. Backward pass
  const projectEnd = targetEnd || maxDate(...[...EF.values()]);
  const LS = new Map();
  const LF = new Map();

  for (const task of [...sorted].reverse()) {
    const succs = successors.get(task.id);
    if (succs.size === 0) {
      LF.set(task.id, projectEnd);
    } else {
      const succStarts = [...succs].map(s => LS.get(s)).filter(Boolean);
      LF.set(task.id, succStarts.length > 0 ? minDate(...succStarts) : projectEnd);
    }
    LS.set(task.id, subtractDays(LF.get(task.id), task.duration_days));
  }

  // 7. Float and critical path
  const criticalPath = [];
  const floatMap = new Map();
  for (const task of sorted) {
    const float = daysBetween(ES.get(task.id), LS.get(task.id));
    floatMap.set(task.id, float);
    if (float === 0) criticalPath.push(task.id);
  }

  // 8. Selection gate resolution
  const gateStatus = await resolveGates(projectId);

  // 9. Alert computation
  const now = today();
  const alerts = { red: [], yellow: [] };

  for (const task of sorted) {
    if (task.status === 'complete' || task.status === 'skipped') continue;

    task.planned_start = ES.get(task.id);
    task.planned_finish = EF.get(task.id);
    task.must_schedule_by = task.lead_time_days > 0
      ? subtractDays(ES.get(task.id), task.lead_time_days)
      : null;

    task.alert_level = 'none';

    const daysToStart = daysBetween(now, task.planned_start);
    const daysToMSB = task.must_schedule_by ? daysBetween(now, task.must_schedule_by) : Infinity;

    // Red: start within 7 days and contractor not confirmed
    if (daysToStart <= 7 && !task.contractor_confirmed) {
      task.alert_level = 'red';
      alerts.red.push({ taskId: task.id, taskName: task.task_name, reason: `Starts in ${daysToStart} days, contractor not confirmed` });
    }

    // Red: selection gate unresolved
    if (task.selections_gate && !gateStatus[task.selections_gate]) {
      task.alert_level = 'red';
      alerts.red.push({ taskId: task.id, taskName: task.task_name, reason: `Selection gate "${task.selections_gate}" not resolved` });
    }

    // Red: waiting_on_client past must_schedule_by
    if (task.status === 'waiting_on_client' && task.must_schedule_by && task.must_schedule_by < now) {
      task.alert_level = 'red';
      alerts.red.push({ taskId: task.id, taskName: task.task_name, reason: `Waiting on client — must_schedule_by ${task.must_schedule_by} has passed` });
    }

    // Yellow: must_schedule_by within 14 days and no contractor assigned
    if (task.alert_level === 'none' && daysToMSB <= 14 && !task.subcontractor_id && !task.assigned_contractor) {
      task.alert_level = 'yellow';
      alerts.yellow.push({ taskId: task.id, taskName: task.task_name, reason: `Must schedule by ${task.must_schedule_by}, no contractor assigned` });
    }

    // Yellow: needs_scheduling with imminent must_schedule_by
    if (task.alert_level === 'none' && task.status === 'needs_scheduling' && daysToMSB <= 14) {
      task.alert_level = 'yellow';
      alerts.yellow.push({ taskId: task.id, taskName: task.task_name, reason: `Needs scheduling — must schedule by ${task.must_schedule_by}` });
    }

    // Yellow: not_ready with imminent start
    if (task.alert_level === 'none' && task.status === 'not_ready' && daysToStart <= 21) {
      task.alert_level = 'yellow';
      alerts.yellow.push({ taskId: task.id, taskName: task.task_name, reason: `Not ready — planned start in ${daysToStart} days` });
    }
  }

  // 10. Persist computed values
  const updates = sorted
    .filter(t => t.status !== 'complete')
    .map(task =>
      sbFetch(`project_schedule?id=eq.${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          planned_start: task.planned_start,
          planned_finish: task.planned_finish,
          must_schedule_by: task.must_schedule_by,
          alert_level: task.alert_level,
        }),
      })
    );

  const computedEnd = maxDate(...[...EF.values()]);
  updates.push(
    sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ computed_end_date: computedEnd }),
    })
  );

  await Promise.all(updates);

  // 11. Return
  return {
    projectId,
    buildStart,
    targetEnd: targetEnd || null,
    computedEnd,
    taskCount: sorted.length,
    criticalPathLength: criticalPath.length,
    tasks: sorted.map(t => ({
      id: t.id,
      taskName: t.task_name,
      phase: t.phase,
      trade: t.trade,
      workstream: t.workstream,
      sequenceOrder: t.sequence_order,
      durationDays: t.duration_days,
      leadTimeDays: t.lead_time_days,
      isLongLead: t.is_long_lead,
      isMilestone: t.is_milestone,
      isGate: t.is_gate,
      status: t.status,
      plannedStart: t.planned_start,
      plannedFinish: t.planned_finish,
      actualStart: t.actual_start || null,
      actualFinish: t.actual_finish || null,
      subcontractorId: t.subcontractor_id || null,
      assignedContractor: t.assigned_contractor || null,
      contractorConfirmed: t.contractor_confirmed,
      selectionsGate: t.selections_gate || null,
      mustScheduleBy: t.must_schedule_by,
      alertLevel: t.alert_level,
      float: floatMap.get(t.id),
      isCritical: criticalPath.includes(t.id),
      clientNote: t.client_note || null,
      internalNote: t.internal_note || null,
      definitionOfDone: t.definition_of_done || null,
      perfSchedule: t.perf_schedule || null,
      perfInvoice: t.perf_invoice || null,
      perfCommunication: t.perf_communication || null,
      perfScope: t.perf_scope || null,
      perfCleanliness: t.perf_cleanliness || null,
      perfNotes: t.perf_notes || null,
    })),
    criticalPath,
    alerts,
    gateStatus,
    dependencies: edges.map(d => ({ taskId: d.task_id, blockedByTaskId: d.blocked_by_task_id })),
  };
}

// ── Action handlers ────────────────────────────────────────

async function handleInstantiate(projectId) {
  const client = await sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}&select=*`).then(r => r?.[0]);
  if (!client) return respond(404, { error: `Client not found: ${projectId}` });
  if (!client.build_start_date) return respond(400, { error: 'Set build_start_date on client before instantiating schedule' });

  const existing = await sbFetch(`project_schedule?project_id=eq.${encodeURIComponent(projectId)}&select=id&limit=1`);
  if (existing && existing.length > 0) {
    return respond(409, { error: 'Schedule already exists for this project. Delete existing schedule first.' });
  }

  const templates = await sbFetch('task_templates?order=sequence_order.asc');
  if (!templates || templates.length === 0) {
    return respond(500, { error: 'No task templates found. Run seed-task-templates.sql first.' });
  }

  const activeWS = new Set(client.active_workstreams || ['exterior', 'interior']);
  const filtered = templates.filter(t => {
    if (!t.workstream || t.workstream === 'both') return true;
    return activeWS.has(t.workstream);
  });

  const scheduleRows = filtered.map(t => ({
    project_id: projectId,
    template_task_id: t.id,
    task_name: t.task_name,
    phase: t.phase,
    trade: t.trade,
    workstream: t.workstream,
    duration_days: t.default_duration_days,
    lead_time_days: t.lead_time_days,
    is_long_lead: t.is_long_lead,
    is_milestone: t.is_milestone,
    is_gate: t.is_gate,
    sequence_order: t.sequence_order,
    status: 'needs_scheduling',
    internal_scope: t.internal_scope,
    contractor_scope: t.contractor_scope,
    client_scope: t.client_scope,
    definition_of_done: t.definition_of_done,
    selections_gate: t.selections_gate,
  }));

  const inserted = await sbFetch('project_schedule', { method: 'POST', body: JSON.stringify(scheduleRows) });
  if (!inserted || inserted.length === 0) return respond(500, { error: 'Failed to insert schedule rows' });

  const templateToSchedule = new Map();
  for (const row of inserted) {
    if (row.template_task_id) templateToSchedule.set(row.template_task_id, row.id);
  }

  const depRows = [];
  for (const tmpl of filtered) {
    if (!tmpl.default_blocked_by || tmpl.default_blocked_by.length === 0) continue;
    const scheduleId = templateToSchedule.get(tmpl.id);
    if (!scheduleId) continue;
    for (const blockerTemplateId of tmpl.default_blocked_by) {
      const blockerScheduleId = templateToSchedule.get(blockerTemplateId);
      if (!blockerScheduleId) continue;
      depRows.push({ project_id: projectId, task_id: scheduleId, blocked_by_task_id: blockerScheduleId });
    }
  }

  if (depRows.length > 0) {
    await sbFetch('task_dependencies', { method: 'POST', body: JSON.stringify(depRows) });
  }

  const result = await runCPM(projectId);
  return respond(200, { message: 'Schedule instantiated', ...result });
}

async function handleCalculate(projectId) {
  const result = await runCPM(projectId);
  return respond(200, result);
}

async function handleGetSchedule(projectId) {
  const [client, tasks, deps] = await Promise.all([
    sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}&select=id,client_name,build_start_date,target_end_date,computed_end_date,active_workstreams`).then(r => r?.[0]),
    sbFetch(`project_schedule?project_id=eq.${encodeURIComponent(projectId)}&order=sequence_order.asc`),
    sbFetch(`task_dependencies?project_id=eq.${encodeURIComponent(projectId)}`),
  ]);

  if (!client) return respond(404, { error: `Client not found: ${projectId}` });
  const gateStatus = await resolveGates(projectId);

  return respond(200, { client, tasks: tasks || [], dependencies: deps || [], gateStatus });
}

async function handleValidate(projectId) {
  const tasks = await sbFetch(`project_schedule?project_id=eq.${encodeURIComponent(projectId)}&order=sequence_order.asc`);
  if (!tasks || tasks.length === 0) return respond(404, { error: 'No schedule found for project' });

  const taskByName = new Map();
  for (const t of tasks) taskByName.set(t.task_name, t);

  const violations = [];
  for (const rule of SEQUENCING_RULES) {
    const beforeTask = taskByName.get(rule.before);
    const afterTask = taskByName.get(rule.after);
    if (!beforeTask || !afterTask) continue;
    if (beforeTask.status === 'skipped' || afterTask.status === 'skipped') continue;
    if (!beforeTask.planned_finish || !afterTask.planned_start) continue;
    if (beforeTask.planned_finish > afterTask.planned_start) {
      violations.push({ rule: rule.message, beforeTask: rule.before, beforeFinish: beforeTask.planned_finish, afterTask: rule.after, afterStart: afterTask.planned_start });
    }
  }

  return respond(200, { projectId, ruleCount: SEQUENCING_RULES.length, violationCount: violations.length, violations, valid: violations.length === 0 });
}

// ── Update task ────────────────────────────────────────────

async function handleUpdateTask(projectId, body) {
  if (!body.taskId) return respond(400, { error: 'taskId required in request body' });

  const allowed = [
    'status', 'actual_start', 'actual_finish', 'contractor_confirmed', 'duration_days',
    'planned_start', 'subcontractor_id', 'assigned_contractor',
    'client_note', 'internal_note', 'definition_of_done',
    'task_name', 'phase', 'trade', 'workstream', 'sequence_order',
    'perf_schedule', 'perf_invoice', 'perf_communication', 'perf_scope', 'perf_cleanliness', 'perf_notes',
  ];
  const patch = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) return respond(400, { error: 'No valid fields to update' });

  // Fetch previous state to emit meaningful events (status transitions, etc.)
  const prior = await sbFetch(
    `project_schedule?id=eq.${body.taskId}&project_id=eq.${encodeURIComponent(projectId)}&select=status,contractor_confirmed,task_name`
  ).then(r => r?.[0]);

  const result = await sbFetch(
    `project_schedule?id=eq.${body.taskId}&project_id=eq.${encodeURIComponent(projectId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );

  if (!result || (Array.isArray(result) && result.length === 0)) return respond(404, { error: 'Task not found' });

  // Emit events (non-fatal — won't break the PATCH if logging fails)
  if (prior) {
    const actor = body.actor || 'pm';
    if (patch.status && patch.status !== prior.status) {
      await logEventSafe({
        projectId, taskId: body.taskId, actor,
        eventType: 'task.status_changed',
        payload: { from: prior.status, to: patch.status, task_name: prior.task_name },
      });
      if (patch.status === 'complete') {
        await logEventSafe({
          projectId, taskId: body.taskId, actor,
          eventType: 'task.completed',
          payload: { actual_finish: patch.actual_finish || null, task_name: prior.task_name },
        });
      }
    }
    if (patch.contractor_confirmed === true && !prior.contractor_confirmed) {
      await logEventSafe({
        projectId, taskId: body.taskId, actor,
        eventType: 'contractor.confirmed',
        payload: { task_name: prior.task_name },
      });
    }
  }

  const cpmResult = await runCPM(projectId);
  return respond(200, cpmResult);
}

// ── Reorder task (vertical drag — change sequence/phase only) ─
// Insert-before semantics: dragged task ends up immediately before target.
// Skips CPM since sequence_order only affects Kahn tie-break and dates
// are driven by dependencies, not sequence.

async function handleReorderTask(projectId, body) {
  const { taskId, targetTaskId, phase } = body;
  if (!taskId || !targetTaskId) return respond(400, { error: 'taskId and targetTaskId required' });
  if (taskId === targetTaskId) return respond(200, { message: 'No change', changed: 0 });

  const tasks = await sbFetch(
    `project_schedule?project_id=eq.${encodeURIComponent(projectId)}&select=id,sequence_order,phase`
  );
  const T = tasks.find(t => t.id === taskId);
  const U = tasks.find(t => t.id === targetTaskId);
  if (!T || !U) return respond(404, { error: 'Task not found' });

  const S_T = T.sequence_order;
  const S_U = U.sequence_order;
  const phaseChanged = phase && phase !== T.phase;

  const writes = []; // array of { id, patch }

  if (S_T < S_U) {
    // Dragging down: shift (S_T, S_U-1] by -1, T → S_U - 1
    for (const t of tasks) {
      if (t.id === taskId) continue;
      if (t.sequence_order > S_T && t.sequence_order <= S_U - 1) {
        writes.push({ id: t.id, patch: { sequence_order: t.sequence_order - 1 } });
      }
    }
    const tPatch = { sequence_order: S_U - 1 };
    if (phaseChanged) tPatch.phase = phase;
    writes.push({ id: taskId, patch: tPatch });
  } else if (S_T > S_U) {
    // Dragging up: shift [S_U, S_T) by +1, T → S_U
    for (const t of tasks) {
      if (t.id === taskId) continue;
      if (t.sequence_order >= S_U && t.sequence_order < S_T) {
        writes.push({ id: t.id, patch: { sequence_order: t.sequence_order + 1 } });
      }
    }
    const tPatch = { sequence_order: S_U };
    if (phaseChanged) tPatch.phase = phase;
    writes.push({ id: taskId, patch: tPatch });
  } else {
    // Same sequence — only a phase change to apply
    if (phaseChanged) writes.push({ id: taskId, patch: { phase } });
  }

  if (writes.length === 0) return respond(200, { message: 'No change', changed: 0 });

  await Promise.all(writes.map(w =>
    sbFetch(`project_schedule?id=eq.${w.id}`, {
      method: 'PATCH',
      body: JSON.stringify(w.patch),
      prefer: 'return=minimal',
    })
  ));

  return respond(200, { message: 'Reordered', changed: writes.length });
}

// ── Move task (free mode, no CPM ripple) ──────────────────

async function handleMoveTask(projectId, body) {
  if (!body.taskId || !body.planned_start) return respond(400, { error: 'taskId and planned_start required' });

  // Fetch task to compute new finish = start + duration
  const task = await sbFetch(
    `project_schedule?id=eq.${body.taskId}&project_id=eq.${encodeURIComponent(projectId)}&select=duration_days`
  ).then(r => r?.[0]);
  if (!task) return respond(404, { error: 'Task not found' });

  const newFinish = addDays(body.planned_start, task.duration_days || 1);

  await sbFetch(
    `project_schedule?id=eq.${body.taskId}&project_id=eq.${encodeURIComponent(projectId)}`,
    { method: 'PATCH', body: JSON.stringify({ planned_start: body.planned_start, planned_finish: newFinish }) }
  );

  return respond(200, { message: 'Task moved', taskId: body.taskId, planned_start: body.planned_start, planned_finish: newFinish });
}

// ── Add / Delete task ──────────────────────────────────────

async function handleAddTask(projectId, body) {
  if (!body.task_name) return respond(400, { error: 'task_name required' });

  const row = {
    project_id: projectId,
    task_name: body.task_name,
    phase: body.phase || 'Closeout',
    trade: body.trade || null,
    workstream: body.workstream || 'both',
    duration_days: body.duration_days || 1,
    lead_time_days: body.lead_time_days || 0,
    is_long_lead: body.is_long_lead || false,
    is_milestone: body.is_milestone || false,
    is_gate: body.is_gate || false,
    sequence_order: body.sequence_order || 999,
    status: 'needs_scheduling',
    definition_of_done: body.definition_of_done || null,
    client_note: body.client_note || null,
    internal_note: body.internal_note || null,
    selections_gate: body.selections_gate || null,
  };

  const inserted = await sbFetch('project_schedule', { method: 'POST', body: JSON.stringify(row) });
  if (!inserted || inserted.length === 0) return respond(500, { error: 'Failed to insert task' });

  const taskId = inserted[0].id;

  // Add dependencies if provided
  if (body.blocked_by && Array.isArray(body.blocked_by) && body.blocked_by.length > 0) {
    const depRows = body.blocked_by.map(blockerTaskId => ({
      project_id: projectId,
      task_id: taskId,
      blocked_by_task_id: blockerTaskId,
    }));
    await sbFetch('task_dependencies', { method: 'POST', body: JSON.stringify(depRows) });
  }

  const cpmResult = await runCPM(projectId);
  return respond(200, { message: 'Task added', taskId, ...cpmResult });
}

async function handleDeleteTask(projectId, body) {
  if (!body.taskId) return respond(400, { error: 'taskId required' });

  // Delete the task (dependencies cascade via ON DELETE CASCADE)
  await sbFetch(
    `project_schedule?id=eq.${body.taskId}&project_id=eq.${encodeURIComponent(projectId)}`,
    { method: 'DELETE' }
  );

  const cpmResult = await runCPM(projectId);
  return respond(200, { message: 'Task deleted', ...cpmResult });
}

// ── Add / Remove dependency ────────────────────────────────

async function handleAddDep(projectId, body) {
  if (!body.taskId || !body.blockedByTaskId) return respond(400, { error: 'taskId and blockedByTaskId required' });

  await sbFetch('task_dependencies', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, task_id: body.taskId, blocked_by_task_id: body.blockedByTaskId }),
  });

  const cpmResult = await runCPM(projectId);
  return respond(200, { message: 'Dependency added', ...cpmResult });
}

async function handleRemoveDep(projectId, body) {
  if (!body.taskId || !body.blockedByTaskId) return respond(400, { error: 'taskId and blockedByTaskId required' });

  await sbFetch(
    `task_dependencies?task_id=eq.${body.taskId}&blocked_by_task_id=eq.${body.blockedByTaskId}&project_id=eq.${encodeURIComponent(projectId)}`,
    { method: 'DELETE' }
  );

  const cpmResult = await runCPM(projectId);
  return respond(200, { message: 'Dependency removed', ...cpmResult });
}

// ── Task notes ─────────────────────────────────────────────

async function handleAddNote(projectId, body) {
  if (!body.taskId || !body.body) return respond(400, { error: 'taskId and body required' });

  const row = {
    project_id: projectId,
    task_id: body.taskId,
    author: body.author || 'PM',
    body: body.body,
    note_type: body.note_type || 'general',
  };

  const inserted = await sbFetch('task_notes', { method: 'POST', body: JSON.stringify(row) });
  return respond(200, { message: 'Note added', note: inserted?.[0] || null });
}

async function handleGetNotes(projectId, taskId) {
  if (!taskId) return respond(400, { error: 'taskId query parameter required' });

  const notes = await sbFetch(
    `task_notes?task_id=eq.${taskId}&project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc`
  );

  return respond(200, { taskId, notes: notes || [] });
}

// ── Handler ────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Auth check
  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== ADMIN_PASSWORD()) {
    return respond(401, { error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const projectId = params.projectId;
  if (!projectId) return respond(400, { error: 'projectId query parameter required' });

  const action = params.action;

  try {
    if (action === 'instantiate' && event.httpMethod === 'POST')
      return await handleInstantiate(projectId);
    if (action === 'calculate')
      return await handleCalculate(projectId);
    if (action === 'schedule')
      return await handleGetSchedule(projectId);
    if (action === 'validate')
      return await handleValidate(projectId);
    if (action === 'update-task' && event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      return await handleUpdateTask(projectId, body);
    }
    if (action === 'move-task' && event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      return await handleMoveTask(projectId, body);
    }
    if (action === 'reorder-task' && event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      return await handleReorderTask(projectId, body);
    }
    if (action === 'add-task' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleAddTask(projectId, body);
    }
    if (action === 'delete-task' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleDeleteTask(projectId, body);
    }
    if (action === 'add-dep' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleAddDep(projectId, body);
    }
    if (action === 'remove-dep' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleRemoveDep(projectId, body);
    }
    if (action === 'add-note' && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleAddNote(projectId, body);
    }
    if (action === 'get-notes') {
      return await handleGetNotes(projectId, params.taskId);
    }

    return respond(400, {
      error: 'Invalid action. Valid: instantiate, calculate, schedule, validate, update-task, move-task, reorder-task, add-task, delete-task, add-dep, remove-dep, add-note, get-notes',
    });
  } catch (err) {
    if (err.status) {
      return respond(err.status, { error: err.message, ...(err.tasks ? { tasks: err.tasks } : {}) });
    }
    console.error('Schedule engine error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};
