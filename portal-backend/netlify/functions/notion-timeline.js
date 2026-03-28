// netlify/functions/notion-timeline.js
// Reads a client's timeline Notion database
// Returns tasks grouped by status + auto-generates client update drafts

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ── Update generation rules ───────────────────────────────────────────────────
// Each rule defines: which status change triggers it, minimum priority,
// and the template for the generated client-facing update.
const UPDATE_RULES = [
  {
    triggerStatus: 'Completed',
    minPriority: null, // any priority
    titleTemplate: (task) => `${task.trade || task.title} Complete`,
    bodyTemplate: (task) => {
      const trade = task.trade ? task.trade.toLowerCase() : task.title.toLowerCase();
      const templates = {
        'framing':          `Framing is complete. Your home's structural frame is up and dried in — a major milestone in the build.`,
        'foundation':       `Foundation and slab work is complete. The base of your home is in the ground.`,
        'roofing':          `Roofing is complete. The structure is now weathertight.`,
        'mechanicals':      `Mechanical rough-in is complete. Plumbing, electrical, and HVAC systems are roughed in and ready for inspection.`,
        'plumbing':         `Plumbing rough-in is complete and ready for inspection.`,
        'electric':         `Electrical rough-in is complete and ready for inspection.`,
        'hvac':             `HVAC systems are installed and roughed in.`,
        'insulation':       `Insulation is complete throughout the home.`,
        'drywall':          `Drywall is hung and taped. The interior spaces are starting to take shape.`,
        'painting':         `Painting is complete throughout the home.`,
        'flooring':         `Flooring installation is complete.`,
        'cabinets':         `Cabinetry is installed. The kitchen and bathrooms are coming together.`,
        'tile':             `Tile work is complete throughout the home.`,
        'counters':         `Countertops are installed.`,
        'trim & molding':   `Trim work and moldings are complete throughout the home.`,
        'landscaping':      `Final grading and landscaping is complete.`,
        'inspection':       `Inspection passed. We are cleared to move forward.`,
      };
      // Find a matching template or use a generic one
      const match = Object.keys(templates).find(k => trade.includes(k));
      return match ? templates[match] : `${task.trade || task.title} has been completed on schedule.`;
    },
  },
  {
    triggerStatus: 'In Progress',
    minPriority: 'High',
    titleTemplate: (task) => `${task.trade || task.title} Underway`,
    bodyTemplate: (task) => {
      const trade = task.trade ? task.trade.toLowerCase() : task.title.toLowerCase();
      const templates = {
        'framing':    `Framing has begun. The structural skeleton of your home is being assembled.`,
        'roofing':    `Roofing crews are on site. Sheathing and shingles are going on now.`,
        'mechanicals':`Mechanical rough-in has started. Plumbing, electrical, and HVAC work is underway.`,
        'drywall':    `Drywall installation has started. The walls and ceilings are being closed in.`,
        'painting':   `Painting has started throughout the home.`,
        'flooring':   `Flooring installation is underway.`,
        'cabinets':   `Cabinet installation has begun.`,
      };
      const match = Object.keys(templates).find(k => trade.includes(k));
      return match ? templates[match] : `${task.trade || task.title} is currently underway.`;
    },
  },
  {
    triggerStatus: 'In Progress',
    minPriority: null,
    titleTemplate: (task) => `Build Update — ${task.trade || task.title}`,
    bodyTemplate: (task) => `Work has begun on ${task.trade || task.title}. ${task.notes ? task.notes : 'We will keep you updated as this phase progresses.'}`,
  },
];

// ── Notion helpers ────────────────────────────────────────────────────────────
async function notionPost(path, body, token) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Query entire database ─────────────────────────────────────────────────────
async function queryDatabase(databaseId, token, filter = null) {
  const allResults = [];
  let cursor = undefined;

  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;

    const data = await notionPost(`/databases/${databaseId}/query`, body, token);
    allResults.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return allResults;
}

