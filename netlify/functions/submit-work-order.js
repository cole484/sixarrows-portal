// netlify/functions/submit-work-order.js
//
// POST endpoint that records a subcontractor's commitment.
// Called when a sub clicks "Submit Work Order" on the work-order page.
//
// The record of what was agreed lives in the append-only Supabase table
// `work_order_commitments` (see supabase/add-work-order-commitments.sql).
// Resubmitting writes a new row rather than overwriting the last one, so the
// history of what changed and when is preserved.
//
// Notion gets a mirror so the schedule stays live where people work:
//   - Start          (date range, overwritten with sub's committed dates)
//   - Status         (set to "Scheduled")
//   - Sub Commitment (rich_text summary, only on timelines that have the field)
//
// Per-project timeline DBs have drifted, so the page's properties are read
// first and only fields that actually exist are sent. Notion rejects an entire
// PATCH with a 400 if any single property name is unknown, which is what used
// to make every submission fail on projects without a `Sub Commitment` field.
//
// A failed Notion mirror does not fail the submission. The sub has signed, that
// is recorded, and notion_synced/notion_error on the row make a broken mirror
// visible in the data rather than only in the function logs.
//
// Body (JSON):
//   {
//     taskId:            notion page id
//     committedStart:    "YYYY-MM-DD"
//     committedEnd:      "YYYY-MM-DD"
//     workingDays:       number | null
//     paymentType:       "single" | "two" | "three"
//     paymentMilestones: [{ pct, milestone }, ...]
//     preStartBlockers:  string (optional)
//     notes:             string (optional)
//     signatureName:     string
//     contractValue:     number
//     holdbackPct:       number (0 if none)
//     trade:             string
//     projectName:       string
//     pmName:            string
//   }

import { supabase } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type':                 'application/json',
  };
  const reply = (statusCode, body) =>
    ({ statusCode, headers: corsH, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST required' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return reply(500, { error: 'NOTION_TOKEN not set' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'Invalid JSON body' }); }

  // ── Validate ───────────────────────────────────────────────────────────
  const required = ['taskId', 'signatureName', 'committedStart', 'committedEnd', 'paymentType'];
  for (const k of required) {
    if (!payload[k] || (typeof payload[k] === 'string' && !payload[k].trim())) {
      return reply(400, { error: `${k} is required` });
    }
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(payload.committedStart) || !dateRe.test(payload.committedEnd)) {
    return reply(400, { error: 'committedStart and committedEnd must be YYYY-MM-DD' });
  }
  if (payload.committedEnd < payload.committedStart) {
    return reply(400, { error: 'committedEnd cannot be before committedStart' });
  }
  if (!['single', 'two', 'three'].includes(payload.paymentType)) {
    return reply(400, { error: 'paymentType must be single, two, or three' });
  }

  const commitmentText = buildCommitmentText(payload);

  // ── 1. Mirror onto the Notion task ────────────────────────────────────
  // Per-project timeline DBs have drifted apart, so a property that exists on
  // one project is absent on the next, and Notion rejects the whole PATCH with
  // a 400 for any unknown property. Read the page first and send only the
  // properties it actually has.
  let notionSynced = false;
  let notionError  = null;

  try {
    const pageRes = await fetch(`${NOTION_API}/pages/${payload.taskId}`, {
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
      },
    });
    if (!pageRes.ok) throw new Error(`read page ${pageRes.status}: ${(await pageRes.text()).slice(0, 300)}`);
    const page    = await pageRes.json();
    const present = new Set(Object.keys(page.properties || {}));

    const candidates = {
      // The sub's committed window replaces the planned one.
      'Start': {
        date: { start: payload.committedStart, end: payload.committedEnd },
      },
      'Status': { status: { name: 'Scheduled' } },
      // Short human-readable mirror, only where the field exists. Supabase is
      // the record; this is for people reading the task in Notion.
      'Sub Commitment': {
        rich_text: [{ type: 'text', text: { content: commitmentText.slice(0, 2000) } }],
      },
    };

    const properties = {};
    for (const [name, value] of Object.entries(candidates)) {
      if (present.has(name)) properties[name] = value;
    }

    const res = await fetch(`${NOTION_API}/pages/${payload.taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 500)}`);
    notionSynced = true;
  } catch (err) {
    // Swallow it. The commitment row below is what matters, and a failed
    // mirror is our problem to fix, not a reason to tell the sub they failed.
    // The outcome is recorded on that row rather than lost here.
    notionError = err.message;
    console.error('submit-work-order: Notion sync failed:', err);
  }

  // ── 2. Record the commitment, once, including how the sync went ───────
  // The table is append-only by RLS: insert and select only, no update policy.
  // So the sync outcome has to be known before the write, which is why Notion
  // goes first. A resubmission writes a new row; the newest row per task_id is
  // the current commitment and the older rows are the history.
  let commitmentId = null;
  try {
    const inserted = await supabase('work_order_commitments', {
      method: 'POST',
      body: {
        task_id:            payload.taskId,
        work_order_number:  payload.workOrderNumber || null,
        project_name:       payload.projectName     || null,
        trade:              payload.trade           || null,
        committed_start:    payload.committedStart,
        committed_end:      payload.committedEnd,
        working_days:       payload.workingDays ?? null,
        contract_value:     payload.contractValue ?? null,
        cost_source:        payload.costSource || null,
        holdback_pct:       payload.holdbackPct ?? 0,
        payment_type:       payload.paymentType,
        payment_milestones: payload.paymentMilestones || [],
        pre_start_blockers: payload.preStartBlockers || '',
        notes:              payload.notes || '',
        signature_name:     payload.signatureName.trim(),
        commitment_text:    commitmentText,
        notion_synced:      notionSynced,
        notion_error:       notionError,
      },
    });
    commitmentId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
  } catch (err) {
    // Notion may already show Scheduled at this point, but nothing durable
    // recorded what the sub agreed to. Tell them it did not go through so they
    // resubmit; the Notion write is idempotent, so a retry is harmless.
    console.error('submit-work-order: commitment insert failed:', err);
    return reply(500, { error: 'Could not record your submission. Please try again.' });
  }

  return reply(200, {
    success:           true,
    taskId:            payload.taskId,
    commitmentId,
    notionSynced,
    notionError,
    submittedAt:       new Date().toISOString(),
    commitmentPreview: commitmentText,
  });
};

