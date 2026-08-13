// netlify/functions/notion-quote-request.js
//
// Builds a Quote Request for one timeline task.
//
// This is the document that comes BEFORE a work order. Nothing on Johnson is
// quoted: the billing sheet says "Need Estimate" on about ninety lines and
// every task sits at "To Be Quoted". Estimated Cost is the blocker on every
// blocked task in the window, and it is not a field anybody can fill in by
// thinking harder. The number has to come from a subcontractor.
//
// A quote request is deliberately NOT a work order:
//   - it asks for a price, it does not state one
//   - no payment schedule, no holdback, no signature block
//   - nothing about it commits either side to anything
//
// Sending one is safe in a way a work order is not, which is the whole point:
// it is what unblocks a task without anyone promising money.
//
//   GET ?taskId=<notion-page-id>
//   GET ?taskId=...&audience=sub    strip internal warnings and notes
//
// Returns the merged request the portal page renders. Sends nothing.

import { templateTitleForTrade, TRADES_WITHOUT_TEMPLATE } from './lib/trade-aliases.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const TRADE_TEMPLATES_DB_ID = 'be4cee0b-6334-492b-a2d4-e6eeb2ec5edc';

// What every quote must account for, whatever the trade. Stated once here so a
// sub cannot reasonably come back later and say a line was assumed out.
const QUOTE_BASIS = [
  'Price all labor, material, equipment and consumables needed to meet the scope and completion standard below, unless a line is listed under exclusions.',
  'Include your own cleanup and debris removal. Work areas are left clean at the end of each day.',
  'Include any permits or inspection fees that are normally pulled by your trade. If Six Arrows pulls them, say so in exclusions.',
  'State anything you are deliberately leaving out. An exclusion written down now is a conversation; one discovered mid-job is a change order.',
];

function nHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

