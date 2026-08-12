// netlify/functions/scheduling-gate.js
//
// Tier 1 of the subcontractor scheduling agent: look ahead at tasks entering
// the scheduling window and report which ones are not ready to send to a sub,
// naming exactly what is missing and how many days out the task is.
//
// Deterministic. No LLM, no invention, same as notion-weekly-update.js.
//
// The readiness gate is recomputed here rather than read from Notion's
// "Ready to Schedule" formula, for two reasons: the formula is not readable
// through the query API on these databases, and the digest has to say which
// field is missing rather than just pass or fail.
//
//   GET /?dryRun=1           report only, write nothing (this is the default)
//   GET /?apply=1            also set Status to "Needs Info" on blocked tasks
//   GET /?dbId=<id>          run against one timeline DB (default: Johnson)
//   GET /?days=60            lookahead window in days (default 60)
//   GET /?format=text        plain-text digest instead of JSON
//
// Writing is opt-in on purpose. Nothing here sends anything to a sub, and
// nothing changes a task until someone passes apply=1.

import { templateTitleForTrade, TRADES_WITHOUT_TEMPLATE } from './lib/trade-aliases.js';
import { sendSlack, slackConfigured } from './lib/slack.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const TRADE_TEMPLATES_DB_ID = 'be4cee0b-6334-492b-a2d4-e6eeb2ec5edc';

// Pilot scope is Johnson only. Others get added here once Johnson is proven,
// and each needs the same field set (see supabase/add-work-order-commitments
// and the Aug 2026 schema pass) before it will produce anything useful.
const DEFAULT_TIMELINE_DBS = [
  { dbId: 'ba72f6c6-7b93-450c-b5bc-b89f9d162ede', project: 'Johnson' },
];

const DEFAULT_LOOKAHEAD_DAYS = 60;

// Statuses that take a task out of scope: finished, or deliberately parked.
//
// "Scheduled" is deliberately NOT in here. A task marked Scheduled is claiming
// a sub has committed, and that claim is worth checking rather than trusting.
// Johnson currently has a task marked Scheduled with no subcontractor assigned
// at all, which is precisely the kind of thing that turns into a missed start.
const OUT_OF_SCOPE_STATUSES = new Set(['Completed', 'On Hold']);

// Statuses that assert the task is handled. If one of these fails the gate,
// the status is lying and that is worth saying out loud.
const CLAIMS_HANDLED = new Set(['Scheduled', 'In Progress', 'Awaiting Confirmation']);

// Trades whose tasks are reminders to Six Arrows, not work sent to a sub.
// "Order cabinets" is a note to place an order, so demanding a subcontractor,
// a contract value and a signable work order for it is noise. What actually
// matters on these is whether the lead time still fits before the install
// date, which the lead-time check already covers.
const REMINDER_TRADES = new Set(['Material Ordering']);

// ── Notion helpers ────────────────────────────────────────────────────────
function notionHeaders(token) {
  return {
    'Authorization':  `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}

async function notionQueryAll(dbId, token, body = {}) {
  const all = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const payload = { page_size: 100, ...body };
    if (cursor) payload.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST', headers: notionHeaders(token), body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Notion query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    all.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return all;
}

async function notionGetPage(pageId, token) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders(token) });
  if (!res.ok) throw new Error(`Notion page ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'rich_text':    return p.rich_text?.map(t => t.plain_text).join('').trim() || null;
    case 'date':         return p.date || null;                  // {start, end}
    case 'number':       return p.number ?? null;
    case 'checkbox':     return !!p.checkbox;
    case 'select':       return p.select?.name || null;
    case 'status':       return p.status?.name || null;
    case 'multi_select': return (p.multi_select || []).map(o => o.name);
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'relation':     return (p.relation || []).map(r => r.id);
    default:             return null;
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10); }

