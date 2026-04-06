// netlify/functions/generate-updates.js
// Generates AI-drafted project updates for construction clients
// by reading their Notion build schedule and calling Claude API.
//
// POST body: { clientId, type: 'monday' | 'friday' | 'midweek' }
//
// Writes a draft update to Supabase updates table with approved=false
// Admin reviews and approves before it goes live to the client portal.
//
// Schedule (via Netlify cron — set in netlify.toml):
//   Monday   8:00 AM CT  — week preview + upcoming decisions
//   Friday   4:00 PM CT  — week recap + what's complete
//   Optional midweek via admin manual trigger

import { respond, corsHeaders } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const ANTHROPIC_API  = 'https://api.anthropic.com/v1/messages';

const SB_URL  = () => process.env.SUPABASE_URL;
const SB_KEY  = () => process.env.SUPABASE_ANON_KEY;
const N_TOKEN = () => process.env.NOTION_TOKEN;
const AI_KEY  = () => process.env.ANTHROPIC_API_KEY;

function notionHeaders() {
  return { 'Authorization': `Bearer ${N_TOKEN()}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}
function sbHeaders() {
  return { 'apikey': SB_KEY(), 'Authorization': `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

// Fetch all construction clients with a notion_timeline_db_id
async function getConstructionClients(clientId) {
  let url = `${SB_URL()}/rest/v1/clients?status_type=eq.construction&notion_timeline_db_id=not.is.null&select=id,client_name,project_name,notion_timeline_db_id,pm_name,cx_name`;
  if (clientId) url += `&id=eq.${clientId}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase clients fetch: ${res.status}`);
  return await res.json();
}

// Query Notion database for all tasks
async function getNotionTasks(dbId) {
  const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ page_size: 100, sorts: [{ property: 'Sequence #', direction: 'ascending' }] }),
  });
  if (!res.ok) throw new Error(`Notion query: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

// Extract property value from Notion page
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

// Detect schema version
function detectSchema(pages) {
  if (!pages.length) return 'old';
  const keys = Object.keys(pages[0].properties || {});
  return keys.includes('Task') && keys.includes('Sequence #') ? 'new' : 'old';
}

// Normalize page to task object
function normalizeTask(page, schema) {
  if (schema === 'new') {
    return {
      name:            prop(page, 'Task') || 'Untitled',
      status:          prop(page, 'Status') || 'Needs Scheduling',
      startDate:       prop(page, 'Start') || null,
      sequence:        prop(page, 'Sequence #') || 9999,
      phase:           prop(page, 'Phase') || null,
      trade:           prop(page, 'Trade') || null,
      isMilestone:     prop(page, 'Milestones') || false,
      clientNote:      prop(page, 'Client-facing note') || null,
      definitionOfDone:prop(page, 'Definition of done') || null,
    };
  }
  return {
    name:            prop(page, 'Task Description') || 'Untitled',
    status:          prop(page, 'Status') || 'Needs Scheduling',
    startDate:       prop(page, 'Start Date') || null,
    sequence:        9999,
    phase:           null,
    trade:           prop(page, 'Trade') || null,
    isMilestone:     false,
    clientNote:      prop(page, 'Notes') || null,
    definitionOfDone:null,
  };
}

// Determine if a task was recently completed (within last 7 days)
function isRecentlyCompleted(task) {
  if (task.status !== 'Completed') return false;
  if (!task.startDate) return true; // no date — include if completed
  const taskDate = new Date(task.startDate + 'T00:00:00');
  const cutoff   = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  return taskDate >= cutoff;
}

// Format date nicely
function fmtDate(d) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Build the context block for Claude
function buildContext(client, tasks, schema, type) {
  const completed   = tasks.filter(t => t.status === 'Completed');
  const active      = tasks.filter(t => t.status === 'In Progress');
  const scheduled   = tasks.filter(t => t.status === 'Scheduled');
  const recent      = completed.filter(t => isRecentlyCompleted(t));
  const upcoming    = [...active, ...scheduled].slice(0, 5);
  const milestones  = tasks.filter(t => t.isMilestone);
  const nextMilestone = milestones.find(m => m.status !== 'Completed');
  const totalTasks  = tasks.length;
  const donePct     = totalTasks > 0 ? Math.round(completed.length / totalTasks * 100) : 0;

  const taskLine = t => {
    const date = t.startDate ? ` (${fmtDate(t.startDate)})` : '';
    const dod  = t.definitionOfDone ? `\n     Done when: ${t.definitionOfDone}` : '';
    const note = t.clientNote ? `\n     Note: ${t.clientNote}` : '';
    return `  - ${t.name}${date}${dod}${note}`;
  };

  return `
CLIENT: ${client.client_name}
PROJECT: ${client.project_name || 'Custom Home Build'}
PROJECT MANAGER: ${client.pm_name || client.cx_name || 'Cole'}
UPDATE TYPE: ${type === 'monday' ? 'Monday — Week Preview' : type === 'friday' ? 'Friday — Week Recap' : 'Midweek Progress Update'}
OVERALL PROGRESS: ${completed.length} of ${totalTasks} tasks complete (${donePct}%)

RECENTLY COMPLETED (last 7 days):
${recent.length > 0 ? recent.map(taskLine).join('\n') : '  - No tasks completed in last 7 days'}

CURRENTLY IN PROGRESS:
${active.length > 0 ? active.map(taskLine).join('\n') : '  - No tasks currently in progress'}

SCHEDULED NEXT:
${scheduled.slice(0,4).map(taskLine).join('\n') || '  - No tasks scheduled yet'}

NEXT MILESTONE:
${nextMilestone ? `  - ${nextMilestone.name}${nextMilestone.startDate ? ' — ' + fmtDate(nextMilestone.startDate) : ''}` : '  - No upcoming milestones set'}
`.trim();
}

// Call Claude to generate the update
async function generateWithClaude(context, type, clientName) {
  const typeInstructions = {
    monday: `You are writing a MONDAY morning project update — this sets expectations for the week ahead.
Focus on: what work starts or continues this week, what the client should expect to see happening, any decisions or inputs needed from them, and the positive momentum of the project.`,
    friday: `You are writing a FRIDAY afternoon project update — this recaps the week's accomplishments.
Focus on: what was completed this week, what the crew accomplished, how that advances the project, and what's coming up next week. Celebrate progress.`,
    midweek: `You are writing a MIDWEEK progress update — a brief touchpoint to keep the client informed.
Focus on: what's actively happening right now on site, any notable progress since Monday, and a quick preview of what's coming before the week is out.`,
  };

  const systemPrompt = `You are the project manager for Six Arrows Construction, writing a client-facing project update for ${clientName}'s custom home build.

Your tone: Warm, professional, confident. You sound like a skilled PM who is in complete control of the project and genuinely cares about keeping the client informed and at ease. You write like a real person — not a corporate template, not AI-generated filler. Every sentence should be specific and grounded in the actual project data provided.

Rules:
- Use the client's last name naturally (e.g. "the Smith home")
- Never say "I hope this finds you well" or generic openers
- Never use words like "synergy", "leverage", "utilize", or corporate jargon
- Never write vague filler like "work is progressing nicely"
- Always reference specific tasks by name
- Keep it concise — 150 to 250 words max
- Write in paragraphs, not bullet points
- End with one sentence of forward momentum or an action item if needed
- Sign off with just: "— Your Six Arrows Project Team"

${typeInstructions[type] || typeInstructions.monday}`;

  const userPrompt = `Here is the current project data:\n\n${context}\n\nWrite the ${type} update now. Start directly with the update — no subject line, no "Title:", no preamble.`;

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     AI_KEY(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 500,
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

// Write draft update to Supabase
async function saveDraftUpdate(clientId, title, body, type) {
  const now  = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const res = await fetch(`${SB_URL()}/rest/v1/updates`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({
      client_id:    clientId,
      title,
      body,
      date,
      approved:     false,    // ← DRAFT — admin must approve before client sees it
      approved_at:  null,
      manual:       false,
      update_type:  type,
      generated_at: now.toISOString(),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase write error: ${err}`);
  }

  return await res.json();
}

// Build update title
function buildTitle(client, type) {
  const now  = new Date();
  const week = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

  // Support both POST (manual trigger) and scheduled GET
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    clientId = body.clientId;
    type     = body.type || 'monday';
  } else {
    // Scheduled: determine type by day of week
    const day = new Date().getDay(); // 0=Sun,1=Mon,...,5=Fri
    type = day === 1 ? 'monday' : day === 5 ? 'friday' : 'midweek';
    clientId = event.queryStringParameters?.clientId || null;
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
        const body    = await generateWithClaude(context, type, client.client_name);
        const title   = buildTitle(client, type);
        const saved   = await saveDraftUpdate(client.id, title, body, type);

        results.push({ clientId: client.id, clientName: client.client_name, status: 'draft_saved', title });
      } catch(err) {
        results.push({ clientId: client.id, clientName: client.client_name, status: 'error', error: err.message });
      }
    }

    return respond(200, { generated: results.filter(r => r.status === 'draft_saved').length, results });

  } catch(err) {
    console.error('generate-updates error:', err);
    return respond(500, { error: err.message });
  }
};
