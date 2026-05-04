// netlify/functions/generate-updates.js
// Generates AI-drafted project updates for construction clients
// Reads Notion build schedule + calls Claude API
// Writes draft to Supabase updates table with approved=false
// Admin reviews, edits if needed, and approves before client sees it
//
// Cron schedule (netlify.toml):
//   Monday   5:00 AM CT  — week preview + open decisions
//   Friday   1:00 PM CT  — week recap
//   Midweek  — admin manual trigger only

import { respond, corsHeaders } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';

const SB_URL  = () => process.env.SUPABASE_URL;
const SB_KEY  = () => process.env.SUPABASE_ANON_KEY;
const N_TOKEN = () => process.env.NOTION_TOKEN;
const AI_KEY  = () => process.env.ANTHROPIC_API_KEY;

function notionHeaders() {
  return {
    'Authorization':  `Bearer ${N_TOKEN()}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}
function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

async function getConstructionClients(clientId) {
  let url = `${SB_URL()}/rest/v1/clients?status_type=eq.construction&notion_timeline_db_id=not.is.null&select=id,client_name,project_name,notion_timeline_db_id,pm_name,cx_name`;
  if (clientId) url += `&id=eq.${clientId}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase clients fetch: ${res.status}`);
  return await res.json();
}

async function getNotionTasks(dbId) {
  const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      page_size: 100,
      sorts: [{ property: 'Sequence #', direction: 'ascending' }],
    }),
  });
  if (!res.ok) throw new Error(`Notion query: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch(p.type) {
    case 'title':     return p.title?.map(t => t.plain_text).join('') || null;
    case 'rich_text': return p.rich_text?.map(t => t.plain_text).join('') || null;
    case 'date':      return p.date?.start || null;
    case 'number':    return p.number ?? null;
    case 'checkbox':  return p.checkbox ?? false;
    case 'select':    return p.select?.name || null;
    case 'status':    return p.status?.name || null;
    default:          return null;
  }
}

function detectSchema(pages) {
  if (!pages.length) return 'old';
  const keys = Object.keys(pages[0].properties || {});
  return keys.includes('Task') && keys.includes('Sequence #') ? 'new' : 'old';
}

function normalizeTask(page, schema) {
  if (schema === 'new') {
    return {
      name:             prop(page, 'Task')                 || 'Untitled',
      status:           prop(page, 'Status')               || 'Needs Scheduling',
      startDate:        prop(page, 'Start')                || null,
      sequence:         prop(page, 'Sequence #')           || 9999,
      phase:            prop(page, 'Phase')                || null,
      trade:            prop(page, 'Trade')                || null,
      isMilestone:      prop(page, 'Milestones')           || false,
      longLead:         prop(page, 'Long lead')            || false,
      leadTime:         prop(page, 'Lead time (days)')     || null,
      clientDecision:   prop(page, 'Client Decision')      || false,
      weatherSensitive: prop(page, 'Weather Sensitive')    || false,
      clientNote:       prop(page, 'Client-facing note')   || null,
      definitionOfDone: prop(page, 'Definition of done')   || null,
      internalNote:     prop(page, 'Internal note')        || null,
    };
  }
  return {
    name:             prop(page, 'Task Description') || prop(page, 'Task') || 'Untitled',
    status:           prop(page, 'Status')           || 'Needs Scheduling',
    startDate:        prop(page, 'Start Date')       || prop(page, 'Start') || null,
    sequence:         9999,
    phase:            null,
    trade:            prop(page, 'Trade')            || null,
    isMilestone:      false,
    longLead:         prop(page, 'Long lead')        || false,
    leadTime:         prop(page, 'Lead time (days)') || null,
    clientDecision:   prop(page, 'Client Decision')  || false,
    weatherSensitive: prop(page, 'Weather Sensitive')|| false,
    clientNote:       prop(page, 'Notes')            || prop(page, 'Client-facing note') || null,
    definitionOfDone: prop(page, 'Definition of done') || null,
    internalNote:     prop(page, 'Internal note')    || null,
  };
}

// ── Categorization helpers ────────────────────────────────────────────────

// Trades whose work is meaningfully delayed by rain. Keep this list
// conservative — false positives clutter the weather-warning section
// and erode client trust in the report.
const WEATHER_SENSITIVE_TRADES = new Set([
  'Concrete', 'Excavation & Footings', 'Masonry', 'Roofing', 'Painting',
]);

// Task names that suggest weather sensitivity even when the Trade isn't
// flagged (e.g. material deliveries, exterior installs).
const WEATHER_NAME_PATTERNS = [
  /\bpour(ing|ed)?\b/i,
  /\bconcrete\b/i,
  /\bdeliver(y|ed|ies)?\b.*(rock|stone|concrete|brick|exterior|porch|chimney|roofing|gutter)/i,
  /\b(stone|rock|brick)\b.*\bdeliver/i,
  /\bsiding\s+install/i,
  /\bchimney\s+install/i,
  /\bexterior\s+(paint|stain|finish|trim)/i,
];

// Patterns suggesting the task represents a client decision / selection.
// Used as a LAST-RESORT fallback when neither the explicit Client Decision
// checkbox nor a "Waiting on Client" status is set.
//
// Tightened from the original to drop the bare /\border/ and /\bselected/
// patterns, which falsely matched PM-side ordering and installation tasks
// like "Countertop Order & Installation", "Order Garage Door", and
// "Lumber Package Order". Now we only catch phrases that unambiguously
// signal client input is the bottleneck.
const DECISION_NAME_PATTERNS = [
  /^select\b/i,                          // "Select fireplace stone"
  /\bselect\s*&/i,                       // "Select & Order Tile"
  /\bselection\b/i,                      // "Tile selection", "Final selections"
  /\bselected\s+and\s+ordered\b/i,       // "Fireplace/Firebox Selected and Ordered"
  /\bcustomer\s+decision\b/i,            // explicit parenthetical tag
  /\bclient\s+(decision|approval|sign[\s-]?off)/i,
  /\bapproval\s+needed\b/i,
];

// Statuses considered "in this week's plan" — combines genuinely scheduled
// items with old-schema "Estimated Time Frame" (which was being ignored).
const SCHEDULED_STATUSES = new Set(['Scheduled', 'Estimated Time Frame']);

// Statuses representing open client decisions, regardless of name pattern.
const DECISION_STATUSES = new Set(['Waiting on Client', 'Needs Scheduling']);

function looksWeatherSensitive(task) {
  // Explicit Notion checkbox is the most reliable signal
  if (task.weatherSensitive) return true;
  // Trade-based heuristic for the obvious cases
  if (WEATHER_SENSITIVE_TRADES.has(task.trade)) return true;
  // Name-pattern fallback for material deliveries / exterior installs
  return WEATHER_NAME_PATTERNS.some(p => p.test(task.name || ''));
}

function looksLikeDecision(task) {
  // Already done — not a decision
  if (task.status === 'Completed') return false;
  // Active work — not a decision (someone is doing it)
  if (task.status === 'In Progress') return false;
  // Explicit Notion checkbox is the most reliable signal — wins over
  // everything else. Cole tags any task he wants on the decisions list.
  if (task.clientDecision) return true;
  // Status flag (new-schema only) — definite decision
  if (task.status === 'Waiting on Client') return true;
  // LAST resort: name heuristic — only when Cole hasn't started using the
  // checkbox yet. Tightened patterns above to avoid catching PM ordering
  // / installation tasks.
  if (DECISION_NAME_PATTERNS.some(p => p.test(task.name || ''))) return true;
  return false;
}

// True if the task is "carrying over" from a previous week — In Progress
// AND its Start date is before the current Monday-anchored week.
function isOngoing(task) {
  if (task.status !== 'In Progress') return false;
  if (!task.startDate) return false;
  const start = new Date(task.startDate + 'T00:00:00');
  return start < weekBounds(0).start;
}

// "Targeted" = Status is Estimated Time Frame. These are date windows
// Cole wants to hit but hasn't yet booked subcontractors for. Surface
// distinctly from firmly-scheduled work so the AI can phrase them as
// aims rather than commitments.
function isTargeted(task) {
  return task.status === 'Estimated Time Frame';
}

// Window helpers — return Monday-anchored start/end dates for various
// time windows used by the categorizers below.
function weekBounds(offsetWeeks = 0) {
  const now    = new Date();
  const day    = now.getDay();
  const diff   = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  if (offsetWeeks) monday.setDate(monday.getDate() + 7 * offsetWeeks);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7);
  return { start: monday, end: sunday };
}