function daysUntil(iso, from = todayISO()) {
  if (!iso) return null;
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

// ── The gate ──────────────────────────────────────────────────────────────
// Two severities, kept apart because they need different actions.
//
//   blockers  a work order cannot be produced at all. Someone has to fill
//             something in.
//   flags     a work order can be produced, but sending it as-is would be a
//             mistake. Most of these route the task to a quote request rather
//             than a signable work order.
export function evaluateTask(task, ctx) {
  const { templatesByTitle, subsById } = ctx;

  const name     = prop(task, 'Task') || '(untitled)';
  const trade    = prop(task, 'Trade');
  const status   = prop(task, 'Status');
  const dateVal  = prop(task, 'Start') || {};
  const start    = dateVal.start || null;
  const duration = prop(task, 'Duration (days)');
  const leadTime = prop(task, 'Lead time (days)');
  const dod      = prop(task, 'Definition of done');
  const scope    = prop(task, 'Scope of Work');
  const cost     = prop(task, 'Estimated Cost');
  const source   = prop(task, 'Cost Source');
  const subIds   = prop(task, 'Subcontractor') || [];
  const sub      = subIds.length ? subsById[subIds[0]] : null;

  const out      = daysUntil(start);
  const blockers = [];
  const flags    = [];

  // Scope can come from the task or from the trade's template. Either is fine.
  const templateTitle = templateTitleForTrade(trade);
  const template      = templateTitle ? templatesByTitle[templateTitle] : null;
  const templateScope = template ? prop(template, 'Scope') : null;

  if (!trade) {
    blockers.push('no Trade set');
  } else if (!scope && !templateScope) {
    blockers.push(
      TRADES_WITHOUT_TEMPLATE.has(trade)
        ? `no Scope of Work, and trade "${trade}" has no Trade Template to fall back on`
        : `no Scope of Work, and no Trade Template found for "${trade}"`
    );
  }

  // A reminder task produces no work order, so most of the gate does not apply
  // to it. It still needs to say what done looks like and when it happens.
  const isReminder = REMINDER_TRADES.has(trade);

  if (!dod)                       blockers.push('no Definition of done');
  if (!start)                     blockers.push('no Start date');

  if (!isReminder) {
    if (duration == null && !dateVal.end) blockers.push('no Duration and Start is not a date range');
    if (!subIds.length)                   blockers.push('no Subcontractor assigned');
    if (cost == null)                     blockers.push('no Estimated Cost');
  }

  // Money provenance. The work order carries a signature block and a payment
  // schedule computed off this number, so an estimate must not go out as
  // though the sub had agreed to it.
  if (!isReminder && cost != null && source !== 'Bid Received') {
    flags.push({
      kind: 'needs_quote',
      detail: source
        ? `Estimated Cost is set but Cost Source is "${source}", so this is not a number the sub gave us. Send a quote request first.`
        : 'Estimated Cost is set but Cost Source is blank. Confirm whether this is a bid or an estimate.',
    });
  }

  // Lead time versus start. A task whose lead time exceeds the days remaining
  // is already late no matter how complete its fields are, and no amount of
  // filling in Notion fixes it.
  if (leadTime != null && out != null && leadTime > out) {
    flags.push({
      kind: 'lead_time_missed',
      detail: `Lead time is ${leadTime} days but the task starts in ${out}. This is already ${leadTime - out} days behind.`,
    });
  }

  // Subcontractor readiness. Insurance is a condition of sending work, and
  // the data to check it is already in the Subcontractors DB.
  if (sub) {
    const subName  = prop(sub, 'Subcontractor Name') || '(unnamed sub)';
    const subState = prop(sub, 'Status');
    const insured  = prop(sub, 'Insurance on File');
    const coi      = prop(sub, 'COI Expiration');
    const coiEnd   = coi?.start || null;

    if (subState === 'Do Not Use' || subState === 'Inactive') {
      flags.push({ kind: 'sub_unavailable', detail: `${subName} is marked "${subState}" in the Subcontractors DB.` });
    }
    if (!insured) {
      flags.push({ kind: 'coi_missing', detail: `${subName} has no Insurance on File.` });
    } else if (coiEnd && start && coiEnd < start.slice(0, 10)) {
      flags.push({ kind: 'coi_expired', detail: `${subName}'s COI expires ${coiEnd}, before this task starts ${start.slice(0, 10)}.` });
    }
  }

  // A status that claims the work is handled, on a task that cannot produce a
  // work order, is worse than a task that admits it is not ready. Nobody is
  // looking at it.
  if (blockers.length && CLAIMS_HANDLED.has(status)) {
    flags.push({
      kind: 'status_inconsistent',
      detail: `Status is "${status}" but the task is not ready to send. Either it was set optimistically or the commitment never got recorded.`,
    });
  }

  return {
    taskId: task.id,
    name, trade, status, start,
    daysOut: out,
    duration, leadTime,
    estimatedCost: cost,
    costSource: source,
    subName: sub ? prop(sub, 'Subcontractor Name') : null,
    scopeFrom: scope ? 'task' : (templateScope ? 'trade template' : null),
    isReminder,
    blockers,
    flags,
    ready: blockers.length === 0,
  };
}

// ── Digest ────────────────────────────────────────────────────────────────
export function renderText(report) {
  const lines = [];
  lines.push(`Scheduling gate, ${report.generatedAt.slice(0, 10)}`);
  lines.push(`Looking ${report.lookaheadDays} days ahead.`);
  lines.push('');

  for (const p of report.projects) {
    lines.push(`${p.project}: ${p.inWindow} tasks in window, ${p.readyCount} ready, ${p.blockedCount} blocked`);
    lines.push('');

    if (p.error) {
      lines.push(`  Could not read this project: ${p.error}`);
      lines.push('');
      continue;
    }

    const blocked = p.tasks.filter(t => !t.ready).sort((a, b) => (a.daysOut ?? 1e9) - (b.daysOut ?? 1e9));
    const ready   = p.tasks.filter(t => t.ready).sort((a, b) => (a.daysOut ?? 1e9) - (b.daysOut ?? 1e9));

    if (blocked.length) {
      lines.push('  NOT READY');
      for (const t of blocked) {
        lines.push(`  ${String(t.daysOut).padStart(4)}d  ${t.name}${t.trade ? ` (${t.trade})` : ''}`);
        for (const b of t.blockers)     lines.push(`          missing: ${b}`);
        for (const f of t.flags)        lines.push(`          flag: ${f.detail}`);
      }
      lines.push('');
    }

    if (ready.length) {
      lines.push('  READY TO SEND');
      for (const t of ready) {
        lines.push(`  ${String(t.daysOut).padStart(4)}d  ${t.name}${t.trade ? ` (${t.trade})` : ''}${t.isReminder ? '  [reminder, no work order]' : `  sub: ${t.subName || '?'}`}`);
        for (const f of t.flags)        lines.push(`          flag: ${f.detail}`);
      }
      lines.push('');
    }
  }

  if (report.applied) lines.push(`Set Status to "Needs Info" on ${report.applied} task(s).`);
  else                lines.push('Report only. Nothing was written to Notion.');

  return lines.join('\n');
}

// Slack mrkdwn. Deliberately not a code block: alignment looks tidy on a
// desktop and unreadable on a phone, and this gets read on a phone.
export function renderSlack(report) {
  const L = [];
  const day = new Date(report.generatedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'America/Chicago',
  });

  const totalBlocked = report.projects.reduce((n, p) => n + p.blockedCount, 0);
  const totalReady   = report.projects.reduce((n, p) => n + p.readyCount, 0);

  L.push(`*Scheduling gate · ${day}*`);
  L.push(`_Next ${report.lookaheadDays} days · ${totalReady} ready · ${totalBlocked} not ready_`);

  for (const p of report.projects) {
    L.push('');
    L.push(`*${p.project}*`);

    if (p.error) {
      L.push(`Could not read this project: ${p.error}`);
      continue;
    }
    if (!p.tasks.length) {
      L.push('_Nothing entering the window._');
      continue;
    }

    const byDate  = (a, b) => (a.daysOut ?? 1e9) - (b.daysOut ?? 1e9);
    const blocked = p.tasks.filter(t => !t.ready).sort(byDate);
    const ready   = p.tasks.filter(t => t.ready).sort(byDate);

    for (const t of blocked) {
      L.push('');
      L.push(`*${t.daysOut}d* · ${t.name}${t.trade ? ` _(${t.trade})_` : ''}`);
      for (const b of t.blockers) L.push(`  • ${b}`);
      for (const f of t.flags)    L.push(`  :warning: ${f.detail}`);
    }

    if (ready.length) {
      L.push('');
      L.push('*Ready to send*');
      for (const t of ready) {
        L.push(`  ✓ *${t.daysOut}d* · ${t.name} · ${t.isReminder ? '_reminder, no work order_' : (t.subName || 'sub not named')}`);
        for (const f of t.flags) L.push(`    :warning: ${f.detail}`);
      }
    }
  }

  L.push('');
  L.push(report.applied
    ? `_Set Status to "Needs Info" on ${report.applied} task(s)._`
    : '_Report only. Nothing was changed in Notion._');

  return L.join('\n');
}

