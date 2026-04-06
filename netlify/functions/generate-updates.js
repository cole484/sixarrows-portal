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
      clientNote:       prop(page, 'Client-facing note')   || null,
      definitionOfDone: prop(page, 'Definition of done')   || null,
    };
  }
  return {
    name:             prop(page, 'Task Description') || 'Untitled',
    status:           prop(page, 'Status')           || 'Needs Scheduling',
    startDate:        prop(page, 'Start Date')       || null,
    sequence:         9999,
    phase:            null,
    trade:            prop(page, 'Trade')            || null,
    isMilestone:      false,
    clientNote:       prop(page, 'Notes')            || null,
    definitionOfDone: null,
  };
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
  const scheduled     = tasks.filter(t => t.status === 'Scheduled');
  const waitingClient = tasks.filter(t => t.status === 'Waiting on Client');
  const recent        = completed.filter(t => isRecentlyCompleted(t));
  const upcoming      = [...active, ...scheduled].slice(0, 5);
  const milestones    = tasks.filter(t => t.isMilestone);
  const nextMilestone = milestones.find(m => m.status !== 'Completed');
  const totalTasks    = tasks.length;
  const donePct       = totalTasks > 0 ? Math.round(completed.length / totalTasks * 100) : 0;

  const taskLine = t => {
    const date = t.startDate ? ` (${fmtDate(t.startDate)})` : '';
    const dod  = t.definitionOfDone ? `\n     Done when: ${t.definitionOfDone}` : '';
    const note = t.clientNote ? `\n     Note: ${t.clientNote}` : '';
    return `  - ${t.name}${date}${dod}${note}`;
  };

  const decisionsSection = waitingClient.length > 0
    ? `\nDECISIONS NEEDED FROM CLIENT:\n${waitingClient.map(taskLine).join('\n')}`
    : '\nDECISIONS NEEDED FROM CLIENT:\n  - None at this time';

  return `
CLIENT: ${client.client_name}
PROJECT: ${client.project_name || 'Custom Home Build'}
PROJECT MANAGER: ${client.pm_name || client.cx_name || 'Cole'}
UPDATE TYPE: ${type === 'monday' ? 'Monday Week Preview' : type === 'friday' ? 'Friday Week Recap' : 'Midweek Progress Update'}
OVERALL PROGRESS: ${completed.length} of ${totalTasks} tasks complete (${donePct}%)

RECENTLY COMPLETED (last 7 days):
${recent.length > 0 ? recent.map(taskLine).join('\n') : '  - No tasks completed in last 7 days'}

CURRENTLY IN PROGRESS:
${active.length > 0 ? active.map(taskLine).join('\n') : '  - No tasks currently in progress'}

SCHEDULED NEXT:
${scheduled.slice(0,4).map(taskLine).join('\n') || '  - No tasks scheduled yet'}

NEXT MILESTONE:
${nextMilestone ? `  - ${nextMilestone.name}${nextMilestone.startDate ? ' (' + fmtDate(nextMilestone.startDate) + ')' : ''}` : '  - No upcoming milestones set'}
${decisionsSection}
`.trim();
}

async function generateWithClaude(context, type, clientName, pmName) {
  const pm = pmName || 'Cole';

  const typeInstructions = {
    monday: `This is a MONDAY MORNING update — it sets the week's expectations.
Structure the update with these exact sections in this order:
1. A short 1-2 sentence opening that sets the tone for the week ahead. Be specific about what is happening this week.
2. "Completed last week:" followed by bullet points of what was finished (omit this section if nothing was completed).
3. "This week:" followed by bullet points of what is actively happening or starting this week.
4. "Coming up next:" followed by bullet points of the next 2-3 tasks on the schedule with estimated dates where available.
5. "Your input needed:" section ONLY if there are decisions needed from the client — list each one as a bullet. If no decisions needed, omit this section entirely.
6. Sign off.`,

    friday: `This is a FRIDAY AFTERNOON recap — it celebrates what was accomplished this week.
Structure the update with these exact sections in this order:
1. A short 1-2 sentence opening that acknowledges the week's work with energy and confidence.
2. "Completed this week:" followed by bullet points of everything finished this week. Be specific.
3. "Currently in progress:" followed by bullet points of active work that will carry into next week.
4. "On deck for next week:" followed by bullet points of the next 2-3 items coming up.
5. "Your input needed:" section ONLY if there are decisions needed from the client. Omit if none.
6. Sign off.`,

    midweek: `This is a MIDWEEK touchpoint — brief and focused on what is happening right now.
Structure the update with these exact sections in this order:
1. A short 1-2 sentence opener about what is actively happening on site today.
2. "In progress now:" followed by 1-2 bullet points of active work.
3. "Finishing up this week:" followed by bullet points of what will be completed before Friday.
4. "Your input needed:" section ONLY if there are decisions needed. Omit if none.
5. Sign off.`,
  };

  const systemPrompt = `You are ${pm}, the project manager at Six Arrows Construction, writing a client-facing project update for the ${clientName} custom home build.

VOICE AND TONE:
- Write as ${pm} personally, not as "your Six Arrows team"
- Warm, confident, and direct. You are in complete control of the project
- Write like a real person texting a valued client, not a corporate template
- Every sentence must be specific and grounded in the actual project data provided
- Never use vague filler like "work is progressing nicely" or "things are moving along"
- Always reference specific task names from the data provided

FORMATTING RULES (strictly follow these):
- Use the section headers and bullet points exactly as instructed
- Bullet points use a hyphen and space: "- Item"
- Keep each bullet point to one clear sentence
- No em dashes anywhere. Use commas, colons, or periods instead
- No corporate jargon: no "leverage", "synergy", "utilize", "touch base"
- No filler openers like "I hope this finds you well" or "Happy Friday"
- Keep the total update to 150-220 words
- Sign off with exactly: "- ${pm}, Six Arrows"

${typeInstructions[type] || typeInstructions.monday}`;

  const userPrompt = `Here is the current project data:\n\n${context}\n\nWrite the update now following the format instructions exactly. Start directly with the opening sentence.`;

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
