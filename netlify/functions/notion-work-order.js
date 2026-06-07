// netlify/functions/notion-work-order.js
//
// Builds a Subcontractor Work Order document by joining three Notion sources:
//   1. A per-project timeline task (the instance — has overrides)
//   2. The matching Trade Templates row (the default — by Trade name)
//   3. The linked Subcontractor row (contact info)
//
// Project info (address, PM name/phone/email) comes from rollups already on
// the timeline task — no separate fetch needed.
//
// Query: GET ?taskId=<notion-page-id>
// Returns a merged work order object the admin UI can render to HTML.

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Hardcoded workspace-wide reference DB. Per-project timeline DB and per-sub
// rows are discovered from the task being queried.
const TRADE_TEMPLATES_DB_ID = 'be4cee0b-6334-492b-a2d4-e6eeb2ec5edc';

function notionHeaders(token) {
  return {
    'Authorization':  `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}

async function notionGet(path, token) {
  const res = await fetch(`${NOTION_API}${path}`, { headers: notionHeaders(token) });
  if (!res.ok) throw new Error(`Notion ${res.status} on GET ${path}: ${await res.text()}`);
  return res.json();
}

async function notionPost(path, token, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: 'POST', headers: notionHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status} on POST ${path}: ${await res.text()}`);
  return res.json();
}

// Extract a property value from a Notion page object.
// Handles every type used by the three DBs in this feature.
function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title?.map(t => t.plain_text).join('') || null;
    case 'rich_text':    return p.rich_text?.map(t => t.plain_text).join('') || null;
    case 'date':         return p.date?.start || null;
    case 'number':       return p.number ?? null;
    case 'checkbox':     return p.checkbox ?? false;
    case 'select':       return p.select?.name || null;
    case 'multi_select': return p.multi_select?.map(o => o.name) || [];
    case 'status':       return p.status?.name || null;
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'url':          return p.url || null;
    case 'relation':     return p.relation?.map(r => r.id) || [];
    case 'rollup': {
      const r = p.rollup;
      if (!r) return null;
      if (r.type === 'array') {
        // "Show original" rollups: each entry is itself a property object.
        const first = r.array?.[0];
        if (!first) return null;
        return prop({ properties: { _: first } }, '_');
      }
      return r[r.type] ?? null;
    }
    default: return null;
  }
}