async function notionGet(path, token) {
  const res = await fetch(`${NOTION_API}${path}`, { headers: nHeaders(token) });
  if (!res.ok) throw new Error(`Notion GET ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function notionQuery(dbId, token, body = {}) {
  const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST', headers: nHeaders(token), body: JSON.stringify({ page_size: 100, ...body }),
  });
  if (!res.ok) {
    const why = res.status === 404
      ? ' (check this is the database id, not the data source id, before chasing sharing)'
      : '';
    throw new Error(`Notion query ${dbId}: ${res.status}${why} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function prop(page, name) {
  const p = page?.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'rich_text':    return p.rich_text?.map(t => t.plain_text).join('').trim() || null;
    case 'date':         return p.date || null;
    case 'number':       return p.number ?? null;
    case 'checkbox':     return !!p.checkbox;
    case 'select':       return p.select?.name || null;
    case 'multi_select': return p.multi_select?.map(o => o.name) || [];
    case 'status':       return p.status?.name || null;
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'url':          return p.url || null;
    case 'relation':     return (p.relation || []).map(r => r.id);
    case 'files':        return (p.files || []).map(f => f.file?.url || f.external?.url).filter(Boolean);
    case 'formula':      return p.formula?.string ?? p.formula?.number ?? p.formula?.date?.start ?? null;
    case 'rollup': {
      const r = p.rollup;
      if (!r) return null;
      if (r.type === 'number') return r.number ?? null;
      if (r.type === 'date')   return r.date?.start ?? null;
      if (r.type === 'string') return r.string || null;
      if (r.type === 'array') {
        const vals = (r.array || []).map(x => {
          if (x.type === 'title')     return x.title?.map(t => t.plain_text).join('') || null;
          if (x.type === 'rich_text') return x.rich_text?.map(t => t.plain_text).join('') || null;
          if (x.type === 'phone_number') return x.phone_number || null;
          if (x.type === 'email')     return x.email || null;
          if (x.type === 'number')    return x.number ?? null;
          return null;
        }).filter(v => v !== null && v !== '');
        return vals.length ? vals[0] : null;
      }
      return null;
    }
    default: return null;
  }
}

const iso = d => d.toISOString().slice(0, 10);

// When the quote has to be back. Working backwards from the task's start date
// rather than forwards from today, because a quote that lands after the crew
// was meant to arrive has answered nothing. Never asks for same-day.
function quoteDueBy(startDate, leadTimeDays) {
  const today = new Date();
  const soon  = new Date(today.getTime() + 7 * 86_400_000);
  if (!startDate) return iso(soon);

  const start = new Date(String(startDate).slice(0, 10) + 'T12:00:00Z');
  // Leave the lead time clear, plus three days to place the order.
  const need  = new Date(start.getTime() - ((leadTimeDays || 0) + 3) * 86_400_000);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const chosen = need < soon ? need : soon;
  return iso(chosen < tomorrow ? tomorrow : chosen);
}

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };

  const token = process.env.NOTION_TOKEN;
  if (!token) return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };

  const taskId = event.queryStringParameters?.taskId;
  if (!taskId) return { statusCode: 400, headers: corsH, body: JSON.stringify({ error: 'taskId required' }) };

  try {
    const task  = await notionGet(`/pages/${taskId}`, token);
    const trade = prop(task, 'Trade');

    // ── The trade template supplies the default scope and standard ────────
    let template = null, templateTitle = null;
    if (trade) {
      templateTitle = templateTitleForTrade(trade);
      if (templateTitle) {
        // The title property on Trade Templates is called "Trade", not "Name".
        // Notion rejects the whole query with a 400 for an unknown property,
        // so this is not a silent miss, it is the endpoint failing outright.
        const found = await notionQuery(TRADE_TEMPLATES_DB_ID, token, {
          filter: { property: 'Trade', title: { equals: templateTitle } },
          page_size: 1,
        });
        template = found.results?.[0] || null;
      }
    }

    // Task values win over the template. The template is the default for the
    // trade; the task is what is true about this instance. Field names match
    // notion-work-order.js exactly, because those are the ones proven against
    // the real databases: the template's scope column is "Scope", not "Scope
    // of Work", and its standard is "Completion Standard".
    const scope = prop(task, 'Scope of Work')
      || (template ? prop(template, 'Scope') : null);
    const standard = prop(task, 'Definition of done')
      || (template ? prop(template, 'Completion Standard') : null);

    // ── Schedule ──────────────────────────────────────────────────────────
    const dateVal  = prop(task, 'Start');
    const start    = dateVal?.start || null;
    const end      = dateVal?.end || null;
    const duration = prop(task, 'Duration (days)') ?? null;
    const leadTime = prop(task, 'Lead time (days)')
      ?? (template ? prop(template, 'Default Lead Time (days)') : null);

    // ── Project ───────────────────────────────────────────────────────────
    // Read the linked Project page directly and fall back to the rollups on
    // the task, same as the work order. Rollups are brittle: Notion silently
    // returns empty for a relation whose target database the integration
    // cannot see, which looks identical to a field nobody filled in.
    const projectRel = prop(task, 'Project') || [];
    let projectPage = null;
    if (projectRel.length) {
      try { projectPage = await notionGet(`/pages/${projectRel[0]}`, token); }
      catch (err) { console.error('notion-quote-request: project not readable:', err.message); }
    }
    const pick = (...vals) => vals.find(v => v !== null && v !== undefined && v !== '') ?? null;
    const project = {
      name: pick(
        projectPage && (prop(projectPage, 'Name') || prop(projectPage, 'Project Name')),
        prop(task, 'Project Name')),
      address: pick(
        projectPage && (prop(projectPage, 'Address') || prop(projectPage, 'Project Address') || prop(projectPage, 'Site Address')),
        prop(task, 'Project Address (rollup)'), prop(task, 'Project Address'), prop(task, 'Job Site Location')),
      pmName: pick(
        projectPage && (prop(projectPage, 'Project Manager') || prop(projectPage, 'PM')),
        prop(task, 'Project Manager (rollup)'), prop(task, 'Project Manager')),
      pmEmail: pick(
        projectPage && (prop(projectPage, 'PM Email') || prop(projectPage, 'Email')),
        prop(task, 'PM Email (rollup)'), prop(task, 'PM Email')),
      pmPhone: pick(
        projectPage && (prop(projectPage, 'PM Phone') || prop(projectPage, 'Phone')),
        prop(task, 'PM Phone (rollup)'), prop(task, 'PM Phone')),
    };

    // ── Who we are asking, if anyone is named yet ─────────────────────────
    const subIds = prop(task, 'Subcontractor') || prop(task, 'Sub Contractor') || [];
    let sub = null;
    if (subIds.length) {
      try {
        const page = await notionGet(`/pages/${subIds[0]}`, token);
        sub = {
          id:      page.id,
          name:    prop(page, 'Subcontractor Name'),
          contact: prop(page, 'Contact Name'),
          email:   prop(page, 'Email'),
          phone:   prop(page, 'Phone') || prop(page, 'Phone Number'),
        };
      } catch (err) {
        console.error('notion-quote-request: could not read sub:', err.message);
      }
    }

    const existingCost   = prop(task, 'Estimated Cost');
    const existingSource = prop(task, 'Cost Source');

    const quote = {
      taskId,
      taskName:  prop(task, 'Task') || '(untitled task)',
      trade,
      status:    prop(task, 'Status'),
      scope,
      completionStandard: standard,
      basis:     QUOTE_BASIS,
      plansNeeded: prop(task, 'Plans or Blueprints Needed?') ?? false,
      files:       prop(task, 'Files & media') || [],
      schedule: {
        start, end, duration, leadTime,
        // The window Six Arrows wants, stated so the sub can say whether they
        // can hold it. Not a commitment on either side yet.
        requested: start && end ? `${start} to ${end}` : (start || null),
      },
      respondBy: quoteDueBy(start, leadTime),
      project,
      sub,
      scopeFrom: prop(task, 'Scope of Work') ? 'task' : (scope ? 'trade template' : null),
    };

    // ── Warnings, for the person about to send this ───────────────────────
    const warnings = [];
    if (!trade)  warnings.push('This task has no Trade set, so no Trade Template could be matched.');
    if (!scope) {
      warnings.push(TRADES_WITHOUT_TEMPLATE.has(String(trade || '').trim())
        ? `Trade "${trade}" has no Trade Template, so there is no default scope. Write a Scope of Work on the task before sending this.`
        : 'No scope on the task and none from the trade template. A sub cannot price this as it stands.');
    }
    if (!standard) warnings.push('No completion standard. The sub is being asked to price work without being told what finished looks like.');
    if (!start)    warnings.push('No start date, so the response deadline is a guess and the sub cannot tell you whether they can hold the window.');
    if (!sub)      warnings.push('No subcontractor assigned yet. This request can still be sent to anyone, but nobody is named on it.');
    if (existingCost != null) {
      warnings.push(existingSource === 'Bid Received'
        ? `This task already has a bid of ${existingCost} recorded. Sending another quote request will collect a second number, not replace the first.`
        : `Estimated Cost is already set to ${existingCost} with Cost Source "${existingSource || 'not set'}". A returned quote will not overwrite it.`);
    }

    const audience = event.queryStringParameters?.audience;
    return {
      statusCode: 200,
      headers: corsH,
      body: JSON.stringify({
        quote,
        warnings: audience === 'sub' ? [] : warnings,
      }, null, 2),
    };

  } catch (err) {
    console.error('notion-quote-request error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