// ── Build a human-readable commitment record stored on the commitment row ──
function buildCommitmentText(d) {
  const tsCT = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  });
  const startNice = fmtDate(d.committedStart);
  const endNice   = fmtDate(d.committedEnd);
  const days      = diffDays(d.committedStart, d.committedEnd);

  const lines = [];
  lines.push(`Signed: ${d.signatureName.trim()}`);
  lines.push(`Submitted: ${tsCT}`);
  lines.push('');
  if (d.trade)       lines.push(`Trade: ${d.trade}`);
  if (d.projectName) lines.push(`Project: ${d.projectName}`);
  lines.push('');
  lines.push(`Committed window: ${startNice} – ${endNice} (${days} day${days === 1 ? '' : 's'})`);
  if (d.workingDays) {
    lines.push(`Working days on site: ${d.workingDays}`);
  }
  lines.push('');
  if (typeof d.contractValue === 'number' && d.contractValue > 0) {
    lines.push(`Contract value: $${Number(d.contractValue).toLocaleString('en-US')}`);
  }
  lines.push('');
  lines.push(`Payment schedule: ${labelForPaymentType(d.paymentType)}`);
  if (Array.isArray(d.paymentMilestones)) {
    for (const m of d.paymentMilestones) {
      const pct = (m.pct != null ? `${m.pct}%` : '?').padStart(4);
      lines.push(`  ${pct}  ${m.milestone || '(unlabeled)'}`);
    }
  }
  if (d.holdbackPct > 0) {
    lines.push(`  ${d.holdbackPct}%  Holdback (released after final approval)`);
  }
  lines.push('');
  if (d.preStartBlockers && d.preStartBlockers.trim()) {
    lines.push(`Pre-start blockers/needs:`);
    lines.push(d.preStartBlockers.trim());
    lines.push('');
  }
  if (d.notes && d.notes.trim()) {
    lines.push(`Notes for ${d.pmName || 'PM'}:`);
    lines.push(d.notes.trim());
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fmtDate(yyyyMmDd) {
  try {
    const d = new Date(yyyyMmDd + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return yyyyMmDd; }
}

function diffDays(startStr, endStr) {
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr   + 'T00:00:00');
  return Math.round((e - s) / 86400000) + 1;
}

function labelForPaymentType(t) {
  return {
    single: 'Single payment on completion',
    two:    'Two payments',
    three:  'Three payments',
  }[t] || t;
}