// ── Handler ───────────────────────────────────────────────────────────────
export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };

  const token = process.env.NOTION_TOKEN;
  if (!token) return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };

  const q     = event.queryStringParameters || {};
  const days  = Number(q.days) > 0 ? Number(q.days) : DEFAULT_LOOKAHEAD_DAYS;
  const apply = q.apply === '1';
  const asText = q.format === 'text';

  // Netlify invokes scheduled functions with a POST whose body carries
  // next_run. A cron run always notifies; a manual run only notifies when
  // asked, so poking the endpoint to look at output does not DM anyone.
  const isScheduledRun = event.httpMethod === 'POST' && String(event.body || '').includes('next_run');
  const notify = isScheduledRun || q.notify === '1';

  const targets = q.dbId
    ? [{ dbId: q.dbId, project: q.project || q.dbId.slice(0, 8) }]
    : DEFAULT_TIMELINE_DBS;

  const today = todayISO();
  const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  try {
    // Trade Templates are workspace-wide, so fetch once and index by title.
    const templatePages  = await notionQueryAll(TRADE_TEMPLATES_DB_ID, token);
    const templatesByTitle = {};
    for (const t of templatePages) {
      const title = prop(t, 'Trade');
      if (title) templatesByTitle[title] = t;
    }

    const report = {
      generatedAt:   new Date().toISOString(),
      lookaheadDays: days,
      window:        { from: today, to: horizon },
      applied:       0,
      projects:      [],
    };

    for (const target of targets) {
      const entry = { project: target.project, dbId: target.dbId, inWindow: 0, readyCount: 0, blockedCount: 0, tasks: [] };

      try {
        const pages = await notionQueryAll(target.dbId, token, {
          filter: {
            and: [
              { property: 'Start', date: { on_or_after:  today   } },
              { property: 'Start', date: { on_or_before: horizon } },
            ],
          },
        });

        // Finished and parked tasks drop out. Everything else gets gated,
        // including tasks that claim to be Scheduled.
        const open = pages.filter(p => !OUT_OF_SCOPE_STATUSES.has(prop(p, 'Status')));

        // Resolve every referenced sub once, not once per task.
        const subIds = [...new Set(open.flatMap(p => prop(p, 'Subcontractor') || []))];
        const subsById = {};
        for (const id of subIds) {
          try { subsById[id] = await notionGetPage(id, token); }
          catch (err) { console.error(`scheduling-gate: could not read sub ${id}:`, err.message); }
        }

        const ctx = { templatesByTitle, subsById };
        entry.tasks    = open.map(p => evaluateTask(p, ctx));
        entry.inWindow = entry.tasks.length;
        entry.readyCount   = entry.tasks.filter(t => t.ready).length;
        entry.blockedCount = entry.tasks.filter(t => !t.ready).length;

        if (apply) {
          for (const t of entry.tasks.filter(x => !x.ready)) {
            if (t.status === 'Needs Info') continue;
            try {
              const res = await fetch(`${NOTION_API}/pages/${t.taskId}`, {
                method: 'PATCH',
                headers: notionHeaders(token),
                body: JSON.stringify({ properties: { Status: { status: { name: 'Needs Info' } } } }),
              });
              if (res.ok) report.applied++;
              else console.error(`scheduling-gate: status write failed for ${t.taskId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
            } catch (err) {
              console.error(`scheduling-gate: status write threw for ${t.taskId}:`, err.message);
            }
          }
        }
      } catch (err) {
        entry.error = err.message;
        console.error(`scheduling-gate: ${target.project} failed:`, err);
      }

      report.projects.push(entry);
    }

    // Delivery is last, and a failure here never fails the run. The report is
    // still returned, so a broken Slack token shows up as a visible error
    // rather than a silent morning with no digest.
    if (notify) {
      if (!slackConfigured()) {
        report.notify = { sent: false, error: 'SLACK_BOT_TOKEN not set' };
      } else {
        try {
          report.notify = { sent: true, ...(await sendSlack(renderSlack(report))) };
        } catch (err) {
          report.notify = { sent: false, error: err.message };
          console.error('scheduling-gate: Slack delivery failed:', err);
        }
      }
    }

    if (asText) {
      return { statusCode: 200, headers: { ...corsH, 'Content-Type': 'text/plain' }, body: renderText(report) };
    }
    return { statusCode: 200, headers: corsH, body: JSON.stringify(report, null, 2) };

  } catch (err) {
    console.error('scheduling-gate error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
