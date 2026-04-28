// netlify/functions/lib/lookahead.js
// Shared 8-week lookahead computation. Used by:
//   - lookahead.js (GET endpoint for admin Lookahead view)
//   - lookahead-cron.js (daily audit that creates action items for gaps)
//
// Gap detection rules (all driven by tasks starting within HORIZON_DAYS):
//   • no_sub                — no subcontractor_id and no assigned_contractor
//   • unconfirmed_sub       — sub assigned but contractor_confirmed = false
//   • selection_gate_open   — selections_gate set and not resolved
//   • material_lead_due     — is_long_lead and must_schedule_by within 14 days or past
//   • predecessor_incomplete — any predecessor not complete and start within 14 days

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

export const HORIZON_DAYS = 56; // 8 weeks

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

function todayUTC() {
  return new Date().toISOString().split('T')[0];
}
function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00Z').getTime();
  const b = new Date(bStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

// Reuse the same gate-resolution logic as schedule-engine.
// Inlined here so this module stays self-contained.
async function resolveGates(projectId) {
  const rows = await sbFetch(
    `selections?client_id=eq.${encodeURIComponent(projectId)}&select=suffix,data`
  );
  const sel = {};
  for (const row of (rows || [])) sel[row.suffix] = row.data || {};
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
  };
}

function severityForDaysOut(daysOut) {
  if (daysOut <= 7)  return 'red';
  if (daysOut <= 21) return 'red';      // escalated yellow → red at 3 weeks
  if (daysOut <= 42) return 'yellow';
  return 'normal';                       // 43–56 days
}

// Compute lookahead for one project. Returns { project, tasks, summary }.
export async function computeProjectLookahead(projectId) {
  const today = todayUTC();
  const horizonEnd = (() => {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + HORIZON_DAYS);
    return d.toISOString().split('T')[0];
  })();

  const [client, allTasks, deps, subs, gateStatus] = await Promise.all([
    sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}&select=id,client_name,build_start_date,target_end_date`).then(r => r?.[0]),
    sbFetch(`project_schedule?project_id=eq.${encodeURIComponent(projectId)}&order=planned_start.asc.nullslast`),
    sbFetch(`task_dependencies?project_id=eq.${encodeURIComponent(projectId)}`),
    sbFetch(`subcontractors?select=id,name,phone,email`),
    resolveGates(projectId),
  ]);

  if (!client) return null;

  const subById = new Map((subs || []).map(s => [s.id, s]));
  const taskById = new Map((allTasks || []).map(t => [t.id, t]));
  const predsByTask = new Map();
  for (const d of (deps || [])) {
    if (!predsByTask.has(d.task_id)) predsByTask.set(d.task_id, []);
    predsByTask.get(d.task_id).push(d.blocked_by_task_id);
  }

  const inWindow = (allTasks || []).filter(t => {
    if (!t.planned_start) return false;
    if (t.status === 'complete' || t.status === 'skipped') return false;
    return t.planned_start >= today && t.planned_start <= horizonEnd;
  });

  const enriched = inWindow.map(t => {
    const sub = t.subcontractor_id ? subById.get(t.subcontractor_id) : null;
    const daysToStart = daysBetween(today, t.planned_start);
    const severity = severityForDaysOut(daysToStart);
    const gaps = [];

    // 1. No sub assigned
    if (!t.subcontractor_id && !t.assigned_contractor) {
      gaps.push({ type: 'no_sub', severity, label: 'No subcontractor assigned' });
    }
    // 2. Sub assigned but not confirmed
    else if (!t.contractor_confirmed) {
      gaps.push({ type: 'unconfirmed_sub', severity, label: 'Subcontractor not confirmed' });
    }
    // 3. Selection gate
    if (t.selections_gate) {
      const resolved = gateStatus[t.selections_gate] === true;
      if (!resolved) {
        gaps.push({
          type: 'selection_gate_open', severity,
          label: `Selection gate "${t.selections_gate}" unresolved`,
        });
      }
    }
    // 4. Material lead time (long-lead items only)
    if (t.is_long_lead && t.must_schedule_by) {
      const daysToMSB = daysBetween(today, t.must_schedule_by);
      if (daysToMSB <= 0) {
        gaps.push({ type: 'material_lead_overdue', severity: 'red', label: `Material order overdue (${t.must_schedule_by})` });
      } else if (daysToMSB <= 14) {
        gaps.push({ type: 'material_lead_due', severity: 'yellow', label: `Material order due in ${daysToMSB}d` });
      }
    }
    // 5. Predecessor not complete (only for tasks starting within 14 days — earlier is too noisy)
    if (daysToStart <= 14) {
      const preds = predsByTask.get(t.id) || [];
      const incomplete = preds
        .map(pid => taskById.get(pid))
        .filter(p => p && p.status !== 'complete' && p.status !== 'skipped');
      if (incomplete.length > 0) {
        gaps.push({
          type: 'predecessor_incomplete',
          severity: daysToStart <= 7 ? 'red' : 'yellow',
          label: `Waiting on: ${incomplete.map(p => p.task_name).join(', ')}`,
        });
      }
    }

    return {
      id: t.id,
      project_id: t.project_id,
      task_name: t.task_name,
      phase: t.phase,
      trade: t.trade,
      planned_start: t.planned_start,
      planned_finish: t.planned_finish,
      duration_days: t.duration_days,
      days_to_start: daysToStart,
      status: t.status,
      alert_level: t.alert_level,
      is_long_lead: t.is_long_lead,
      must_schedule_by: t.must_schedule_by,
      selections_gate: t.selections_gate,
      gate_resolved: t.selections_gate ? (gateStatus[t.selections_gate] === true) : null,
      contractor_confirmed: t.contractor_confirmed,
      subcontractor_id: t.subcontractor_id,
      assigned_contractor: t.assigned_contractor,
      contact_name: sub?.name || t.assigned_contractor || null,
      contact_phone: sub?.phone || null,
      gaps,
      gap_count: gaps.length,
      worst_severity: gaps.reduce((w, g) =>
        (g.severity === 'red' || w === 'red') ? 'red'
        : (g.severity === 'yellow' || w === 'yellow') ? 'yellow'
        : 'normal', 'normal'),
    };
  });

  const summary = {
    tasks: enriched.length,
    with_gaps: enriched.filter(t => t.gap_count > 0).length,
    red_gaps: enriched.filter(t => t.worst_severity === 'red').length,
    yellow_gaps: enriched.filter(t => t.worst_severity === 'yellow').length,
  };

  return {
    project_id: client.id,
    client_name: client.client_name,
    build_start_date: client.build_start_date,
    target_end_date: client.target_end_date,
    tasks: enriched,
    summary,
  };
}

// Compute lookahead across all active projects.
// Active = build_start_date set and target_end_date in future (or unset).
export async function computeAllLookaheads() {
  const today = todayUTC();
  const clients = await sbFetch(
    `clients?select=id,client_name,build_start_date,target_end_date&build_start_date=not.is.null`
  );
  const active = (clients || []).filter(c => !c.target_end_date || c.target_end_date >= today);

  const results = await Promise.all(active.map(c => computeProjectLookahead(c.id).catch(err => {
    console.error('Lookahead failed for project', c.id, err.message);
    return null;
  })));
  return {
    generated_at: new Date().toISOString(),
    horizon_days: HORIZON_DAYS,
    projects: results.filter(Boolean),
  };
}
