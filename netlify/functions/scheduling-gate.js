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
import { certificatesBySub, verdictForStart, limitsShortfall } from './lib/sub-compliance.js';
import { quotesForProject } from './lib/sub-quotes.js';
import { taskKind, releaseDate, deliveryEstimate, shiftDays } from './lib/task-kind.js';
import { sendSlack, slackConfigured } from './lib/slack.js';
import { sendGmail, gmailConfigured } from './lib/gmail.js';
import { FROM_EMAIL } from './lib/compliance-email.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Notion exposes two different ids per database, and they are easy to confuse:
// a "data source" / collection id (what the MCP tooling and collection:// URLs
// hand you) and the database id (what the REST API wants). Passing a data
// source id to /databases/{id}/query returns 404 object_not_found with a
// message about sharing, which sends you hunting for a permissions problem
// that does not exist. These are database ids.
const TRADE_TEMPLATES_DB_ID = 'be4cee0b-6334-492b-a2d4-e6eeb2ec5edc';

// Pilot scope is Johnson only. Others get added here once Johnson is proven,
// and each needs the same field set (see supabase/add-work-order-commitments
// and the Aug 2026 schema pass) before it will produce anything useful.
const DEFAULT_TIMELINE_DBS = [
  { dbId: '437bb594-ae27-437b-9014-48c5e6739e8c', project: 'Johnson' },
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
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      // A 404 here is far more often the wrong id than a sharing problem,
      // because Notion's message says 'share with your integration' either way.
      const why = res.status === 404
        ? ' (check this is the database id, not the data source / collection id, before chasing sharing)'
        : '';
      throw new Error(`Notion query ${dbId}: ${res.status}${why} ${txt}`);
    }
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

// Every evaluateTask return goes through here, so the internal short-circuit
// and the full service path cannot drift into different shapes.
function result(o) {
  return { ...o, ready: o.blockers.length === 0 };
}

// ── The gate ──────────────────────────────────────────────────────────────
// Two severities, kept apart because they need different actions.
//
//   blockers  a work order cannot be produced at all. Someone has to fill
//             something in.
//   flags     a work order can be produced, but sending it as-is would be a
//             mistake. Most of these route the task to a quote request rather
//             than a signable work order.
// The quote we hold from the sub this task is assigned to, or null. Kept as a
// helper so a gate run with no quote data behaves exactly as it did before,
// rather than reporting "no quote on file" when nothing looked.
function quoteForTask(ctx, subId) {
  if (!ctx.quotes || !subId) return null;
  return ctx.quotes.get(subId) || null;
}

// Rounding, a dropped cent, a number entered without the change: not worth
// raising. A real disagreement between what somebody typed and what the sub
// sent is, and on these jobs that gap runs to thousands.
function costDisagrees(taskCost, quoteTotal) {
  const tolerance = Math.max(50, quoteTotal * 0.01);
  return Math.abs(taskCost - quoteTotal) > tolerance;
}

function moneyText(v) {
  return typeof v === 'number'
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'a price that could not be read';
}

