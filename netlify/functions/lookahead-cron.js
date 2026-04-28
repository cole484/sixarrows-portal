// netlify/functions/lookahead-cron.js
// Daily lookahead audit — turns gaps into action items.
//
// Scheduled via netlify.toml. Runs once per day. Idempotent — safe to
// re-run; uses dedupe_keys so duplicate items don't accumulate.
//
// Also creates the weekly "Friday lookahead review" action item on Fridays.

import { computeAllLookaheads } from './lib/lookahead.js';
import { createActionItem, logEventSafe } from './lib/events.js';

// Map gap type → action_item kind + title formatter
function actionFromGap(task, gap) {
  const startStr = new Date(task.planned_start + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const days = task.days_to_start;
  const tier = days <= 7 ? '1w' : days <= 21 ? '2w' : days <= 42 ? '4w' : '8w';

  switch (gap.type) {
    case 'no_sub':
      return {
        kind: 'assign_sub',
        priority: gap.severity,
        title: `Assign sub — ${task.task_name} (${startStr})`,
        body: `Starts in ${days} day${days === 1 ? '' : 's'}. No subcontractor on this task yet. Pick one and draft a confirmation text.`,
        dedupe_key: `lookahead:assign_sub:${task.id}`,
      };
    case 'unconfirmed_sub':
      return {
        kind: 'confirm_sub',
        priority: gap.severity,
        title: `Confirm ${task.contact_name || 'sub'} for ${task.task_name} (${startStr})`,
        body: `Starts in ${days} day${days === 1 ? '' : 's'}. Sub assigned but not confirmed. Send/resend the confirmation text.`,
        dedupe_key: `lookahead:confirm_sub:${task.id}`,
      };
    case 'selection_gate_open':
      return {
        kind: 'resolve_selection_gate',
        priority: gap.severity,
        title: `Resolve "${task.selections_gate}" — blocks ${task.task_name} (${startStr})`,
        body: `Selection gate "${task.selections_gate}" not resolved. ${task.task_name} starts in ${days} day${days === 1 ? '' : 's'}.`,
        dedupe_key: `lookahead:gate:${task.id}:${task.selections_gate}`,
      };
    case 'material_lead_due':
    case 'material_lead_overdue':
      return {
        kind: 'order_materials',
        priority: gap.type === 'material_lead_overdue' ? 'red' : 'yellow',
        title: `Order materials for ${task.task_name} (${startStr})`,
        body: gap.label,
        dedupe_key: `lookahead:materials:${task.id}`,
      };
    case 'predecessor_incomplete':
      return {
        kind: 'predecessor_blocked',
        priority: gap.severity,
        title: `${task.task_name} (${startStr}) is waiting on predecessors`,
        body: gap.label,
        dedupe_key: `lookahead:predecessor:${task.id}`,
      };
  }
  return null;
}

async function ensureFridayReviewItem(projects) {
  // Determine "is today Friday in US/Central".
  const now = new Date();
  // Quick-and-dirty TZ shift to Central (UTC-5 standard / UTC-6 with DST).
  // For accuracy we'd use Intl.DateTimeFormat; this is close enough for a daily flag.
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  // Cron runs ~13:00 UTC daily (~8am Central). On Friday this is well into Friday Central.
  // Fire the review item every Friday.
  const isFriday = utcDay === 5;
  if (!isFriday) return;

  // Use one item per project per Friday week
  const weekKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  for (const p of projects) {
    await createActionItem({
      projectId: p.project_id,
      kind: 'weekly_lookahead_review',
      title: `Friday lookahead — ${p.client_name}`,
      body: `Review the next 8 weeks. ${p.summary.with_gaps} task${p.summary.with_gaps === 1 ? '' : 's'} with gaps (${p.summary.red_gaps} red, ${p.summary.yellow_gaps} yellow).`,
      priority: p.summary.red_gaps > 0 ? 'red' : p.summary.with_gaps > 0 ? 'yellow' : 'normal',
      dedupeKey: `weekly_lookahead:${p.project_id}:${weekKey}`,
    }).catch(err => console.error('Friday review item failed:', err.message));
  }
}

export const handler = async (event) => {
  console.log('Lookahead cron starting at', new Date().toISOString());
  try {
    const data = await computeAllLookaheads();
    let actionsCreated = 0;

    for (const project of data.projects) {
      for (const task of project.tasks) {
        for (const gap of task.gaps) {
          const action = actionFromGap(task, gap);
          if (!action) continue;
          try {
            await createActionItem({
              projectId: project.project_id,
              taskId: task.id,
              kind: action.kind,
              priority: action.priority,
              title: action.title,
              body: action.body,
              dedupeKey: action.dedupe_key,
            });
            actionsCreated++;
          } catch (err) {
            console.error('Action item failed:', action.dedupe_key, err.message);
          }
        }
      }
      await logEventSafe({
        projectId: project.project_id, actor: 'system:lookahead_cron',
        eventType: 'lookahead.audited',
        payload: {
          tasks_in_window: project.summary.tasks,
          with_gaps: project.summary.with_gaps,
          red_gaps: project.summary.red_gaps,
          yellow_gaps: project.summary.yellow_gaps,
        },
      });
    }

    await ensureFridayReviewItem(data.projects);

    const summary = {
      ok: true,
      projects_audited: data.projects.length,
      actions_created_or_updated: actionsCreated,
      generated_at: data.generated_at,
    };
    console.log('Lookahead cron finished:', summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('Lookahead cron failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
