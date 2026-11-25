// netlify/functions/coord-board.js
// GET: the coordinator's latest board, plus what has changed since it was
// calculated: drafts decided and edits made on the board, so the page can show
// them straight away. The coordinator recalculates within 30 minutes of an edit.
import { authorized, db, json } from './lib/coord-db.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });
  if (!process.env.COORD_TOKEN) return json(500, { error: 'COORD_TOKEN is not configured' });
  if (!authorized(event)) return json(401, { error: 'Wrong or missing passcode' });
  try {
    const pool = db();
    const snap = await pool.query(
      'select id, run_date, created_at, data from coord.board_snapshots order by created_at desc limit 1');
    if (!snap.rows.length) return json(200, { snapshot: null, edits: [], decided: {} });
    const s = snap.rows[0];
    const edits = await pool.query(
      `select at, task_id, proposal_id, payload from coord.action_log
        where actor = 'cole' and at > $1 order by at`, [s.created_at]);
    const ids = (s.data.proposals || []).map((p) => p.id);
    const decided = ids.length ? await pool.query(
      `select id, state, final_body, edited, decided_at from coord.proposals
        where id = any($1::uuid[]) and state <> 'pending'`, [ids]) : { rows: [] };
    return json(200, {
      snapshot: s.data,
      calculated_at: s.created_at,
      edits: edits.rows,
      decided: Object.fromEntries(decided.rows.map((r) => [r.id, r])),
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
