// netlify/functions/coord-board.js
// GET: the coordinator's latest board, plus what has changed since it was
// calculated: drafts decided and edits made on the board, so the page can show
// them straight away. The coordinator recalculates within 30 minutes of an edit.
import { authorized, db, json } from './lib/coord-db.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });
  // ?health=1 answers only whether the coordinator database is reachable: no data, no passcode
  if ((event.queryStringParameters || {}).health === '1') {
    try { await db().query('select 1'); return json(200, { database: 'reachable', passcode_configured: !!process.env.COORD_TOKEN }); }
    catch (e) { return json(503, { database: 'unreachable', reason: String(e.message).replace(/postgres(ql)?:\/\/[^@]*@/g, 'postgresql://***@').slice(0, 200) }); }
  }
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
    // subs and their kinds of work are read live, so a save on the Subs screen
    // shows at once rather than at the next recalculation
    const subs = await pool.query(
      `select s.id, s.legal_name, s.status, s.trades_owner, s.notion_trades, s.notes,
              coalesce(array_agg(t.trade_key order by t.trade_key) filter (where t.trade_key is not null), '{}') as trades,
              (select c.phone_e164 from coord.sub_contacts c where c.sub_id = s.id and c.is_primary limit 1) as phone,
              (select c.email from coord.sub_contacts c where c.sub_id = s.id and c.is_primary limit 1) as email
         from coord.subcontractors s left join coord.sub_trades t on t.sub_id = s.id
        where s.legal_name <> '(unnamed)'
        group by s.id order by s.legal_name`);
    const trades = await pool.query(`select key, name from coord.trades where is_crew order by name`);
    return json(200, {
      subs: subs.rows, trades: trades.rows,
      snapshot: s.data,
      calculated_at: s.created_at,
      edits: edits.rows,
      decided: Object.fromEntries(decided.rows.map((r) => [r.id, r])),
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