// ── Parse a database page into a clean task object ───────────────────────────
function parseTask(page) {
  const props = page.properties;

  function getText(prop) {
    if (!prop) return '';
    if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || '';
    if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || '';
    return '';
  }

  function getSelect(prop) {
    if (!prop) return null;
    if (prop.type === 'status') return prop.status?.name || null;
    if (prop.type === 'select') return prop.select?.name || null;
    return null;
  }

  function getDate(prop) {
    if (!prop || prop.type !== 'date') return null;
    return prop.date?.start || null;
  }

  function getNumber(prop) {
    if (!prop || prop.type !== 'number') return null;
    return prop.number;
  }

  return {
    id: page.id,
    title: getText(props['Task Description']),
    status: getSelect(props['Status']),
    trade: getSelect(props['Trade']),
    priority: getSelect(props['Priority']),
    startDate: getDate(props['Start Date']),
    completionPct: getNumber(props['Completion %']),
    notes: getText(props['Notes']),
    chronologicalOrder: getText(props['Chronological Order']),
    workstream: getSelect(props['Workstream']),
    lastEdited: page.last_edited_time,
  };
}

// ── Group tasks by status ─────────────────────────────────────────────────────
function groupByStatus(tasks) {
  const groups = {
    completed: [],
    inProgress: [],
    scheduled: [],
    needsScheduling: [],
    estimatedTimeFrame: [],
    na: [],
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'Completed': groups.completed.push(task); break;
      case 'In Progress': groups.inProgress.push(task); break;
      case 'Scheduled': groups.scheduled.push(task); break;
      case 'Needs Scheduling': groups.needsScheduling.push(task); break;
      case 'Estimated Time Frame': groups.estimatedTimeFrame.push(task); break;
      case 'N/A': groups.na.push(task); break;
    }
  }

  return groups;
}

// ── Generate portal milestone items from tasks ────────────────────────────────
function generateMilestones(tasks) {
  // Only show significant tasks as milestones
  // Priority: completed items + in-progress + next scheduled
  const completed  = tasks.filter(t => t.status === 'Completed')
    .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const inProgress = tasks.filter(t => t.status === 'In Progress');
  const upcoming   = tasks.filter(t => ['Scheduled','Estimated Time Frame'].includes(t.status))
    .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''))
    .slice(0, 4); // show next 4

  const toMilestone = (task, done) => ({
    title: task.trade || task.title,
    date: task.startDate
      ? new Date(task.startDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})
      : '',
    note: task.notes || '',
    done,
    status: task.status,
  });

  return [
    ...completed.map(t => toMilestone(t, true)),
    ...inProgress.map(t => toMilestone(t, false)),
    ...upcoming.map(t => toMilestone(t, false)),
  ];
}

// ── Generate draft client updates from recently changed tasks ─────────────────
function generateUpdateDrafts(tasks, lookbackDays = 14) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  // Find tasks edited recently
  const recentTasks = tasks.filter(task => {
    const edited = new Date(task.lastEdited);
    return edited > cutoff;
  });

  const drafts = [];

  for (const task of recentTasks) {
    // Find matching rule
    const rule = UPDATE_RULES.find(r => {
      if (r.triggerStatus !== task.status) return false;
      if (r.minPriority && task.priority !== r.minPriority) return false;
      return true;
    });

    if (!rule) continue;

    // Don't generate for N/A or trivial tasks
    if (!task.trade && !task.title) continue;
    if (task.status === 'N/A') continue;

    const title = rule.titleTemplate(task);
    const body  = rule.bodyTemplate(task);
    const date  = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

    drafts.push({
      title,
      body,
      date,
      triggerTask: task.title,
      triggerStatus: task.status,
      approved: false, // client sees it only after you approve
    });
  }

  // Deduplicate by title
  const seen = new Set();
  return drafts.filter(d => {
    if (seen.has(d.title)) return false;
    seen.add(d.title);
    return true;
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) return respond(500, { error: 'NOTION_TOKEN not configured' });

  const databaseId = event.queryStringParameters?.databaseId;
  if (!databaseId) return respond(400, { error: 'databaseId query parameter required' });

  const lookbackDays = parseInt(event.queryStringParameters?.lookbackDays || '14');

  try {
    const pages      = await queryDatabase(databaseId, token);
    const tasks      = pages.map(parseTask);
    const grouped    = groupByStatus(tasks);
    const milestones = generateMilestones(tasks);
    const updateDrafts = generateUpdateDrafts(tasks, lookbackDays);

    // Compute overall completion %
    const totalTasks     = tasks.filter(t => t.status !== 'N/A').length;
    const completedTasks = grouped.completed.length;
    const completionPct  = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return respond(200, {
      databaseId,
      totalTasks,
      completedTasks,
      completionPct,
      grouped,
      milestones,
      updateDrafts,
      _meta: { taskCount: tasks.length, lookbackDays },
    });

  } catch (err) {
    console.error('notion-timeline error:', err);
    return respond(500, { error: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}