export function evaluateTask(task, ctx) {
  const { templatesByTitle, subsById, certs } = ctx;

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
  const orderedOn = (prop(task, 'Ordered') || {}).start || null;
  // A visit under somebody else's work order. Plumbing is the clear case: the
  // same sub comes out for underslab, rough-in, sewer and trim, and one price
  // covers all four. Each visit is its own task because each has its own date
  // and its own place in the sequence, but there is one price and one document.
  const coveredBy = prop(task, 'Covered by') || [];
  const covers    = prop(task, 'Covers')     || [];

  const out      = daysUntil(start);
  const blockers = [];
  const flags    = [];

  // What sort of task this is decides which questions are even worth asking.
  // A purchase needs no scope paragraph and no certificate of insurance; an
  // inspection needs neither of those nor a price.
  const kind = taskKind(trade, prop(task, 'Task Kind'));

  // Scope can come from the task or from the trade's template. Either is fine.
  const templateTitle = templateTitleForTrade(trade);
  const template      = templateTitle ? templatesByTitle[templateTitle] : null;
  const templateScope = template ? prop(template, 'Scope') : null;

  if (!trade) {
    blockers.push('no Trade set');
  } else if (kind === 'service' && !scope && !templateScope) {
    // Only a work order needs a scope paragraph. Nobody writes a scope of work
    // for ordering cabinets or for the county turning up to inspect a rough-in.
    blockers.push(
      TRADES_WITHOUT_TEMPLATE.has(trade)
        ? `no Scope of Work, and trade "${trade}" has no Trade Template to fall back on`
        : `no Scope of Work, and no Trade Template found for "${trade}"`
    );
  }

  if (!dod)   blockers.push('no Definition of done');
  if (!start) blockers.push('no Start date');

  // An internal task is Six Arrows, the client, or the county. A kickoff
  // meeting, a walkthrough, a rough-in inspection. There is nobody to hire, no
  // price to agree, no certificate to hold and nothing to sign, so a date and a
  // definition of done is the whole gate.
  if (kind === 'internal') {
    return result({
      taskId: task.id, name, trade, kind, status, start,
      daysOut: out, duration, leadTime,
      estimatedCost: cost, costSource: source,
      subName: sub ? prop(sub, 'Subcontractor Name') : null,
      scopeFrom: null, blockers, flags,
    });
  }

  // ── Purchases ───────────────────────────────────────────────────────────
  // A purchase task is Six Arrows buying a thing. Nobody sets foot on the
  // property, so there is no certificate to check, no scope to write and
  // nothing to sign. What can go wrong is simpler and worse: the order never
  // gets placed, and nobody finds out until the framers are standing around
  // waiting for windows.
  //
  // Start on one of these is the day the order has to go in, not the day
  // anything arrives, and Lead time counts forward from there rather than
  // backward. Reading it the other way is what made a window package due today
  // report as 45 days overdue.
  if (kind === 'purchase') {
    const supplier = sub ? prop(sub, 'Subcontractor Name') : null;
    if (!supplier) blockers.push('no supplier assigned (put them in Subcontractor)');

    const eta = deliveryEstimate({ orderedOn, leadTime, today: todayISO() });

    if (orderedOn) {
      flags.push({
        kind: 'ordered',
        detail: eta
          ? `Ordered ${orderedOn} from ${supplier || 'an unnamed supplier'}. With ${leadTime} days of lead that lands about ${eta.on}.`
          : `Ordered ${orderedOn} from ${supplier || 'an unnamed supplier'}. No lead time set, so there is no delivery estimate.`,
        orderedOn, expectedOn: eta ? eta.on : null,
      });
    } else if (out != null && out < 0) {
      // The order-by date has passed and nothing records an order being placed.
      // This is the failure the Ordered field exists to catch.
      blockers.push(`the order-by date was ${start}, ${-out} day(s) ago, and nothing has been recorded as ordered`);
      if (eta) flags.push({ kind: 'delivery_estimate', detail: `Ordered today, ${leadTime} days of lead puts delivery about ${eta.on}.`, expectedOn: eta.on });
    } else if (out === 0) {
      flags.push({
        kind: 'order_today',
        detail: eta
          ? `Today is the order-by date. ${leadTime} days of lead puts delivery about ${eta.on}.`
          : 'Today is the order-by date.',
        expectedOn: eta ? eta.on : null,
      });
    }

    if (cost == null) {
      flags.push({ kind: 'no_price', detail: 'No Estimated Cost on this order. Not a blocker, but the budget will not see it coming.' });
    }

    return result({
      taskId: task.id, name, trade, kind, status, start,
      daysOut: out, duration, leadTime, orderedOn,
      estimatedCost: cost, costSource: source,
      subName: supplier, scopeFrom: null,
      expectedDelivery: eta ? eta.on : null,
      blockers, flags,
    });
  }

  // Duration is deliberately not checked. It used to be a blocker, on the
  // theory that a work order needs a window. It does, but the window is the
  // subcontractor's to give: they know their crew and their backlog, and a
  // number typed into Notion months ago is a guess that then has to be argued
  // out of. The work order asks for a window and the returned commitment sets
  // the task's dates, so a planned duration is a hint and never a gate.
  if (kind === 'service' && !subIds.length) blockers.push('no Subcontractor assigned');

  // ── Covered visits ──────────────────────────────────────────────────────
  // A covered task is real work by a real sub on a real date, so the insurance
  // check below still applies to it: a certificate that lapses between rough-in
  // and trim-out is exactly the gap worth catching, and it would be invisible
  // if only the covering task were checked.
  //
  // What it does NOT need is its own price, its own quote or its own work
  // order. Demanding those would double count Blackstone's countertops in the
  // budget and send a sub two documents for one job.
  const isCovered = coveredBy.length > 0;
  if (isCovered) {
    const parent = (ctx.tasksById || {})[coveredBy[0]];
    flags.push({
      kind: 'covered_by',
      detail: parent
        ? `Price and work order live on "${prop(parent, 'Task') || 'another task'}". This visit is part of that scope, so it needs no separate quote or document.`
        : 'Price and work order live on another task. This visit is part of that scope, so it needs no separate quote or document.',
      coveredBy: coveredBy[0],
    });
  }

  // ── Money ───────────────────────────────────────────────────────────────
  // A work order carries a signature block and a payment schedule, so it needs
  // a price the subcontractor actually gave us. But an empty Estimated Cost
  // does not mean nobody has quoted the job. On Johnson every quote received so
  // far is a PDF in the client's Drive folder and none of them ever reached
  // Notion, so gating on the field alone would send quote requests to people
  // who quoted the work in March.
  //
  // So the field is checked, and when it is empty or unconfirmed the folder is
  // checked too. Which of those two produced the number decides what happens
  // next, and that is the difference between a quote request and a work order.
  const quote = quoteForTask(ctx, subIds[0]);

  if (kind === 'service' && !isCovered) {
    if (cost != null && source === 'Bid Received') {
      // Notion says a sub gave us this number. Where we also hold their quote,
      // the two should agree, and when they do not the document is right: the
      // field was typed by a person and the quote is what the sub actually
      // sent. Worth catching, because the same drift is already visible in the
      // Johnson budget sheet, where the garage door line reads $5,281.88
      // against a quote of $8,451.
      if (quote && quote.total != null && costDisagrees(cost, quote.total)) {
        flags.push({
          kind: 'quote_mismatch',
          detail: `Estimated Cost is ${moneyText(cost)} and marked "Bid Received", but ${quote.file} says ${moneyText(quote.total)}. The document is the record. Check which is right before this goes out under a signature block.`,
          taskCost: cost,
          quoteTotal: quote.total,
          file: quote.file,
        });
      }
    } else if (quote && quote.state === 'current') {
      flags.push({
        kind: 'quote_on_file',
        detail: `${quote.file} has ${moneyText(quote.total)} from ${quote.vendorName || 'this vendor'}, ${quote.reason} Put it on the task as Estimated Cost with Cost Source "Bid Received" and send a work order, not a quote request.`,
        total: quote.total,
        file: quote.file,
        coversWholeScope: quote.coversWholeScope,
        pricedSeparately: quote.pricedSeparately || [],
      });
    } else if (quote && quote.state === 'stale') {
      flags.push({
        kind: 'quote_stale',
        detail: `${quote.file} has ${moneyText(quote.total)} but ${quote.reason} Ask whether the price still holds before sending a work order. That is a text, not a fresh quote request.`,
        total: quote.total,
        file: quote.file,
      });
    } else if (quote && quote.state === 'unread') {
      flags.push({
        kind: 'quote_unread',
        detail: `${quote.file} is on file for this vendor but has not been read yet, so the price is unknown. Run quote-lookup with read= to open it.`,
        file: quote.file,
      });
    } else if (cost == null) {
      blockers.push('no Estimated Cost, and no quote on file for this subcontractor on this project');
    } else {
      // A number exists but nobody says a sub gave it to us, and nothing in the
      // folder backs it up. That is an estimate, and it must not go out under a
      // signature block as though it were agreed.
      flags.push({
        kind: 'needs_quote',
        detail: source
          ? `Estimated Cost is set but Cost Source is "${source}", so this is not a number the sub gave us, and no quote for them is on file. Send a quote request first.`
          : 'Estimated Cost is set but Cost Source is blank, and no quote for this sub is on file. Confirm whether this is a bid or an estimate.',
      });
    }

    // Raised outside the branches above, because it applies whenever we hold a
    // quote with carve-outs and does not care how the task's cost field got
    // filled in. Putting it inside the "no number yet" branch meant that typing
    // the number into Notion silenced the warning, which is backwards: the
    // moment the price is settled is the moment the work order goes out, and
    // the work order is the document that has to name what the price does not
    // cover. Goodnight's $10,800 excludes water and sewer priced per foot;
    // meeting that after the trench is open is a change order and the sub is
    // right.
    if (quote && quote.coversWholeScope === false && (quote.pricedSeparately || []).length) {
      flags.push({
        kind: 'quote_partial',
        detail: `${moneyText(quote.total)} in ${quote.file} does not cover the whole scope. Charged separately: ${quote.pricedSeparately.join('; ')}. The work order has to say so or it turns into a change order.`,
        pricedSeparately: quote.pricedSeparately,
        file: quote.file,
      });
    }
  }

  // Lead time is the runway: how many days before the start date the work
  // order has to go out. A task with 7 days of lead starting on the 17th is a
  // task whose work order belongs in a sub's hands on the 10th.
  //
  // The old check only fired once that day had passed, so on the exact day the
  // work order was due it said nothing at all, and the first thing it ever said
  // was that you were a day late. Cole described the intent in one sentence:
  // ideally we would have put this through the work order system 7 days before
  // it is supposed to happen. A system that only reports the miss cannot help
  // anybody hit it.
  // Services only: the purchase branch returned above, and on a purchase this
  // arithmetic runs the wrong way round entirely.
  if (leadTime != null && out != null && start) {
    const release = releaseDate(start, leadTime);
    if (out === leadTime) {
      flags.push({
        kind: 'release_today',
        detail: `Today is the day. Lead time is ${leadTime} days and the task starts ${start}, so the work order goes out now to stay on schedule.`,
        releaseOn: release,
      });
    } else if (out < leadTime) {
      flags.push({
        kind: 'lead_time_missed',
        // The date the work order was due beats a countdown. "4 days behind"
        // needs arithmetic before it means anything; a date can be compared
        // against a calendar.
        detail: `The work order was due ${release} (lead time ${leadTime} days, starts ${start}), which was ${leadTime - out} day(s) ago.`,
        releaseOn: release,
      });
    }
  }

  // Subcontractor readiness.
  //
  // This is the point Six Arrows decided compliance gets enforced: not by
  // chasing a back catalogue of lapsed certificates, but by refusing to send
  // work to a sub whose paperwork is not right, from here on. So insurance
  // problems are blockers rather than flags, and they are judged against the
  // task's start date rather than today.
  //
  // The certificate itself is the source, read from the document cache, not
  // the Notion checkbox. The checkbox says whether a file exists; only the
  // document says whether Six Arrows is actually covered by it.
  if (sub && kind === 'service') {
    const subName  = prop(sub, 'Subcontractor Name') || '(unnamed sub)';
    const subState = prop(sub, 'Status');

    if (subState === 'Do Not Use' || subState === 'Inactive') {
      flags.push({ kind: 'sub_unavailable', detail: `${subName} is marked "${subState}" in the Subcontractors DB.` });
    }

    const cert = certs ? certs.get(sub.id) : null;
    const { verdict, reason } = verdictForStart(cert, start);

    if (verdict === 'missing' || verdict === 'expired') {
      blockers.push(`${subName}: ${reason}`);
    } else if (verdict === 'review') {
      // Real, and the fix takes days: the sub has to ask their agent to
      // reissue. Blocking is the point, because the alternative is finding out
      // after they are on site.
      blockers.push(`${subName}: ${reason}`);
    } else if (verdict === 'unread') {
      // Not the subcontractor's problem and not a reason to stop the job. It
      // means the reader has not caught up, which resolves on its own.
      flags.push({ kind: 'coi_unread', detail: `${subName}: ${reason}.` });
    }

    // Short limits never block. Per Cole they are reported so he can have the
    // conversation about raising coverage, and work goes ahead meanwhile.
    const short = limitsShortfall(cert);
    if (short) {
      flags.push({
        kind: 'coi_limits_short',
        detail: `${subName} ${short.detail}.`,
        sub: subName,
        subId: sub.id,
        limits: short,
      });
    }
  }

  // A task that carries the price for several visits should say so, because the
  // work order it produces has to list them and, per Cole, offer a payment
  // schedule split across them: subs want paying for the portion performed
  // rather than all at the end.
  if (covers.length) {
    const names = covers
      .map(id => (ctx.tasksById || {})[id])
      .map(t => (t ? prop(t, 'Task') : null))
      .filter(Boolean);
    flags.push({
      kind: 'covers_visits',
      detail: `One price covering ${covers.length + 1} visits${names.length ? `: this one, then ${names.join(', ')}` : ''}. The work order lists all of them and splits the payment across them.`,
      covers,
    });
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

  return result({
    taskId: task.id,
    name, trade, kind, status, start,
    daysOut: out,
    duration, leadTime,
    orderedOn, coveredBy: coveredBy[0] || null, covers,
    estimatedCost: cost,
    costSource: source,
    subName: sub ? prop(sub, 'Subcontractor Name') : null,
    scopeFrom: scope ? 'task' : (templateScope ? 'trade template' : null),
    blockers,
    flags,
  });
}

// ── Digest ────────────────────────────────────────────────────────────────
// Subs whose general liability limits are below what Six Arrows requires,
// collapsed to one entry each however many tasks they appear on. These do not
// block anything. They are a list of conversations for Cole to have, and they
// go at the top because buried in a task's flags is where they would be missed.
function limitsShortList(report) {
  const seen = new Map();
  for (const p of report.projects) {
    for (const t of p.tasks || []) {
      for (const f of t.flags || []) {
        if (f.kind !== 'coi_limits_short') continue;
        if (!seen.has(f.sub)) seen.set(f.sub, { sub: f.sub, detail: f.detail, tasks: [] });
        seen.get(f.sub).tasks.push(`${t.name} (${p.project}, ${t.daysOut}d)`);
      }
    }
  }
  return [...seen.values()];
}

// Tasks whose work order is due to go out today, across every project. A task
// can be on this list and still be blocked: knowing the day has arrived and
// the paperwork is not ready is more useful than either fact alone.
function releaseToday(report) {
  const out = [];
  for (const p of report.projects) {
    for (const t of p.tasks || []) {
      // Both kinds of "today": a work order due out, and an order due to be
      // placed. Different tasks, same answer to the only question that matters
      // in a morning digest, which is what has to happen before tonight.
      if ((t.flags || []).some(f => f.kind === 'release_today' || f.kind === 'order_today')) {
        out.push({ ...t, project: p.project });
      }
    }
  }
  return out;
}

export function renderText(report) {
  const lines = [];
  lines.push(`Scheduling gate, ${report.generatedAt.slice(0, 10)}`);
  lines.push(`Looking ${report.lookaheadDays} days ahead.`);
  lines.push('');

  // First, because it is the only part of this report that is about today.
  // Everything else is a condition; this is an instruction with a deadline
  // that expires tonight.
  const today = releaseToday(report);
  if (today.length) {
    lines.push('  SEND TODAY');
    lines.push('  Work orders due out and orders due to be placed. Tomorrow is late.');
    for (const t of today) {
      const verb = t.kind === 'purchase' ? 'order by' : 'starts';
      lines.push(`    ${t.project}: ${t.name}${t.subName ? ` (${t.subName})` : ''}, ${verb} ${t.start}`);
      if (!t.ready) lines.push(`      Not ready: ${t.blockers.join('; ')}`);
    }
    lines.push('');
  }

  const short = limitsShortList(report);
  if (short.length) {
    lines.push('  COVERAGE BELOW REQUIREMENT');
    lines.push('  Not blocking anything. Worth a conversation about raising it.');
    for (const x of short) {
      lines.push(`    ${x.detail}`);
      lines.push(`      on: ${x.tasks.join(', ')}`);
    }
    lines.push('');
  }

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
        for (const f of t.flags) {
          if (f.kind === 'coi_limits_short') continue;   // already listed at the top
          lines.push(`          flag: ${f.detail}`);
        }
      }
      lines.push('');
    }

    if (ready.length) {
      lines.push('  READY TO SEND');
      for (const t of ready) {
        lines.push(`  ${String(t.daysOut).padStart(4)}d  ${t.name}${t.trade ? ` (${t.trade})` : ''}${t.kind === 'service' ? `  sub: ${t.subName || '?'}` : `  [${t.kind}, no work order]`}`);
        for (const f of t.flags) {
          if (f.kind === 'coi_limits_short') continue;   // already listed at the top
          lines.push(`          flag: ${f.detail}`);
        }
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

  const today = releaseToday(report);
  if (today.length) {
    L.push('');
    L.push(':bell: *Send today*');
    L.push('_Work orders due out and orders due to be placed. Tomorrow is late._');
    for (const t of today) {
      L.push(`  • *${t.project}* · ${t.name}${t.subName ? ` · ${t.subName}` : ''} · ${t.kind === 'purchase' ? 'order by' : 'starts'} ${t.start}`);
      if (!t.ready) L.push(`    _Not ready: ${t.blockers.join('; ')}_`);
    }
  }

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
        L.push(`  ✓ *${t.daysOut}d* · ${t.name} · ${t.kind === 'service' ? (t.subName || 'sub not named') : `_${t.kind}, no work order_`}`);
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
        // The whole timeline, then the window is taken from it in code. One
        // query either way, and it means a covering task four months out can
        // still be named by a covered visit three weeks out.
        const allPages = await notionQueryAll(target.dbId, token);
        const pages = allPages.filter(p => {
          const d = (prop(p, 'Start') || {}).start;
          return d && d.slice(0, 10) >= today && d.slice(0, 10) <= horizon;
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

        // What each sub's certificate actually says. Read from the document
        // cache, so this costs one Drive listing and one query no matter how
        // many subs are involved, and never opens a document.
        const subList = Object.entries(subsById)
          .map(([id, page]) => ({ id, name: prop(page, 'Subcontractor Name') }))
          .filter(x => x.name);
        const certs = await certificatesBySub(subList, process.env.GOOGLE_API_KEY);

        // What price we already hold from each of them on this project. Also
        // cache-only: this opens nothing and costs one Drive listing, so a gate
        // run stays the same shape it was. quote-lookup does the opening.
        // Note what this does NOT report. quotesForProject also returns the
        // files that matched no subcontractor, but subList here is only the
        // subs on tasks inside the window, so "unmatched" from this call means
        // "belongs to a sub with nothing scheduled in the next 90 days", which
        // is not the same thing at all and reads as an alarm about files that
        // are perfectly well filed. quote-lookup asks that question against the
        // whole Subcontractors database, which is the only way to answer it.
        const quotes = (await quotesForProject(subList, target.project, process.env.GOOGLE_API_KEY)).bySub;

        // Keyed on every task in the timeline, not only those inside the
        // window. A rough-in in three weeks can be covered by a work order
        // whose task sits four months out, and naming it "another task" when
        // the name is right there would be a poor showing.
        const tasksById = Object.fromEntries(allPages.map(p => [p.id, p]));

        const ctx = { templatesByTitle, subsById, certs, quotes, tasksById };
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
      // Slack is the intended home for this. Until it is wired up, the digest
      // goes to Cole by email rather than nowhere, because a digest that is
      // computed correctly and delivered to no one is the same as no digest.
      if (slackConfigured()) {
        try {
          report.notify = { channel: 'slack', sent: true, ...(await sendSlack(renderSlack(report))) };
        } catch (err) {
          report.notify = { channel: 'slack', sent: false, error: err.message };
          console.error('scheduling-gate: Slack delivery failed:', err);
        }
      } else if (gmailConfigured()) {
        try {
          const day = new Date(report.generatedAt).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', timeZone: 'America/Chicago',
          });
          const blocked = report.projects.reduce((n, p) => n + p.blockedCount, 0);
          const res = await sendGmail({
            to: FROM_EMAIL,
            subject: `Scheduling gate ${day}: ${blocked} not ready`,
            body: `${renderText(report)}\n\nThis is going to email because Slack is not connected yet. Once SLACK_BOT_TOKEN is set it will arrive there instead.`,
          });
          report.notify = { channel: 'email', sent: true, ...res };
        } catch (err) {
          report.notify = { channel: 'email', sent: false, error: err.message };
          console.error('scheduling-gate: email delivery failed:', err);
        }
      } else {
        report.notify = { sent: false, error: 'no delivery configured (need SLACK_BOT_TOKEN or Gmail)' };
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
