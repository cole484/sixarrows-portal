// netlify/functions/notion-timeline.js
// Reads a client's Notion build schedule database and returns:
//   - tasks: rolling window (3 completed + 1 active + 8 upcoming)
//   - milestones: all tasks with Milestones = true (new schema only)
//   - schema: 'new' | 'old'
//
// New schema fields: Task, Start, Sequence #, Status, Milestones, Client-facing note, Phase, Trade
// Old schema fields: Task Description, Start Date, Status, Trade, Notes
//
// Status values (new): Not Ready to Schedule | Needs Scheduling | Waiting on Client | On Hold | Scheduled | In Progress | Completed
// Status values (old): Needs Scheduling | Estimated Time Frame | Scheduled | In Progress | Completed

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(token) {
  return {
    'Authorization':  `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}

async function queryDatabase(dbId, token, sorts, pageSize = 100) {
  const url = `${NOTION_API}/databases/${dbId}/query`;
  const body = { page_size: pageSize, sorts };

  const res = await fetch(url, {
    method:  'POST',
    headers: notionHeaders(token),
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion query error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.results || [];
}

// Extract a property value from a Notion page object
function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;

  switch(p.type) {
    case 'title':
      return p.title?.map(t => t.plain_text).join('') || null;
    case 'rich_text':
      return p.rich_text?.map(t => t.plain_text).join('') || null;
    case 'date':
      return p.date?.start || null;
    case 'number':
      return p.number ?? null;
    case 'checkbox':
      return p.checkbox ?? false;
    case 'select':
      return p.select?.name || null;
    case 'status':
      return p.status?.name || null;
    default:
      return null;
  }
}

// Detect schema version from page properties
function detectSchema(pages) {
  if (!pages.length) return 'old';
  const keys = Object.keys(pages[0].properties || {});
  return keys.includes('Task') && keys.includes('Sequence #') ? 'new' : 'old';
}

// Normalize a page to a consistent task object
function normalizeTask(page, schema) {
  if (schema === 'new') {
    return {
      id:          page.id,
      name:        prop(page, 'Task')              || 'Untitled',
      status:      prop(page, 'Status')            || 'Needs Scheduling',
      startDate:   prop(page, 'Start')             || null,
      sequence:    prop(page, 'Sequence #')        || 9999,
      phase:       prop(page, 'Phase')             || null,
      trade:       prop(page, 'Trade')             || null,
      isMilestone: prop(page, 'Milestones')        || false,
      clientNote:  prop(page, 'Client-facing note')|| null,
      definitionOfDone: prop(page, 'Definition of done') || null,
      duration:    prop(page, 'Duration (days)')   || null,
    };
  } else {
    // Old schema
    return {
      id:          page.id,
      name:        prop(page, 'Task Description')  || 'Untitled',
      status:      prop(page, 'Status')            || 'Needs Scheduling',
      startDate:   prop(page, 'Start Date')        || null,
      sequence:    9999,
      phase:       null,
      trade:       prop(page, 'Trade')             || null,
      isMilestone: false, // old schema — milestones handled manually
      clientNote:  prop(page, 'Notes')             || null,
      duration:    null,
    };
  }
}

// Status classification
function statusGroup(status) {
  const s = (status || '').toLowerCase();
  if (s === 'completed')                                return 'completed';
  if (s === 'in progress')                              return 'active';
  if (s === 'scheduled')                                return 'scheduled';
  if (s === 'estimated time frame')                     return 'estimated';
  if (s === 'needs scheduling')                         return 'needs_scheduling';
  if (s === 'not ready to schedule')                    return 'not_ready';
  if (s === 'not ready / estimated timeframe')          return 'estimated';
  if (s === 'waiting on client')                        return 'waiting';
  if (s === 'on hold')                                  return 'on_hold';
  return 'needs_scheduling';
}

// Format date for client display
function fmtDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return dateStr; }
}

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsH, body: '' };
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };

  const dbId = event.queryStringParameters?.dbId;
  if (!dbId) return { statusCode: 400, headers: corsH, body: JSON.stringify({ error: 'dbId required' }) };

  try {
    // Query all pages — sort by Sequence # first, fallback to Start Date,
    // then fall back to a no-sort query so we can distinguish "DB has rows
    // but neither sort column exists" from "DB is genuinely empty" from
    // "DB isn't shared with this Notion integration."
    //
    // Capture the first real error so we can surface it if every attempt
    // returns no rows. Notion responds the same way (empty list) whether
    // the database is actually empty or a sort property is missing, so the
    // recoverable errors below are the only signal we have for diagnostics.
    let lastErr = null;
    const trySort = async (sorts) => {
      try { return await queryDatabase(dbId, token, sorts); }
      catch (e) { if (!lastErr) lastErr = e; return []; }
    };

    const [bySequence, byDate] = await Promise.all([
      trySort([{ property: 'Sequence #', direction: 'ascending' }]),
      trySort([{ property: 'Start Date', direction: 'ascending' }]),
    ]);

    // If both sorted queries returned nothing, try unsorted — that
    // succeeds even when the sort columns are missing or named differently.
    let rawPages = bySequence.length ? bySequence : byDate;
    if (!rawPages.length) rawPages = await trySort([]);

    if (!rawPages.length) {
      // Genuinely no rows OR Notion API rejected every query — surface the
      // first concrete error from Notion so misconfiguration is visible.
      const errMsg = (lastErr && lastErr.message) || '';
      let userMsg = 'No tasks found in database';
      let hint    = null;

      if (/object_not_found|Could not find database|integration/i.test(errMsg)) {
        userMsg = 'Notion database not accessible';
        hint    = 'Open the database in Notion → ··· menu → Connections → add the Six Arrows portal integration. The integration must be explicitly shared with each database.';
      } else if (/unauthorized|Invalid token|API token/i.test(errMsg)) {
        userMsg = 'Notion authentication failed';
        hint    = 'Check that NOTION_TOKEN is set correctly in Netlify environment variables.';
      } else if (/validation|Could not find sort property/i.test(errMsg)) {
        userMsg = 'Notion database schema mismatch';
        hint    = 'Verify column names match the expected schema (Task, Status, Start, Sequence #, etc.).';
      } else if (errMsg) {
        userMsg = 'Notion query failed';
        hint    = errMsg.slice(0, 240);
      }

      return { statusCode: 200, headers: corsH, body: JSON.stringify({
        schema: 'unknown', tasks: [], milestones: [],
        message: userMsg,
        ...(hint ? { hint } : {}),
        ...(errMsg ? { notionError: errMsg.slice(0, 500) } : {}),
      })};
    }

    const schema = detectSchema(rawPages);

    // Re-query with correct sort for this schema
    const sorts = schema === 'new'
      ? [{ property: 'Sequence #', direction: 'ascending' }]
      : [{ property: 'Start Date', direction: 'ascending' }];

    const pages = await queryDatabase(dbId, token, sorts);
    const allTasks = pages.map(p => normalizeTask(p, schema));

    // ── Build rolling window ────────────────────────────────────────────────
    const completed = allTasks.filter(t => statusGroup(t.status) === 'completed');
    const active    = allTasks.filter(t => statusGroup(t.status) === 'active');
    const upcoming  = allTasks.filter(t => !['completed','active'].includes(statusGroup(t.status)));

    const windowTasks = [
      ...completed.slice(-3).map(t => ({ ...t, windowRole: 'completed' })),
      ...active.slice(0, 1).map(t => ({ ...t, windowRole: 'active' })),
      ...upcoming.slice(0, 8).map(t => ({ ...t, windowRole: 'upcoming' })),
    ];

    // ── Extract milestones (new schema only) ────────────────────────────────
    const milestones = schema === 'new'
      ? allTasks
          .filter(t => t.isMilestone)
          .map(t => ({
            id:        t.id,
            name:      t.name,
            status:    t.status,
            group:     statusGroup(t.status),
            startDate: t.startDate,
            dateLabel: fmtDate(t.startDate),
            sequence:  t.sequence,
          }))
      : [];

    // ── Format window tasks for client display ──────────────────────────────
    const formattedTasks = windowTasks.map(t => ({
      id:         t.id,
      name:       t.name,
      status:     t.status,
      group:      statusGroup(t.status),
      windowRole: t.windowRole,
      startDate:  t.startDate,
      dateLabel:  fmtDate(t.startDate),
      phase:      t.phase,
      trade:      t.trade,
      clientNote: t.clientNote,
      definitionOfDone: t.definitionOfDone || null,
      duration:   t.duration,
      sequence:   t.sequence,
    }));

    // ── Summary stats ───────────────────────────────────────────────────────
    const totalTasks     = allTasks.length;
    const completedCount = completed.length;
    const overallPct     = totalTasks > 0 ? Math.round(completedCount / totalTasks * 100) : 0;

    return {
      statusCode: 200,
      headers: corsH,
      body: JSON.stringify({
        schema,
        tasks:          formattedTasks,
        milestones,
        totalTasks,
        completedCount,
        overallPct,
        activeTask:     active[0] ? normalizeTask(pages.find(p => p.id === active[0].id), schema) : null,
        nextMilestone:  milestones.find(m => m.group !== 'completed') || null,
      }),
    };

  } catch(err) {
    console.error('notion-timeline error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