// Pick the first non-empty/falsy value (treats empty string and empty array as empty).
function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && !v.length) continue;
    return v;
  }
  return null;
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
    // ── 1. Fetch the timeline task ─────────────────────────────────────────
    const task = await notionGet(`/pages/${taskId}`, token);

    const trade = prop(task, 'Trade');
    if (!trade) {
      return { statusCode: 400, headers: corsH, body: JSON.stringify({
        error: 'Task has no Trade set — cannot match a Trade Template.',
      })};
    }

    // Handle the duplicate-relation quirk: prefer "Subcontractor", fall back
    // to "Sub Contractor". Both point at the Subcontractors DB.
    const subRel = firstNonEmpty(prop(task, 'Subcontractor'), prop(task, 'Sub Contractor')) || [];
    const subId  = Array.isArray(subRel) ? subRel[0] : null;
    const bothSubFieldsUsed = (prop(task, 'Subcontractor') || []).length > 0
                           && (prop(task, 'Sub Contractor') || []).length > 0;

    // ── 2. Find the matching Trade Template ───────────────────────────────
    const templateQuery = await notionPost(`/databases/${TRADE_TEMPLATES_DB_ID}/query`, token, {
      filter: { property: 'Trade', title: { equals: trade } },
      page_size: 1,
    });
    const template = templateQuery.results?.[0] || null;

    // ── 3. Fetch the subcontractor (if assigned) ──────────────────────────
    let sub = null;
    if (subId) {
      try {
        const subPage = await notionGet(`/pages/${subId}`, token);
        sub = {
          id:           subPage.id,
          name:         prop(subPage, 'Subcontractor Name'),
          contactName:  prop(subPage, 'Contact Name'),
          phone:        prop(subPage, 'Phone Number'),
          email:        prop(subPage, 'Email'),
          address:      prop(subPage, 'Address'),
          status:       prop(subPage, 'Status'),
          rating:       prop(subPage, 'Rating'),
          w9OnFile:     prop(subPage, 'W9 on File'),
          insuranceOnFile: prop(subPage, 'Insurance on File'),
          coiExpiration:   prop(subPage, 'COI Expiration'),
        };
      } catch (e) {
        // Sub fetch failed (deleted? unshared?). Surface but don't fail the whole call.
        sub = { error: e.message };
      }
    }

    // ── 4. Merge: task overrides win, template values as fallback ─────────
    const merged = {
      trade,
      taskName:      prop(task, 'Task'),
      taskId:        task.id,
      taskUrl:       task.url,
      scope:                  firstNonEmpty(prop(task, 'Scope of Work'),    template && prop(template, 'Scope')),
      completionStandard:                                                   template && prop(template, 'Completion Standard'),
      definitionOfDone:       firstNonEmpty(prop(task, 'Definition of done'), template && prop(template, 'Completion Standard')),
      preSchedulingReqs:                                                    template && prop(template, 'Pre-Scheduling Requirements'),
      longLead:               firstNonEmpty(prop(task, 'Long lead'),        template && prop(template, 'Default Long Lead'), false),
      leadTimeDays:           firstNonEmpty(prop(task, 'Lead time (days)'), template && prop(template, 'Default Lead Time (days)')),
      plansNeeded:            firstNonEmpty(prop(task, 'Plans or Blueprints Needed?'), template && prop(template, 'Plans/Blueprints Required'), false),
    };

    // ── 5. Schedule info from the task ────────────────────────────────────
    const schedule = {
      status:      prop(task, 'Status'),
      startDate:   prop(task, 'Start'),
      duration:    prop(task, 'Duration (days)'),
      phase:       prop(task, 'Phase'),
      workstream:  prop(task, 'Workstream'),
      sequence:    prop(task, 'Sequence #'),
      clientDecisionPending: prop(task, 'Client Decision'),
    };

    // ── 6. Project info from rollups on the task ──────────────────────────
    const project = {
      address:    prop(task, 'Project Address (rollup)') || prop(task, 'Project Address'),
      pmName:     prop(task, 'Project Manager (rollup)') || prop(task, 'Project Manager'),
      pmEmail:    prop(task, 'PM Email (rollup)')        || prop(task, 'PM Email'),
      pmPhone:    prop(task, 'PM Phone (rollup)')        || prop(task, 'PM Phone'),
    };

    // ── 7. Notes & files ──────────────────────────────────────────────────
    const notes = {
      internal:   prop(task, 'Internal note'),
      forClient:  prop(task, 'Notes'),
      chronological: prop(task, 'Chronological Order'),
    };

    // ── 8. Warnings worth surfacing to the admin UI ───────────────────────
    const warnings = [];
    if (!template)        warnings.push(`No Trade Template found for "${trade}" — using task values only.`);
    if (!sub)             warnings.push('No subcontractor assigned yet.');
    if (bothSubFieldsUsed) warnings.push('Both "Subcontractor" and "Sub Contractor" relations are populated — used "Subcontractor". Clean up the duplicate column in Notion.');
    if (!project.address) warnings.push('No site address — link this task to a Project in Notion so the address/PM rollups populate. A work order without an address can\'t be sent.');
    if (merged.plansNeeded && !prop(task, 'Files & media')?.length) {
      warnings.push('Plans/Blueprints flagged as required but no Files & media attached to the task.');
    }

    return {
      statusCode: 200,
      headers:    corsH,
      body: JSON.stringify({
        workOrder: merged,
        schedule,
        project,
        sub,
        notes,
        warnings,
      }),
    };

  } catch (err) {
    console.error('notion-work-order error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
