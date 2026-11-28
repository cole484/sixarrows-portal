// netlify/functions/coord-edit.js
// POST: one edit from the coordinator board. Writes to the coordinator's
// tables only: never Notion, never the portal's own tables, and nothing is sent
// to anyone. Every edit is logged in coord.action_log, and fields Notion also
// tracks are marked as board-owned so the Notion sync reports a disagreement
// instead of overwriting them.
//
// Body: { action, task_id | proposal_id, ...fields }
import { authorized, json, tx } from './lib/coord-db.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const STRENGTHS = ['hard', 'partial', 'soft'];
const FIXED = ['external_gate', 'milestone', 'decision', 'material_order'];

function need(cond, msg) { if (!cond) { const e = new Error(msg); e.status = 400; throw e; } }

async function task(c, id) {
  need(UUID.test(id || ''), 'task_id is missing');
  const r = await c.query('select id, job_id, task_type, sub_id, name from coord.tasks where id = $1', [id]);
  need(r.rows.length, 'No such task');
  return r.rows[0];
}

async function mark(c, id, fields) {
  await c.query(
    `update coord.tasks set board_fields = (select array(select distinct x from unnest(board_fields || $2::text[]) x))
      where id = $1`, [id, fields]);
}

const ACTIONS = {
  async assign_sub(c, b) {
    const t = await task(c, b.task_id);
    need(t.task_type === 'work', 'Only crew work has a sub');
    need(UUID.test(b.sub_id || ''), 'Pick a sub');
    const s = await c.query('select legal_name from coord.subcontractors where id = $1', [b.sub_id]);
    need(s.rows.length, 'No such sub');
    await c.query('update coord.tasks set sub_id = $2 where id = $1', [t.id, b.sub_id]);
    await mark(c, t.id, ['sub_id']);
    return { task: t, summary: `Assigned ${s.rows[0].legal_name}` };
  },
  async mark_requested(c, b) {
    const t = await task(c, b.task_id);
    need(t.sub_id, 'Assign a sub first');
    await c.query(`insert into coord.bookings (task_id, sub_id, state, requested_at, requested_start, requested_end, notes)
                   values ($1, $2, 'requested', now(), $3, $4, 'Board: requested')`,
                  [t.id, t.sub_id, b.start || null, b.end || null]);
    return { task: t, summary: 'Asked the sub' };
  },
  async mark_booked(c, b) {
    const t = await task(c, b.task_id);
    need(t.sub_id, 'Assign a sub first');
    need(DATE.test(b.start || ''), 'Pick the start date');
    const end = DATE.test(b.end || '') ? b.end : b.start;
    await c.query(`update coord.bookings set state = 'cancelled' where task_id = $1 and state = 'requested' and notes like 'Board:%'`, [t.id]);
    await c.query(`insert into coord.bookings (task_id, sub_id, state, confirmed_start, confirmed_end, confirmed_at, notes)
                   values ($1, $2, 'confirmed', $3, $4, now(), 'Board: confirmed')`, [t.id, t.sub_id, b.start, end]);
    await c.query('update coord.tasks set confirmed_start = $2, confirmed_end = $3 where id = $1', [t.id, b.start, end]);
    await mark(c, t.id, ['confirmed_start', 'confirmed_end']);
    return { task: t, summary: `Booked ${b.start}${end !== b.start ? ' to ' + end : ''}` };
  },
  async mark_started(c, b) {
    const t = await task(c, b.task_id);
    need(DATE.test(b.date || ''), 'Pick the date');
    await c.query(`update coord.tasks set progress_state = 'in_progress', actual_start = $2 where id = $1`, [t.id, b.date]);
    await mark(c, t.id, ['progress_state', 'actual_start']);
    return { task: t, summary: `Started ${b.date}` };
  },
  async mark_done(c, b) {
    const t = await task(c, b.task_id);
    need(DATE.test(b.date || ''), 'Pick the date');
    await c.query(`update coord.tasks set progress_state = 'complete', actual_end = $2,
                   actual_start = coalesce(actual_start, $2), completion_evidence = 'pm_observed' where id = $1`, [t.id, b.date]);
    await c.query(`update coord.external_items set state = case when kind = 'gate' then 'passed' else 'confirmed' end,
                   result_at = now() where task_id = $1`, [t.id]);
    await c.query(`update coord.decisions set state = 'decided', decided_at = now() where task_id = $1`, [t.id]);
    await mark(c, t.id, ['progress_state', 'actual_end']);
    return { task: t, summary: `Done ${b.date}` };
  },
  async mark_ordered(c, b) {
    const t = await task(c, b.task_id);
    need(t.task_type === 'material_order', 'Only an order can be ordered');
    need(DATE.test(b.date || ''), 'Pick the order date');
    await c.query(`update coord.material_order_items set state = 'ordered', ordered_on = $2,
                   eta = coalesce($3::date, eta) where task_id = $1`, [t.id, b.date, DATE.test(b.eta || '') ? b.eta : null]);
    await c.query(`update coord.tasks set progress_state = 'complete', actual_end = $2, actual_start = coalesce(actual_start, $2)
                   where id = $1`, [t.id, b.date]);
    await mark(c, t.id, ['progress_state', 'actual_end']);
    return { task: t, summary: `Ordered ${b.date}` };
  },
  async mark_received(c, b) {
    const t = await task(c, b.task_id);
    need(t.task_type === 'material_order', 'Only an order can be received');
    need(DATE.test(b.date || ''), 'Pick the date');
    await c.query(`update coord.material_order_items set state = 'received_checked', received_checked_on = $2,
                   ordered_on = coalesce(ordered_on, $2) where task_id = $1`, [t.id, b.date]);
    return { task: t, summary: `Received ${b.date}` };
  },
  async mark_called(c, b) {
    const t = await task(c, b.task_id);
    need(['external_gate', 'external_request'].includes(t.task_type), 'Only an inspection or request is called');
    await c.query(`update coord.external_items set state = 'requested', requested_at = now(),
                   scheduled_for = $2 where task_id = $1`, [t.id, DATE.test(b.date || '') ? b.date : null]);
    return { task: t, summary: b.date ? `Called; scheduled ${b.date}` : 'Called' };
  },
  async release_site(c, b) {
    const t = await task(c, b.task_id);
    need(t.task_type === 'work', 'Only crew work is released');
    await c.query(`update coord.tasks set released_at = now(), released_by = 'cole' where id = $1`, [t.id]);
    return { task: t, summary: 'Site released' };
  },
  async set_price(c, b) {
    const t = await task(c, b.task_id);
    const amount = Number(b.amount);
    need(Number.isFinite(amount) && amount > 0, 'Enter the price');
    await c.query(`update coord.commitments set status = 'superseded' where task_id = $1 and status = 'accepted'`, [t.id]);
    await c.query(`insert into coord.commitments (job_id, task_id, sub_id, amount, payment_terms, status)
                   values ($1, $2, $3, $4, $5, 'accepted')`, [t.job_id, t.id, t.sub_id, amount.toFixed(2), b.terms || null]);
    return { task: t, summary: `Price $${amount.toLocaleString('en-US')}` };
  },
  // which kinds of work a sub does. From now on the coordinator owns this sub's
  // list. Notion is not changed.
  async set_trades(c, b) {
    need(UUID.test(b.sub_id || ''), 'sub_id is missing');
    need(Array.isArray(b.trades), 'trades is missing');
    const s = await c.query('select id, legal_name from coord.subcontractors where id = $1', [b.sub_id]);
    need(s.rows.length, 'No such sub');
    const known = new Set((await c.query('select key from coord.trades')).rows.map((r) => r.key));
    const keys = [...new Set(b.trades)];
    need(keys.every((k) => known.has(k)), 'Unknown kind of work');
    await c.query('delete from coord.sub_trades where sub_id = $1', [b.sub_id]);
    for (const k of keys) await c.query('insert into coord.sub_trades (sub_id, trade_key) values ($1, $2)', [b.sub_id, k]);
    await c.query(`update coord.subcontractors set trades_owner = 'board', updated_at = now() where id = $1`, [b.sub_id]);
    return { sub: b.sub_id, summary: `Saved ${s.rows[0].legal_name}: ${keys.length} kind${keys.length === 1 ? '' : 's'} of work` };
  },
  // ---- timeline -------------------------------------------------------
  // Dragging a bar. A booked task moves its booking; anything else gets a
  // "not before" date. Soft successors the page kept in place come as `pins`.
  async move_task(c, b) {
    const t = await task(c, b.task_id);
    need(!FIXED.includes(t.task_type), "Inspections, orders, client choices and milestones aren't moved by hand");
    need(DATE.test(b.start || ''), 'Pick the date');
    const r = (await c.query('select confirmed_start, actual_start, progress_state from coord.tasks where id = $1', [t.id])).rows[0];
    need(!r.actual_start && r.progress_state !== 'complete', 'Work that has started keeps its dates');
    let summary;
    if (r.confirmed_start) {
      need(DATE.test(b.end || ''), 'The booking needs an end date');
      await c.query('update coord.tasks set confirmed_start = $2, confirmed_end = $3 where id = $1', [t.id, b.start, b.end]);
      if (t.sub_id) {
        await c.query(`insert into coord.bookings (task_id, sub_id, state, confirmed_start, confirmed_end, confirmed_at, notes)
                       values ($1, $2, 'confirmed', $3, $4, now(), 'Board: moved on the timeline')`, [t.id, t.sub_id, b.start, b.end]);
      }
      await mark(c, t.id, ['confirmed_start', 'confirmed_end']);
      summary = `Booking moved to ${b.start}`;
    } else {
      await c.query('update coord.tasks set pinned_start = $2 where id = $1', [t.id, b.start]);
      summary = `Moved to ${b.start}`;
    }
    for (const p of Array.isArray(b.pins) ? b.pins.slice(0, 50) : []) {
      if (!UUID.test(p.task_id || '') || !DATE.test(p.start || '')) continue;
      await c.query(`update coord.tasks set pinned_start = $2 where id = $1 and job_id = $3
                     and actual_start is null and confirmed_start is null`, [p.task_id, p.start, t.job_id]);
    }
    return { task: t, summary };
  },
  async clear_pin(c, b) {
    const t = await task(c, b.task_id);
    await c.query('update coord.tasks set pinned_start = null where id = $1', [t.id]);
    return { task: t, summary: 'Back to the forecast date' };
  },
  async set_duration(c, b) {
    const t = await task(c, b.task_id);
    const days = Number(b.days);
    need(Number.isInteger(days) && days >= 1 && days <= 250, 'Enter working days, 1 to 250');
    await c.query('update coord.tasks set duration_days = $2 where id = $1', [t.id, days]);
    return { task: t, summary: `${days} working day${days === 1 ? '' : 's'}` };
  },
  // "Ready for next trade": what waits on this task may start from the day after.
  async handoff(c, b) {
    const t = await task(c, b.task_id);
    need(b.date === null || DATE.test(b.date || ''), 'Pick the date');
    await c.query('update coord.tasks set handoff_on = $2 where id = $1', [t.id, b.date]);
    return { task: t, summary: b.date ? `Ready for the next trade from ${b.date}` : 'Handoff cleared' };
  },
  // One link on this job. strength null goes back to the library default.
  async set_link(c, b) {
    need(UUID.test(b.pred_id || '') && UUID.test(b.succ_id || ''), 'Which link?');
    need(b.strength === null || STRENGTHS.includes(b.strength), 'Hard, partial or soft');
    const lag = b.strength === 'partial' ? Number(b.lag) : 0;
    need(Number.isInteger(lag) && lag >= 0 && lag <= 30, 'Days after it starts: 0 to 30');
    const r = await c.query(`update coord.task_dependencies set strength = $3, lag_days = $4
                             where predecessor_task_id = $1 and successor_task_id = $2 returning job_id`,
                            [b.pred_id, b.succ_id, b.strength, b.strength ? lag : 0]);
    need(r.rowCount, 'No such link');
    const t = await task(c, b.succ_id);
    return { task: t, summary: b.strength ? `Link set to ${b.strength} on this job` : 'Link back to the default' };
  },
  // The library default for this link, for every job that hasn't changed it.
  async set_link_default(c, b) {
    need(UUID.test(b.pred_id || '') && UUID.test(b.succ_id || ''), 'Which link?');
    need(STRENGTHS.includes(b.strength), 'Hard, partial or soft');
    const lag = b.strength === 'partial' ? Number(b.lag) : 0;
    need(Number.isInteger(lag) && lag >= 0 && lag <= 30, 'Days after it starts: 0 to 30');
    const k = await c.query(`select a.library_task_key as p, b.library_task_key as s from coord.tasks a, coord.tasks b
                             where a.id = $1 and b.id = $2`, [b.pred_id, b.succ_id]);
    need(k.rows.length && k.rows[0].p && k.rows[0].s, 'Only library tasks have a default');
    await c.query(`insert into coord.link_strength_defaults (predecessor_key, successor_key, strength, lag_days, decided_by, reason)
                   values ($1, $2, $3, $4, 'cole', 'Set on the timeline')
                   on conflict (predecessor_key, successor_key) do update set strength = excluded.strength,
                     lag_days = excluded.lag_days, decided_by = 'cole', reason = excluded.reason, updated_at = now()`,
                  [k.rows[0].p, k.rows[0].s, b.strength, lag]);
    await c.query(`update coord.task_dependencies set strength = null, lag_days = 0
                   where predecessor_task_id = $1 and successor_task_id = $2`, [b.pred_id, b.succ_id]);
    const t = await task(c, b.succ_id);
    return { task: t, summary: `Default set to ${b.strength} for every job` };
  },
  async proposal(c, b) {
    need(UUID.test(b.proposal_id || ''), 'proposal_id is missing');
    const p = await c.query('select id, job_id, task_id, sub_id, kind, state, draft_body from coord.proposals where id = $1', [b.proposal_id]);
    need(p.rows.length, 'No such draft');
    const cur = p.rows[0];
    if (b.decision === 'undo') {
      need(['approved', 'skipped'].includes(cur.state), 'Nothing to undo');
      await c.query(`update coord.proposals set state = 'pending', final_body = null, edited = null,
                     decided_by = null, decided_at = null where id = $1`, [cur.id]);
      return { task: { id: cur.task_id, job_id: cur.job_id }, sub: cur.sub_id, proposal: cur.id, summary: 'Back to waiting' };
    }
    need(['approved', 'skipped'].includes(b.decision), 'Approve or skip');
    need(cur.state === 'pending', 'Already decided');
    const final = b.decision === 'approved' ? (b.final_body || cur.draft_body) : null;
    const edited = b.decision === 'approved' && final.trim() !== (cur.draft_body || '').trim();
    await c.query(`update coord.proposals set state = $2, final_body = $3, edited = $4, decided_by = 'cole',
                   decided_at = now() where id = $1`, [cur.id, b.decision, final, edited]);
    return { task: { id: cur.task_id, job_id: cur.job_id }, sub: cur.sub_id, proposal: cur.id,
             summary: b.decision === 'skipped' ? 'Skipped' : edited ? 'Approved with edits' : 'Approved' };
  },
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!process.env.COORD_TOKEN) return json(500, { error: 'COORD_TOKEN is not configured' });
  if (!authorized(event)) return json(401, { error: 'Wrong or missing passcode' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Body is not JSON' }); }
  const fn = ACTIONS[body.action];
  if (!fn) return json(400, { error: `Unknown action ${body.action}` });
  try {
    const out = await tx(async (c) => {
      const r = await fn(c, body);
      await c.query(`insert into coord.action_log (actor, action, job_id, task_id, sub_id, proposal_id, payload)
                     values ('cole', $1, $2, $3, $4, $5, $6)`,
                    [body.action, r.task?.job_id || null, r.task?.id || null, r.sub || null, r.proposal || null,
                     JSON.stringify({ source: 'portal board', summary: r.summary, input: body })]);
      return r;
    });
    return json(200, { ok: true, summary: out.summary });
  } catch (e) {
    return json(e.status || 500, { error: e.message });
  }
};
