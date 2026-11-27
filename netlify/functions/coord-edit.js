// netlify/functions/coord-edit.js
// POST: one edit from the coordinator board. Writes to the coordinator's
// tables only: never Notion (a Notion change is a proposal Cole approves, written
// later by the coordinator's scheduled run), never the portal's own tables, and nothing is sent
// to anyone. Every edit is logged in coord.action_log, and fields Notion also
// tracks are marked as board-owned so the Notion sync reports a disagreement
// instead of overwriting them.
//
// Body: { action, task_id | proposal_id, ...fields }
import { authorized, json, tx } from './lib/coord-db.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

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
  // list; the Notion change is drafted at the next run for Cole to approve.
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
  async proposal(c, b) {
    need(UUID.test(b.proposal_id || ''), 'proposal_id is missing');
    const p = await c.query('select id, job_id, task_id, sub_id, kind, state, draft_body from coord.proposals where id = $1', [b.proposal_id]);
    need(p.rows.length, 'No such draft');
    const cur = p.rows[0];
    if (b.decision === 'undo') {
      need(['approved', 'skipped'].includes(cur.state), cur.kind === 'notion_write' ? 'Already written to Notion' : 'Nothing to undo');
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
