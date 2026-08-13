// netlify/functions/submit-quote.js
//
// Records a subcontractor's price for a task.
//
// The record lives in the append-only Supabase table `quote_responses`. Several
// subs quoting the same task is the normal case, so every submission is a new
// row and nothing is ever replaced. That table is the evidence of what somebody
// said a job would cost, on a date, in their own words.
//
// Notion gets a mirror, with one deliberate restriction: the quote is written
// to Estimated Cost ONLY when that field is currently empty. If a number is
// already there, whether an estimate or an earlier bid, the new quote is
// recorded and reported and the field is left alone.
//
// The reason is that choosing between three quotes is Cole's decision, and a
// system that silently overwrote the field would be making it for him, with the
// last sub to respond winning. Nothing about arriving second makes a number
// better.
//
// A failed Notion mirror never fails the submission. The sub gave us their
// price; that is recorded. notion_synced and notion_error make a broken mirror
// visible in the data rather than only in a log.
//
// Body (JSON):
//   { taskId, amount, signatureName,           required
//     subId, subName, contactName, contactEmail,
//     laborAmount, materialAmount, exclusions, inclusions, notes,
//     leadTimeDays, earliestStart, validUntil, canHoldWindow }

import { supabase } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function nHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  },
  body: JSON.stringify(body, null, 2),
});

function prop(page, name) {
  const p = page?.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':     return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'number':    return p.number ?? null;
    case 'select':    return p.select?.name || null;
    case 'status':    return p.status?.name || null;
    case 'rich_text': return p.rich_text?.map(t => t.plain_text).join('').trim() || null;
    default:          return null;
  }
}

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : null);
const str = (v, max = 4000) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST only' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return reply(500, { error: 'NOTION_TOKEN not set' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'body must be JSON' }); }

  const amount = num(payload.amount);
  if (!payload.taskId)        return reply(400, { error: 'taskId is required' });
  if (amount === null)        return reply(400, { error: 'amount is required and must be a number' });
  if (amount <= 0)            return reply(400, { error: 'amount must be greater than zero' });
  if (!str(payload.signatureName)) return reply(400, { error: 'signatureName is required' });

  const record = {
    task_id:         String(payload.taskId),
    task_name:       str(payload.taskName, 300),
    project:         str(payload.project, 200),
    trade:           str(payload.trade, 100),
    sub_id:          str(payload.subId, 100),
    sub_name:        str(payload.subName, 200),
    contact_name:    str(payload.contactName, 200),
    contact_email:   str(payload.contactEmail, 200),
    amount,
    labor_amount:    num(payload.laborAmount),
    material_amount: num(payload.materialAmount),
    exclusions:      str(payload.exclusions),
    inclusions:      str(payload.inclusions),
    notes:           str(payload.notes),
    lead_time_days:  Number.isFinite(Number(payload.leadTimeDays)) ? Math.round(Number(payload.leadTimeDays)) : null,
    earliest_start:  day(payload.earliestStart),
    valid_until:     day(payload.validUntil),
    can_hold_window: typeof payload.canHoldWindow === 'boolean' ? payload.canHoldWindow : null,
    signature_name:  str(payload.signatureName, 200),
    submitted_from:  str(event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'], 100),
    notion_synced:   false,
    wrote_cost:      false,
  };

  // ── Mirror to Notion first, so the row records what actually happened ───
  // Same ordering as submit-work-order: the table is append-only and has no
  // update policy, so the outcome has to be known before the single insert.
  try {
    const page = await fetch(`${NOTION_API}/pages/${record.task_id}`, { headers: nHeaders(token) });
    if (!page.ok) throw new Error(`read task: ${page.status} ${(await page.text()).slice(0, 160)}`);
    const task = await page.json();

    const existing = prop(task, 'Estimated Cost');
    const has = name => !!task.properties?.[name];

    // Only fill an empty field. Picking between competing quotes is Cole's
    // call, and overwriting would quietly make it for him on arrival order.
    if (existing === null && has('Estimated Cost')) {
      const properties = { 'Estimated Cost': { number: amount } };
      // Cost Source is what tells the readiness gate this is a real number a
      // sub gave us rather than somebody's guess.
      if (has('Cost Source')) properties['Cost Source'] = { select: { name: 'Bid Received' } };

      const patch = await fetch(`${NOTION_API}/pages/${record.task_id}`, {
        method: 'PATCH', headers: nHeaders(token), body: JSON.stringify({ properties }),
      });
      if (!patch.ok) throw new Error(`write cost: ${patch.status} ${(await patch.text()).slice(0, 160)}`);
      record.wrote_cost = true;
    }

    record.notion_synced = true;
    record.task_name = record.task_name || prop(task, 'Task');
  } catch (err) {
    record.notion_error = err.message;
    console.error('submit-quote: Notion mirror failed:', err.message);
  }

  try {
    await supabase('quote_responses', { method: 'POST', body: record });
  } catch (err) {
    // The sub filled in a form and pressed send. If the recording failed, they
    // must be told, because otherwise they believe they have quoted and the
    // number exists nowhere.
    console.error('submit-quote: could not record quote:', err.message);
    return reply(500, {
      error: 'Your quote could not be saved. Please send it to Six Arrows directly so it is not lost.',
      detail: err.message,
    });
  }

  return reply(200, {
    ok: true,
    recorded: true,
    wroteCostToNotion: record.wrote_cost,
    notionSynced: record.notion_synced,
    message: record.wrote_cost
      ? 'Quote received and recorded.'
      : 'Quote received and recorded. Six Arrows already had a number on this task, so yours has been logged for comparison rather than replacing it.',
  });
};
