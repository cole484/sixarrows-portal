// netlify/functions/notion-sub-history.js
//
// Returns every scored job for one subcontractor, across every project
// timeline DB in TIMELINE_DB_IDS. Used by /sub.html to show the per-sub
// drill-in view (header + full job-by-job history).
//
// Query: ?subId=<notion-page-id>
//
// Required env vars:
//   SUBCONTRACTORS_DB_ID  - to read the sub header (name, contact, etc.)
//   TIMELINE_DB_IDS       - comma-separated list of timeline db ids to scan
//
// Response:
//   {
//     sub: { id, name, contactName, email, phone, status, rating, trades,
//            jobsScored, avgScore, tier },
//     jobs: [
//       { taskId, taskName, projectId, projectName, projectAddress,
//         completedDate,
//         scheduleAdherence, siteCleanliness, budgetAdherence, qualityOfWork,
//         subScore, tier,
//         positives, improvements, internalNotes }
//     ]
//   }

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

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

async function queryAll(dbId, token, filter) {
  const out = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/databases/${dbId}/query`, token, body);
    out.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return out;
}

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title?.map(t => t.plain_text).join('') || null;
    case 'rich_text':    return p.rich_text?.map(t => t.plain_text).join('') || null;
    case 'number':       return p.number ?? null;
    case 'select':       return p.select?.name || null;
    case 'multi_select': return p.multi_select?.map(o => o.name) || [];
    case 'status':       return p.status?.name || null;
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'date':         return p.date?.start || null;
    case 'relation':     return p.relation?.map(r => r.id) || [];
    default: return null;
  }
}

function tierFor(score) {
  if (score == null) return null;
  if (score >= 90) return 'Elite';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Adequate';
  if (score >= 45) return 'Poor';
  return 'Unacceptable';
}

// Read the Trade(s) the sub does. Try a multi-select named "Trades" first,
// fall back to a single-select named "Trade". Coerce to strings + drop
// empties so an unexpected column type can't break the caller.
function readTrades(page) {
  const cleanArr = (arr) => arr
    .map(v => typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.name || v.title || '') : String(v ?? '')))
    .map(s => s.trim())
    .filter(Boolean);

  const multi = prop(page, 'Trades');
  if (Array.isArray(multi) && multi.length) {
    const cleaned = cleanArr(multi);
    if (cleaned.length) return cleaned;
  }
  const single = prop(page, 'Trade');
  if (single) return cleanArr([single]);
  return [];
}

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };
  const reply = (s, b) => ({ statusCode: s, headers: corsH, body: JSON.stringify(b) });

  const token = process.env.NOTION_TOKEN;
  if (!token) return reply(500, { error: 'NOTION_TOKEN not set' });

  const subId = event.queryStringParameters?.subId;
  if (!subId) return reply(400, { error: 'subId is required' });

  const dbIdsRaw = event.queryStringParameters?.dbIds || process.env.TIMELINE_DB_IDS || '';
  const timelineDbIds = dbIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!timelineDbIds.length) {
    return reply(400, { error: 'No timeline DB IDs available. Set TIMELINE_DB_IDS env var.' });
  }

  const warnings = [];

  try {
    // ── 1. Sub header ────────────────────────────────────────────────────
    let subHeader = null;
    try {
      const page = await notionGet(`/pages/${subId}`, token);
      subHeader = {
        id:          page.id,
        name:        prop(page, 'Subcontractor Name'),
        contactName: prop(page, 'Contact Name'),
        email:       prop(page, 'Email'),
        phone:       prop(page, 'Phone Number'),
        status:      prop(page, 'Status'),
        rating:      prop(page, 'Rating'),
        trades:      readTrades(page),
      };
    } catch (e) {
      return reply(404, { error: `Subcontractor not found: ${e.message.slice(0, 200)}` });
    }

    // ── 2. Pull all scored tasks for this sub across all timeline DBs. ──
    const projectCache = new Map();
    const jobs = [];

    for (const dbId of timelineDbIds) {
      let tasks;
      try {
        tasks = await queryAll(dbId, token, {
          and: [
            { property: 'Sub Score',     number: { is_not_empty: true } },
            { property: 'Subcontractor', relation: { contains: subId } },
          ],
        });
      } catch (e) {
        warnings.push(`Timeline DB ${dbId.slice(0, 8)}… failed: ${e.message.slice(0, 180)}`);
        continue;
      }

      for (const task of tasks) {
        const startProp = task.properties?.['Start']?.date;
        const completedDate = startProp?.end || startProp?.start || null;

        // Look up the project (cache to avoid repeat fetches).
        const projRel = prop(task, 'Project') || [];
        const projectId = projRel[0] || null;
        let projectName = null, projectAddress = null;
        if (projectId) {
          if (!projectCache.has(projectId)) {
            try {
              const projPage = await notionGet(`/pages/${projectId}`, token);
              projectCache.set(projectId, {
                name: prop(projPage, 'Name') || prop(projPage, 'Project Name') || prop(projPage, 'Title'),
                address: prop(projPage, 'Address') || prop(projPage, 'Project Address') || prop(projPage, 'Site Address'),
              });
            } catch (e) {
              projectCache.set(projectId, { name: null, address: null });
            }
          }
          const cached = projectCache.get(projectId);
          projectName = cached.name;
          projectAddress = cached.address;
        }

        const subScore = prop(task, 'Sub Score');
        jobs.push({
          taskId:            task.id,
          taskName:          prop(task, 'Task'),
          projectId,
          projectName,
          projectAddress,
          completedDate,
          scheduleAdherence: prop(task, 'Schedule Adherence'),
          siteCleanliness:   prop(task, 'Site Cleanliness'),
          budgetAdherence:   prop(task, 'Budget Adherence'),
          qualityOfWork:     prop(task, 'Quality of Work'),
          subScore,
          tier:              tierFor(subScore),
          positives:         prop(task, 'Score: Positives'),
          improvements:      prop(task, 'Score: Improvements'),
          internalNotes:     prop(task, 'Subcontractor performance notes'),
        });
      }
    }

    // Most recent first.
    jobs.sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''));

    // ── 3. Aggregate stats for the header. ───────────────────────────────
    const scores = jobs.map(j => j.subScore).filter(v => v != null);
    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    subHeader.jobsScored = jobs.length;
    subHeader.avgScore   = avgScore;
    subHeader.tier       = tierFor(avgScore);

    return reply(200, { sub: subHeader, jobs, warnings });
  } catch (err) {
    console.error('notion-sub-history error:', err);
    return reply(500, { error: err.message });
  }
};