// Returns the time window THIS update is forward-looking on, by type:
//   monday  → this week (Mon 00:00 → next Mon 00:00)
//   midweek → today → end of this week
//   friday  → next week (next Mon → following Mon)
function updateForwardWindow(type) {
  if (type === 'friday') return weekBounds(1);
  if (type === 'midweek') {
    const { end } = weekBounds(0);
    const start   = new Date();
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  return weekBounds(0);
}

// Window for "recently completed" — varies by type so the right items
// surface in the right update:
//   monday  → last week (so client sees what just wrapped going into the new week)
//   friday  → this week (the recap)
//   midweek → null (this section is skipped)
function updateCompletedWindow(type) {
  if (type === 'midweek') return null;
  if (type === 'friday')  return weekBounds(0);
  return weekBounds(-1);
}

function dateInWindow(dateStr, win) {
  if (!win || !dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return d >= win.start && d < win.end;
}

// "Could impede progress" = a client decision that's upstream of work
// happening within this update's time window. Long-lead items are always
// flagged regardless of date, since selecting late on a long-lead item
// delays the whole build no matter what.
function decisionImpedesProgress(task, forwardWindow) {
  if (task.longLead) return true;
  if (!task.startDate) return false;
  return dateInWindow(task.startDate, forwardWindow);
}

function isThisWeek(dateStr) {
  return dateInWindow(dateStr, weekBounds(0));
}

function isLastWeek(dateStr) {
  return dateInWindow(dateStr, weekBounds(-1));
}

function isRecentlyCompleted(task) {
  if (task.status !== 'Completed') return false;
  if (!task.startDate) return true;
  const taskDate = new Date(task.startDate + 'T00:00:00');
  const cutoff   = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  return taskDate >= cutoff;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildContext(client, tasks, schema, type) {
  const completed     = tasks.filter(t => t.status === 'Completed');
  const active        = tasks.filter(t => t.status === 'In Progress');
  const scheduledRaw  = tasks.filter(t => SCHEDULED_STATUSES.has(t.status));
  const milestones    = tasks.filter(t => t.isMilestone);
  const nextMilestone = milestones.find(m => m.status !== 'Completed');
  const totalTasks    = tasks.length;
  const donePct       = totalTasks > 0 ? Math.round(completed.length / totalTasks * 100) : 0;

  // Time windows for THIS update
  const forwardWindow   = updateForwardWindow(type);   // when current decisions impede progress
  const completedWindow = updateCompletedWindow(type); // null for midweek (skip section)

  // Recent completions, scoped to the right window for this update type
  const recent = completedWindow
    ? completed.filter(t => dateInWindow(t.startDate, completedWindow) || !t.startDate)
    : [];

  // Decisions resolved first so we can exclude them from the scheduled
  // bucket below — otherwise the same item would appear in two sections
  // of the data context and the AI would have to guess which one wins.
  const decisions         = tasks.filter(looksLikeDecision);
  const decisionsImpeding = decisions.filter(d => decisionImpedesProgress(d, forwardWindow));
  const decisionIds       = new Set(decisions.map(d => d.name));

  // Tasks happening THIS week = active + scheduled with a Start date inside
  // the current week. Scheduled-without-date items go to "next up" instead.
  // Decision-tagged items are explicitly removed so they only appear in
  // the Decisions section of the context.
  const activeOrThisWeek = [
    ...active,
    ...scheduledRaw.filter(t => isThisWeek(t.startDate)),
  ].filter(t => !decisionIds.has(t.name));

  const upcoming = scheduledRaw
    .filter(t => !isThisWeek(t.startDate) && !decisionIds.has(t.name))
    .sort((a, b) => {
      const da = a.startDate ? new Date(a.startDate).getTime() : Infinity;
      const db = b.startDate ? new Date(b.startDate).getTime() : Infinity;
      return da - db;
    });

  // Weather-sensitive tasks happening this week
  const weatherTasks = activeOrThisWeek.filter(looksWeatherSensitive);

  const taskLine = (t, extraTags = []) => {
    const date = t.startDate ? ` (${fmtDate(t.startDate)})` : '';
    const tags = [...extraTags];
    if (isOngoing(t))         tags.push('ONGOING');
    if (isTargeted(t))        tags.push('TARGETED');                        // Estimated Time Frame
    if (t.longLead)           tags.push('LONG LEAD');
    if (t.leadTime)           tags.push(`Lead: ${t.leadTime}d`);
    if (t.clientDecision)     tags.push('CLIENT DECISION (checkbox)');
    if (t.weatherSensitive)   tags.push('WEATHER-SENSITIVE (checkbox)');
    if (t.trade)              tags.push(`Trade: ${t.trade}`);
    const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
    const dod    = t.definitionOfDone ? `\n     Done when: ${t.definitionOfDone}` : '';
    const note   = t.clientNote ? `\n     Note: ${t.clientNote}` : '';
    return `  - ${t.name}${date}${tagStr}${dod}${note}`;
  };

  const fmtList = (arr, taggers = () => []) =>
    arr.length > 0 ? arr.map(t => taskLine(t, taggers(t))).join('\n') : '  - (none)';

  // For Monday: last week's completions. For Friday: this week's. For midweek: skip.
  const recentLabel = type === 'friday'
    ? 'COMPLETED THIS WEEK:'
    : type === 'midweek'
      ? null
      : 'COMPLETED LAST WEEK:';

  const recentSection = recentLabel
    ? `\n${recentLabel}\n${fmtList(recent)}\n`
    : '';

  // Forward window header for the impede-progress decision rule
  const forwardWindowLabel = type === 'friday' ? 'next week'
                            : type === 'midweek' ? 'rest of this week'
                            : 'this week';

  return `
CLIENT: ${client.client_name}
PROJECT: ${client.project_name || 'Custom Home Build'}
PROJECT MANAGER: ${client.pm_name || client.cx_name || 'Cole'}
UPDATE TYPE: ${type === 'monday' ? 'Monday Week Preview' : type === 'friday' ? 'Friday Week Recap' : 'Midweek Progress Update'}
TIME WINDOW THIS UPDATE COVERS: ${forwardWindowLabel}
OVERALL PROGRESS: ${completed.length} of ${totalTasks} tasks complete (${donePct}%)
${recentSection}
ACTIVE OR SCHEDULED THIS WEEK:
${fmtList(activeOrThisWeek, t => looksWeatherSensitive(t) ? ['WEATHER-SENSITIVE'] : [])}

UPCOMING (scheduled, beyond this week):
${fmtList(upcoming.slice(0, 6))}

NEXT MILESTONE:
${nextMilestone ? `  - ${nextMilestone.name}${nextMilestone.startDate ? ' (' + fmtDate(nextMilestone.startDate) + ')' : ''}` : '  - No upcoming milestones set'}

OPEN CLIENT DECISIONS (selections, approvals, ordering):
${fmtList(decisions, t => decisionImpedesProgress(t, forwardWindow) ? ['IMPEDES PROGRESS'] : [])}

WEATHER-SENSITIVE WORK SCHEDULED THIS WEEK:
${weatherTasks.length > 0 ? weatherTasks.map(t => `  - ${t.name}${t.trade ? ' [' + t.trade + ']' : ''}`).join('\n') : '  - (none)'}
`.trim();
}

async function generateWithClaude(context, type, clientName, pmName) {
  const pm = pmName || 'Cole';

  const typeInstructions = {
    monday: `This is a MONDAY project update — it sets the week's expectations.

OUTPUT EXACTLY this structure, in this order. Skip the entire heading + bullets for any section that has zero items. Do not fabricate items.

Monday project update:

Completed last week:
- One bullet per item in COMPLETED LAST WEEK. Be specific about what wrapped.

Scheduled for this week:
- One bullet per task in ACTIVE OR SCHEDULED THIS WEEK. Name the task plainly. If the data shows [ONGOING], phrase it as "X continues" or "X carries over from last week" — never as if it's just starting. If [TARGETED], phrase it as a target window not a firm commitment ("We're aiming to start X this week").

Coming up after this week:
- One bullet per item in UPCOMING, top 3-5. These are tasks scheduled beyond this week. If the upcoming list is empty, omit this heading entirely.

Decisions needed:
- One bullet per item in OPEN CLIENT DECISIONS. Be specific about WHAT decision the client owns (selection, vendor pick, equipment choice, approval).

Decisions that could impede progress at current stage:
- Subset of the above marked [IMPEDES PROGRESS]. Use the same language as the broader Decisions section but only the urgent ones. Omit this heading if none are flagged.

Tasks susceptible to weather (rain) delays this week:
- One bullet per item in WEATHER-SENSITIVE WORK SCHEDULED THIS WEEK. Omit this heading entirely if none.`,

    friday: `This is a FRIDAY project update — a recap of the week with a brief look ahead.

OUTPUT EXACTLY this structure, in this order. Skip any section with zero items.

Friday project update:

Completed this week:
- One bullet per item in COMPLETED THIS WEEK.

Currently in progress:
- One bullet per active task that will carry into next week. If [ONGOING], phrase as "X continues" — not as if it's just starting.

On deck for next week:
- One bullet per upcoming item, top 3-5 by start date.

Decisions needed:
- One bullet per open client decision.

Decisions that could impede progress:
- Subset flagged [IMPEDES PROGRESS]. These would block work scheduled for next week. Omit if none.`,

    midweek: `This is a MIDWEEK project update — short, focused on what is happening right now.

OUTPUT EXACTLY this structure, in this order. Skip any section with zero items.

Midweek project update:

In progress now:
- One bullet per active task today. If [ONGOING], phrase as "X continues."

Finishing up this week:
- Tasks scheduled to wrap before Friday.

Decisions needed:
- One bullet per open client decision.

Decisions that could impede progress at current stage:
- Subset flagged [IMPEDES PROGRESS]. These would block work in the rest of this week. Omit if none.

Tasks susceptible to weather (rain) delays this week:
- Weather-sensitive items remaining this week. Omit if none.`,
  };

  const systemPrompt = `You are ${pm}, the project manager at Six Arrows Construction, writing the weekly project status update for the ${clientName} build. This is an operational status report sent to the client, not a friendly note.

VOICE:
- Direct, matter-of-fact, operational. The reader is the client, who wants to know what is happening and what they need to do.
- No prose openers. No "Happy Monday." No "Hope you're doing well."
- No sign-off. The admin will add personal touches when reviewing.
- Reference tasks by their actual names from the data provided. Do not invent tasks.
- Be specific. Avoid vague phrases like "work is progressing", "things are on track", "moving along nicely."

FORMATTING:
- Begin with the exact heading "Monday project update:" / "Friday project update:" / "Midweek project update:" — chosen by the type instructions below.
- Bullet points use a hyphen and a space: "- Item"
- One bullet = one clear sentence (or sentence fragment).
- No em dashes — use commas, colons, periods, or parentheses instead.
- No corporate jargon ("leverage", "synergy", "touch base", "circle back").
- Use the EXACT section headers shown in the type instructions, including the colon and capitalization.
- Skip any section heading entirely if it has zero items. Do not write "None" or leave an empty bullet.

DATA TAGS:
The data block uses bracket tags to flag attributes. Use these to choose what to surface AND to phrase the bullet correctly.
- [ONGOING] → task is In Progress and started before this week. Phrase the bullet as a continuation: "X continues", "X carries over from last week", "Crews continue X." Do NOT phrase it as if it's just starting.
- [TARGETED] → task is in an Estimated Time Frame (a target window we want to hit, not yet booked with subs). Phrase as an aim, not a commitment: "We're aiming to start X this week", "X is targeted for this week pending sub confirmation", "Targeting X to begin midweek." Never write "X is scheduled for this week" — it isn't yet.
- [WEATHER-SENSITIVE] → include in the weather section if the type instructions has one.
- [IMPEDES PROGRESS] → include in the "Decisions that could impede progress" section.
- [LONG LEAD] → consider this as urgent for the impedes-progress section, even if no other flag is set.
- [CLIENT DECISION (checkbox)] → Cole has explicitly tagged this as awaiting client input. Treat as definitive — always include in Decisions needed.
- [WEATHER-SENSITIVE (checkbox)] → Cole has explicitly tagged this as weather-sensitive. Include in the weather section regardless of trade.
- [Trade: X] → use only when relevant for context; do not list trades just to fill space.

USING "DONE WHEN:" AND "NOTE:" LINES
- The "Done when:" line under a task is the internal acceptance criteria for what counts as complete. For the focal active or in-progress tasks of the week — typically 1 to 3 bullets that represent the headline work — you may paraphrase this into the bullet to set client expectations. Example: instead of "Plumbing rough-in continues," write "Plumbing rough-in continues — testing supply lines and DWV before walls close." Keep it to one phrase. Do NOT do this for every bullet (it bloats the update). Do NOT quote verbatim. Do NOT add it to decision items, weather items, or upcoming items — only to the focal active work.
- The "Note:" line is the client-facing note Cole has written and is safe to paraphrase. If a "Note:" exists for a task you're including, prefer using that phrasing over inventing your own.

${typeInstructions[type] || typeInstructions.monday}`;

  const userPrompt = `Here is the current project data:\n\n${context}\n\nWrite the update now. Begin directly with the heading line — no preamble.`;

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          AI_KEY(),
      'anthropic-version':  '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 600,
      messages:   [{ role: 'user', content: userPrompt }],
      system:     systemPrompt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

async function saveDraftUpdate(clientId, title, body, type) {
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const res = await fetch(`${SB_URL()}/rest/v1/updates`, {
    method:  'POST',
    headers: sbHeaders(),
    body:    JSON.stringify({
      client_id:    clientId,
      title,
      body,
      date,
      approved:     false,
      approved_at:  null,
      manual:       false,
      update_type:  type,
      generated_at: now.toISOString(),
    }),
  });

  if (!res.ok) throw new Error(`Supabase write: ${await res.text()}`);
  return await res.json();
}

function buildTitle(client, type) {
  const now    = new Date();
  const week   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const labels = { monday: 'Week Preview', friday: 'Weekly Recap', midweek: 'Progress Update' };
  return `${labels[type] || 'Update'} — Week of ${week}`;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const token = N_TOKEN();
  const aiKey = AI_KEY();
  if (!token) return respond(500, { error: 'NOTION_TOKEN not configured' });
  if (!aiKey) return respond(500, { error: 'ANTHROPIC_API_KEY not configured' });

  let clientId, type;

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    clientId   = body.clientId;
    type       = body.type || 'monday';
  } else {
    const day = new Date().getDay();
    type      = day === 1 ? 'monday' : day === 5 ? 'friday' : 'midweek';
    clientId  = event.queryStringParameters?.clientId || null;
  }

  try {
    const clients = await getConstructionClients(clientId);
    if (!clients.length) return respond(200, { message: 'No eligible clients found', generated: 0 });

    const results = [];

    for (const client of clients) {
      try {
        const pages   = await getNotionTasks(client.notion_timeline_db_id);
        const schema  = detectSchema(pages);
        const tasks   = pages.map(p => normalizeTask(p, schema));
        const context = buildContext(client, tasks, schema, type);
        const pmName  = client.pm_name || client.cx_name || 'Cole';
        const body    = await generateWithClaude(context, type, client.client_name, pmName);
        const title   = buildTitle(client, type);
        await saveDraftUpdate(client.id, title, body, type);
        results.push({ clientId: client.id, clientName: client.client_name, status: 'draft_saved', title });
      } catch(err) {
        results.push({ clientId: client.id, clientName: client.client_name, status: 'error', error: err.message });
      }
    }

    return respond(200, {
      generated: results.filter(r => r.status === 'draft_saved').length,
      results,
    });

  } catch(err) {
    console.error('generate-updates error:', err);
    return respond(500, { error: err.message });
  }
};
