// netlify/functions/notion-sub-leaderboard.js
//
// Aggregates subcontractor scorecard performance across one or more project
// timeline databases and returns a sortable leaderboard.
//
// Inputs (any of these supply the timeline DB IDs to scan):
//   ?dbIds=<id1>,<id2>           query param (highest priority)
//   TIMELINE_DB_IDS  env var     comma-separated fallback
//
// Required:
//   SUBCONTRACTORS_DB_ID env var — used to read sub names + contact info
//
// Response:
//   {
//     subs: [
//       {
//         id, name, contactName, email, phone, status, rating,
//         jobsScored, avgScore, lastReviewed, tier
//       },
//       ...
//     ],
//     scannedDbs: [ ...dbIds ],
//     warnings: [ ... ]
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

async function notionPost(path, token, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: 'POST', headers: notionHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status} on POST ${path}: ${await res.text()}`);
  return res.json();
}

// Pull every page from a database (with optional filter), handling pagination.
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

// Read the Trade(s) the sub does. Try "Trades" first, then "Trade".
// Both columns may be either select (string) or multi-select (array), so we
// normalize each to an array of clean strings before returning.
function readTrades(page) {
  const cleanArr = (arr) => arr
    .map(v => typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.name || v.title || '') : String(v ?? '')))
    .map(s => s.trim())
    .filter(Boolean);
  const toArr = (v) => v == null ? [] : (Array.isArray(v) ? v : [v]);

  const fromTrades = cleanArr(toArr(prop(page, 'Trades')));
  if (fromTrades.length) return fromTrades;
  return cleanArr(toArr(prop(page, 'Trade')));
}

function tierFor(score) {
  if (score == null) return null;
  if (score >= 90) return 'Elite';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Adequate';
  if (score >= 45) return 'Poor';
  return 'Unacceptable';
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

  const subsDbId = process.env.SUBCONTRACTORS_DB_ID;
  if (!subsDbId) return reply(500, { error: 'SUBCONTRACTORS_DB_ID env var not set' });

  const dbIdsRaw = event.queryStringParameters?.dbIds || process.env.TIMELINE_DB_IDS || '';
  const timelineDbIds = dbIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!timelineDbIds.length) {
    return reply(400, {
      error: 'No timeline DB IDs provided. Pass ?dbIds=… or set TIMELINE_DB_IDS env var.',
    });
  }

  const warnings = [];

  try {
    // ── 1. Pull every subcontractor row first (gives us name + contact). ──
    const subPages = await queryAll(subsDbId, token);
    const subById = new Map();
    for (const page of subPages) {
      subById.set(page.id, {
        id:          page.id,
        name:        prop(page, 'Subcontractor Name'),
        contactName: prop(page, 'Contact Name'),
        email:       prop(page, 'Email'),
        phone:       prop(page, 'Phone Number'),
        status:      prop(page, 'Status'),
        rating:      prop(page, 'Rating'),
        trades:      readTrades(page),
        jobsScored:  0,
        scores:      [],
        lastReviewed: null,
      });
    }

    // ── 2. For each timeline DB, pull tasks where Sub Score is set. ──────
    const scannedDbs = [];
    for (const dbId of timelineDbIds) {
      let tasks;
      try {
        tasks = await queryAll(dbId, token, {
          property: 'Sub Score',
          number:   { is_not_empty: true },
        });
        scannedDbs.push(dbId);
      } catch (e) {
        warnings.push(`Failed to query timeline DB ${dbId.slice(0,8)}…: ${e.message.slice(0, 200)}`);
        continue;
      }

      for (const task of tasks) {
        const subRel = prop(task, 'Subcontractor') || prop(task, 'Sub Contractor') || [];
        const subId = Array.isArray(subRel) ? subRel[0] : null;
        if (!subId) continue;

        const score = prop(task, 'Sub Score');
        if (score == null) continue;

        // Use the Start range's end as "reviewed on" — falls back to start.
        const startProp = task.properties?.['Start']?.date;
        const reviewedDate = startProp?.end || startProp?.start || null;

        let entry = subById.get(subId);
        if (!entry) {
          // Sub appears in a task but not in the Subcontractors DB (deleted? unshared?).
          entry = {
            id: subId, name: '(Unknown sub)', contactName: null, email: null,
            phone: null, status: null, rating: null, trades: [],
            jobsScored: 0, scores: [], lastReviewed: null,
          };
          subById.set(subId, entry);
        }

        entry.jobsScored += 1;
        entry.scores.push(score);
        if (reviewedDate && (!entry.lastReviewed || reviewedDate > entry.lastReviewed)) {
          entry.lastReviewed = reviewedDate;
        }
      }
    }

    // ── 3. Finalize: compute averages, attach tiers, sort. ───────────────
    const subs = Array.from(subById.values()).map(s => {
      const avgScore = s.scores.length
        ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length)
        : null;
      return {
        id:          s.id,
        name:        s.name,
        contactName: s.contactName,
        email:       s.email,
        phone:       s.phone,
        status:      s.status,
        rating:      s.rating,
        trades:      s.trades || [],
        jobsScored:  s.jobsScored,
        avgScore,
        lastReviewed: s.lastReviewed,
        tier:         tierFor(avgScore),
      };
    });

    // Sort: scored subs first by avgScore desc, then unscored subs by name.
    subs.sort((a, b) => {
      if (a.jobsScored && !b.jobsScored) return -1;
      if (!a.jobsScored && b.jobsScored) return 1;
      if (a.jobsScored && b.jobsScored) return (b.avgScore || 0) - (a.avgScore || 0);
      return (a.name || '').localeCompare(b.name || '');
    });

    // Optional: write each sub's computed aggregate back to the
    // Subcontractors DB. Used by the "Sync to Notion" button on /subs.html.
    let writeback = null;
    if (event.queryStringParameters?.writeback === '1') {
      const headers = notionHeaders(token);
      let updated = 0, failed = 0;
      const failures = [];
      for (const s of subs) {
        if (!s.jobsScored) continue; // Only push aggregates for scored subs.
        const props = {
          'Aggregate Score': { number: s.avgScore },
          '# Scored Jobs':   { number: s.jobsScored },
        };
        if (s.lastReviewed) {
          props['Last Reviewed'] = { date: { start: s.lastReviewed } };
        }
        try {
          const pr = await fetch(`${NOTION_API}/pages/${s.id}`, {
            method: 'PATCH', headers, body: JSON.stringify({ properties: props }),
          });
          if (pr.ok) updated++;
          else {
            failed++;
            failures.push(`${s.name || s.id.slice(0,8)}: HTTP ${pr.status}`);
          }
        } catch (e) {
          failed++;
          failures.push(`${s.name || s.id.slice(0,8)}: ${e.message?.slice(0, 100)}`);
        }
      }
      writeback = { updated, failed, failures: failures.slice(0, 10) };
    }

    return reply(200, { subs, scannedDbs, warnings, writeback });
  } catch (err) {
    console.error('notion-sub-leaderboard error:', err);
    return reply(500, { error: err.message });
  }
};
