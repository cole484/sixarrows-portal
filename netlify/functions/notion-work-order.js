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

// Universal site standards appended to every work order's Completion Standard.
// These apply to all subs on every trade — separate from the trade-specific
// finish requirements in the Trade Templates DB.
const SITE_STANDARDS = [
  'Site kept clean daily — all trash, debris, packaging, and waste materials removed from the work area before leaving each day. Tools and staged materials may remain on site, but work areas must be left clean.',
  'Communicate any blockers, delays, or scope questions to the project manager as soon as you are aware — not after the fact.',
  'Adhere to committed start and completion dates; the next trade depends on your window.',
].join('\n');

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
    case 'people':       return p.people?.map(u => u.name || u.id).filter(Boolean).join(', ') || null;
    case 'files':        return p.files?.map(f => f.file?.url || f.external?.url).filter(Boolean) || [];
    case 'rollup': {
      const r = p.rollup;
      if (!r) return null;
      // Aggregated rollups (sum, count, etc) return a scalar.
      if (r.type === 'number')  return r.number ?? null;
      if (r.type === 'date')    return r.date?.start ?? null;
      if (r.type === 'string')  return r.string || null;
      if (r.type === 'boolean') return r.boolean ?? null;
      if (r.type === 'array') {
        // show_original / show_unique: each entry is a property object.
        // Walk all of them, extract values, dedupe, join.
        const vals = (r.array || [])
          .map(entry => prop({ properties: { _: entry } }, '_'))
          .flatMap(v => Array.isArray(v) ? v : [v])
          .filter(v => v != null && v !== '');
        if (!vals.length) return null;
        const unique = [...new Set(vals.map(String))];
        return unique.length === 1 ? unique[0] : unique.join(', ');
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

  const debug = event.queryStringParameters?.debug === '1';

  try {
    // ── 1. Fetch the timeline task ─────────────────────────────────────────
    const task = await notionGet(`/pages/${taskId}`, token);

    if (debug) {
      // Dump every property name + type + a tiny preview, so we can see what
      // Notion is actually returning when fields look missing on the page.
      const summary = {};
      for (const [k, v] of Object.entries(task.properties || {})) {
        let preview = null;
        try { preview = prop(task, k); } catch (e) { preview = '[parse error: ' + e.message + ']'; }
        summary[k] = { type: v.type, value: preview };
      }
      return {
        statusCode: 200, headers: corsH,
        body: JSON.stringify({ debug: true, taskId, properties: summary }, null, 2),
      };
    }

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

    // ── 3b. Fetch the linked Project for its title ────────────────────────
    const projectRel = prop(task, 'Project') || [];
    let projectName = null;
    let projectFromPage = {};
    if (projectRel.length) {
      try {
        const projectPage = await notionGet(`/pages/${projectRel[0]}`, token);
        projectName = prop(projectPage, 'Name')
                   || prop(projectPage, 'Project Name')
                   || prop(projectPage, 'Title')
                   || null;
        // Read project fields directly — bypasses rollup brittleness.
        // The rollup on the task remains as a fallback below.
        projectFromPage = {
          address: prop(projectPage, 'Address')
                || prop(projectPage, 'Project Address')
                || prop(projectPage, 'Site Address')
                || null,
          pmName:  prop(projectPage, 'Project Manager')
                || prop(projectPage, 'PM')
                || prop(projectPage, 'Manager')
                || null,
          pmEmail: prop(projectPage, 'PM Email')
                || prop(projectPage, 'Email')
                || null,
          pmPhone: prop(projectPage, 'PM Phone')
                || prop(projectPage, 'Phone')
                || prop(projectPage, 'Phone Number')
                || null,
        };
      } catch (e) { /* project not accessible — leave null */ }
    }

    // ── 4. Merge: task overrides win, template values as fallback ─────────
    // Completion Standard is trade-specific (from the template). Universal site
    // expectations (cleanliness, communication, date adherence) are returned as
    // a separate `siteStandards` field, rendered in its own block on the page.
    const merged = {
      trade,
      taskName:      prop(task, 'Task'),
      taskId:        task.id,
      taskUrl:       task.url,
      scope:                  firstNonEmpty(prop(task, 'Scope of Work'),    template && prop(template, 'Scope')),
      completionStandard:                                                   template && prop(template, 'Completion Standard'),
      siteStandards:          SITE_STANDARDS,
      definitionOfDone:       firstNonEmpty(prop(task, 'Definition of done'), template && prop(template, 'Completion Standard')),
      preSchedulingReqs:                                                    template && prop(template, 'Pre-Scheduling Requirements'),
      longLead:               firstNonEmpty(prop(task, 'Long lead'),        template && prop(template, 'Default Long Lead'), false),
      leadTimeDays:           firstNonEmpty(prop(task, 'Lead time (days)'), template && prop(template, 'Default Lead Time (days)')),
      plansNeeded:            firstNonEmpty(prop(task, 'Plans or Blueprints Needed?'), template && prop(template, 'Plans/Blueprints Required'), false),
      contractValue:          prop(task, 'Contract Value'),
      holdbackPct:            prop(task, 'Holdback %'),
    };

    // ── 5. Schedule info from the task ────────────────────────────────────
    // Notion's `date` property type natively supports ranges (start + end).
    // Read both from the raw property so we can use the range when set.
    const startProp = task.properties?.['Start']?.date;
    const rangeStart = startProp?.start || null;
    const rangeEnd   = startProp?.end   || null;

    let endDate  = rangeEnd;
    let duration = prop(task, 'Duration (days)');

    // If no end-of-range, derive end from duration. If no duration, derive
    // duration from range. Either input works; both are fine; neither = warn.
    if (!endDate && rangeStart && duration && duration > 0) {
      const d = new Date(rangeStart + 'T00:00:00');
      d.setDate(d.getDate() + Math.max(0, parseInt(duration, 10) - 1));
      endDate = d.toISOString().slice(0, 10);
    } else if (!endDate) {
      endDate = rangeStart;
    }
    if (!duration && rangeStart && endDate) {
      const s = new Date(rangeStart + 'T00:00:00');
      const e = new Date(endDate     + 'T00:00:00');
      const diff = Math.round((e - s) / 86400000) + 1;
      if (diff > 0) duration = diff;
    }

    const schedule = {
      status:      prop(task, 'Status'),
      startDate:   rangeStart,
      endDate,
      duration,
      phase:       prop(task, 'Phase'),
      workstream:  prop(task, 'Workstream'),
      sequence:    prop(task, 'Sequence #'),
      clientDecisionPending: prop(task, 'Client Decision'),
    };

    // ── 6. Project info — prefer reading the Project page directly,
    //         fall back to rollups on the task if Project columns aren't set.
    const project = {
      name:       projectName,
      address:    firstNonEmpty(projectFromPage.address, prop(task, 'Project Address (rollup)'), prop(task, 'Project Address')),
      pmName:     firstNonEmpty(projectFromPage.pmName,  prop(task, 'Project Manager (rollup)'), prop(task, 'Project Manager')),
      pmEmail:    firstNonEmpty(projectFromPage.pmEmail, prop(task, 'PM Email (rollup)'),        prop(task, 'PM Email')),
      pmPhone:    firstNonEmpty(projectFromPage.pmPhone, prop(task, 'PM Phone (rollup)'),        prop(task, 'PM Phone')),
    };

    // ── 7. Notes & files ──────────────────────────────────────────────────
    const notes = {
      internal:   prop(task, 'Internal note'),
      forClient:  prop(task, 'Notes'),
      chronological: prop(task, 'Chronological Order'),
      subCommitment: prop(task, 'Sub Commitment'),
      performanceNotes: prop(task, 'Subcontractor performance notes'),
      scorePositives:    prop(task, 'Score: Positives'),
      scoreImprovements: prop(task, 'Score: Improvements'),
    };

    // ── 7b. Existing scorecard scores (filled in by PM after completion) ──
    // Four categories, each 0–25, summing to a Sub Score 0–100.
    const scorecard = {
      scheduleAdherence: prop(task, 'Schedule Adherence'),
      siteCleanliness:   prop(task, 'Site Cleanliness'),
      budgetAdherence:   prop(task, 'Budget Adherence'),
      qualityOfWork:     prop(task, 'Quality of Work'),
      subScore:          prop(task, 'Sub Score'),
    };

    // ── 8. Warnings worth surfacing to the admin UI ───────────────────────
    const warnings = [];
    if (!template)        warnings.push(`No Trade Template found for "${trade}" — using task values only.`);
    if (!sub)             warnings.push('No subcontractor assigned yet.');
    if (bothSubFieldsUsed) warnings.push('Both "Subcontractor" and "Sub Contractor" relations are populated — used "Subcontractor". Clean up the duplicate column in Notion.');
    if (!project.address) {
      if (!projectRel.length && !projectName) {
        // Both empty — could be no relation set, OR Projects DB not shared
        // with the integration (Notion redacts both silently in that case).
        warnings.push(
          'Project info is empty. Two possible causes: (a) no Project relation is set on this task, or (b) the Projects DB is not shared with the "Six Arrows Portal" integration (Notion silently returns empty for relations/rollups whose target DB the integration can\'t see). Check both.'
        );
      } else {
        warnings.push(
          `Project relation is set (id: ${projectRel[0]?.slice(0,8) || '?'}…) but Address came back empty. Fill in the Address field on the linked Project record in Notion, OR confirm the Projects DB is shared with the "Six Arrows Portal" integration.`
        );
      }
    }
    if (!merged.contractValue) warnings.push('No Contract Value set on this task — fill it in on the timeline row before sending to the sub.');
    if (!schedule.duration) {
      warnings.push('Cannot determine the requested window. Either: (a) set the Start field as a date range (start + end) in Notion — easiest, or (b) fill in the Duration (days) field.');
    }
    if (merged.plansNeeded && !prop(task, 'Files & media')?.length) {
      warnings.push('Plans/Blueprints flagged as required but no Files & media attached to the task.');
    }

    // Strip internal-only fields if the request is for the sub-facing view.
    // Anyone with a taskId can hit the URL, so don't leak internal notes.
    const audience = event.queryStringParameters?.audience;
    let outNotes = notes;
    let outWarnings = warnings;
    if (audience === 'sub') {
      outNotes = {
        scorePositives:    notes.scorePositives,
        scoreImprovements: notes.scoreImprovements,
      };
      outWarnings = [];
    }

    return {
      statusCode: 200,
      headers:    corsH,
      body: JSON.stringify({
        workOrder: merged,
        schedule,
        project,
        sub,
        notes:    outNotes,
        scorecard,
        warnings: outWarnings,
      }),
    };

  } catch (err) {
    console.error('notion-work-order error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
