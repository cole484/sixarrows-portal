// netlify/functions/notion-weekly-update.js
// Deterministic Sunday-morning generator for weekly customer updates.
//
// Runs the same content pipeline described in the "Weekly Customer Update —
// Generation Spec" doc: pull tasks from each active construction client's
// Notion timeline DB, bucket into 5 sections (this week / in progress /
// recently completed / coming up / decisions / weather), and drop each
// project's rendered update into the `updates` table as an unapproved draft.
//
// Cron: 0 11 * * 0 (Sunday 11 UTC = 6am CDT / 5am CST). See netlify.toml.
//
// Manual trigger for admin:
//   GET  /?dryRun=1              → show what would be generated, don't save
//   GET  /?clientId=X            → run for one client (still writes draft)
//   POST /?clientId=X            → same as GET; POST kept for form buttons
//
// Voice/tone: strictly what's in Notion. No LLM, no invention. Sub-lines
// that don't have source content are omitted rather than fabricated.

import { respond, corsHeaders } from './lib/supabase-client.js';

const NOTION_API      = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';
// The spec §3 listed '222b7d0a-9152-4441-8ca7-4b4e7e855771' as the "Projects
// DB collection ID," but that's actually Notion's data source ID for the
// underlying collection — the classic /v1/databases/{id}/query endpoint
// requires the DATABASE id, which is different. The database's Notion URL
// (https://app.notion.com/p/91227653d2564858956b22cfa429634e) reveals the
// real id. Both point to the same rows in the UI, but the databases endpoint
// 404s when passed the collection id.
const PROJECTS_DB_ID  = '91227653-d256-4858-956b-22cfa429634e';

const SB_URL   = () => process.env.SUPABASE_URL;
const SB_KEY   = () => process.env.SUPABASE_ANON_KEY;
const NT_TOKEN = () => process.env.NOTION_TOKEN;

// ── Per-project field maps (from spec §2) ────────────────────────────────
// Keyed by normalized (dashes stripped, lowercased) db id. If a client's
// timeline DB isn't listed here, we fall back to the "new schema" naming
// which matches most current templates.
function normDb(id) { return String(id || '').replace(/-/g, '').toLowerCase(); }
const FIELD_MAP = {
  '34f4737bea6f8113ba6d000bdca6ee10': { title:'Task',             date:'Start',      approval:false, hasNotes:true  }, // Wilkins
  '2e84737bea6f81b7abee000bfc438d7f': { title:'Task',             date:'Start',      approval:false, hasNotes:true  }, // Hoops
  '3454737bea6f81d9908a000b798cd08f': { title:'Task',             date:'Start',      approval:true,  hasNotes:false }, // Kandaswamy (no Notes field)
  '2424737bea6f81489bcd000b40c7f53c': { title:'Task Description', date:'Start Date', approval:true,  hasNotes:true  }, // Malone
  '2af4737bea6f813fbdb2000b538c7b90': { title:'Task Description', date:'Start Date', approval:true,  hasNotes:true  }, // Moseley
  '34a4737bea6f81dd93fa000b0ba367fc': { title:'Task Description', date:'Start Date', approval:true,  hasNotes:true  }, // Kerr
  'ba72f6c67b93450cb5bcb89f9d162ede': { title:'Task',             date:'Start',      approval:false, hasNotes:true  }, // Johnson
};
function fieldMap(dbId) {
  return FIELD_MAP[normDb(dbId)] || { title:'Task', date:'Start', approval:false, hasNotes:true };
}

// Status vocabulary (both schemas). See spec §2.
const STATUS = {
  completed:            ['Completed'],
  active:               ['In Progress'],
  scheduled:            ['Scheduled'],
  awaitingConfirmation: ['Waiting on confirmation','Awaiting Confirmation'],
  estimatedTimeframe:   ['Estimated Time Frame','Not Ready / Estimated Timeframe'],
  waitingOnClient:      ['Waiting on Client'],
  onHold:               ['On Hold'],
  needsScheduling:      ['Needs Scheduling'],
};
const APPROVAL_PENDING = ['Pending Customer','Awaiting Selection','Changes Requested'];

// Trades whose progress can slip with bad weather (spec §5)
const WEATHER_SENSITIVE = /\b(concrete|footing|excavat|roof|frame|framing|exterior|siding|landscap|masonry|block|utility trench|trench|pour)\b/i;

// ── Notion helpers ───────────────────────────────────────────────────────
function notionHeaders() {
  return {
    'Authorization':  `Bearer ${NT_TOKEN()}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}

async function notionQueryAll(dbId, extraBody = {}) {
  const all = [];
  let cursor;
  for (let i = 0; i < 20; i++) {                    // hard cap: 20 pages × 100 = 2000
    const body = { page_size: 100, ...extraBody };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST', headers: notionHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion query ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    all.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return all;
}

// Pull a property value out of a Notion page in a type-aware way.
function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':      return p.title?.map(t => t.plain_text).join('').trim()      || null;
    case 'rich_text':  return p.rich_text?.map(t => t.plain_text).join('').trim()  || null;
    case 'date':       return p.date || null;   // {start, end}
    case 'number':     return p.number ?? null;
    case 'checkbox':   return !!p.checkbox;
    case 'select':     return p.select?.name  || null;
    case 'status':     return p.status?.name  || null;
    case 'multi_select': return (p.multi_select || []).map(o => o.name).join(', ') || null;
    case 'rollup':
      // Rollups can hold arrays; pick the first plain-text-ish value
      if (p.rollup?.array?.length) {
        const first = p.rollup.array[0];
        if (first?.rich_text?.length) return first.rich_text.map(t => t.plain_text).join('').trim();
        if (first?.title?.length)     return first.title.map(t => t.plain_text).join('').trim();
        if (first?.plain_text)        return first.plain_text;
      }
      if (p.rollup?.number != null) return p.rollup.number;
      return null;
    default: return null;
  }
}

// Normalize a Notion page into a task the bucketer can reason about.
function normalizeTask(page, map) {
  const dateVal = prop(page, map.date) || {};
  return {
    id:               page.id,
    name:             prop(page, map.title) || 'Untitled',
    status:           prop(page, 'Status') || '',
    startDate:        dateVal.start || null,
    endDate:          dateVal.end   || null,
    clientNote:       prop(page, 'Client-facing note') || null,
    defOfDone:        prop(page, 'Definition of done') || null,
    trade:            prop(page, 'Trade')  || null,
    phase:            prop(page, 'Phase')  || null,
    isMilestone:      prop(page, 'Milestones') || false,
    isLongLead:       prop(page, 'Long lead')  || false,
    jobSiteLocation:  prop(page, 'Job Site Location') || null,
    // Approval fields — only present on some projects
    approvalStatus:   map.approval ? (prop(page, 'Customer Approval Status') || null) : null,
    approvalNotes:    map.approval ? (prop(page, 'Approval Notes')           || null) : null,
    decisionDeadline: map.approval ? (prop(page, 'Decision Deadline')?.start || null) : null,
    decisionOwner:    map.approval ? (prop(page, 'Decision Owner')           || null) : null,
  };
}

// ── Bucketing (spec §4) ──────────────────────────────────────────────────
function daysBetween(a, b) { return (new Date(b) - new Date(a)) / 86_400_000; }
function parseDate(s)      { return s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')) : null; }
function inRange(iso, lo, hi) {
  if (!iso) return false;
  const t = parseDate(iso).getTime();
  return t >= lo.getTime() && t <= hi.getTime();
}
function statusIsCompleted(s)  { return STATUS.completed.includes(s); }
function statusIsInProgress(s) { return STATUS.active.includes(s); }
function statusIsScheduled(s)  {
  return [...STATUS.scheduled, ...STATUS.awaitingConfirmation, ...STATUS.estimatedTimeframe].includes(s);
}
function statusIsWaitingClient(s) { return STATUS.waitingOnClient.includes(s); }

function bucketTasks(tasks, T) {
  const past14      = new Date(T); past14.setDate(past14.getDate() - 14);
  const nextWeek    = new Date(T); nextWeek.setDate(nextWeek.getDate() + 7);
  const fourWeeks   = new Date(T); fourWeeks.setDate(fourWeeks.getDate() + 28);
  const tenDaysOut  = new Date(T); tenDaysOut.setDate(tenDaysOut.getDate() + 10);

  const recentlyCompleted = [];
  const thisWeek          = [];
  const inProgress        = [];
  const comingUp          = [];
  const decisionsNeeded   = [];
  const potentialBlockers = [];

  for (const t of tasks) {
    // Recently completed
    if (statusIsCompleted(t.status)) {
      const anchor = t.endDate || t.startDate;
      if (inRange(anchor, past14, T)) recentlyCompleted.push(t);
      continue;
    }
    // In progress — always surfaces, regardless of date
    if (statusIsInProgress(t.status)) {
      inProgress.push(t);
      // In-progress items also count as "active" for the week
    }
    // This week
    if ((statusIsScheduled(t.status) || statusIsInProgress(t.status))
        && inRange(t.startDate, T, nextWeek)
        && !thisWeek.includes(t)) {
      thisWeek.push(t);
    }
    // Coming up (next 2–4 weeks)
    if (inRange(t.startDate, nextWeek, fourWeeks) && !statusIsCompleted(t.status)) {
      comingUp.push(t);
    }
    // Decisions needed
    if (APPROVAL_PENDING.includes(t.approvalStatus) || statusIsWaitingClient(t.status)) {
      decisionsNeeded.push(t);
    }
    // Potential blockers
    if (t.isLongLead && (STATUS.needsScheduling.includes(t.status) || !t.startDate)) {
      potentialBlockers.push(t);
    } else if (t.decisionDeadline && inRange(t.decisionDeadline, T, tenDaysOut)) {
      potentialBlockers.push(t);
    }
  }

  // De-dupe (a task can hit multiple buckets legitimately — that's fine —
  // but same-bucket duplicates are noise)
  const uniq = arr => Array.from(new Set(arr.map(t => t.id))).map(id => arr.find(t => t.id === id));
  return {
    recentlyCompleted: uniq(recentlyCompleted).sort(byStart),
    thisWeek:          uniq(thisWeek).sort(byStart),
    inProgress:        uniq(inProgress).sort(byStart),
    comingUp:          uniq(comingUp).sort(byStart),
    decisionsNeeded:   uniq(decisionsNeeded).sort(byDeadline),
    potentialBlockers: uniq(potentialBlockers).sort(byStart),
  };
}
function byStart(a, b) {
  const da = a.startDate ? Date.parse(a.startDate) : Infinity;
  const db = b.startDate ? Date.parse(b.startDate) : Infinity;
  return da - db;
}
function byDeadline(a, b) {
  const da = a.decisionDeadline ? Date.parse(a.decisionDeadline) : Infinity;
  const db = b.decisionDeadline ? Date.parse(b.decisionDeadline) : Infinity;
  return da - db;
}

// ── Address (spec §3 + §5) ───────────────────────────────────────────────
// Returns a shape that carries enough diagnostic context to build a useful
// error message when the address can't be resolved. Historical silent
// "add this project's address..." messages were misleading — usually the
// Projects DB just wasn't shared with the portal's Notion integration,
// but the fallback message implied the address was literally missing.
let _projectsAddressCache = null;
async function fetchProjectAddresses() {
  if (_projectsAddressCache) return _projectsAddressCache;
  const cache = { table: {}, error: null };
  try {
    const pages = await notionQueryAll(PROJECTS_DB_ID);
    pages.forEach(p => {
      const name = prop(p, 'Project Name');
      const addr = prop(p, 'Project Address');
      if (name && addr) cache.table[name.toLowerCase().trim()] = addr;
    });
  } catch (e) {
    cache.error = (e && e.message) ? e.message : 'unknown error';
    console.warn('Projects DB fetch failed:', cache.error);
  }
  _projectsAddressCache = cache;
  return cache;
}

async function resolveAddress(clientName, tasks) {
  const { table, error } = await fetchProjectAddresses();
  if (!error) {
    const cn = (clientName || '').toLowerCase().trim();
    for (const [projName, addr] of Object.entries(table)) {
      if (cn.includes(projName.split(' ')[0]) || projName.includes(cn.split(' ')[0])) {
        return { address: addr, source: 'projects_db' };
      }
    }
  }
  // Fallback: first non-empty Job Site Location on tasks
  for (const t of tasks) {
    if (t.jobSiteLocation) return { address: t.jobSiteLocation, source: 'job_site_location' };
  }
  return {
    address:          null,
    source:           null,
    projectsDbError:  error,
    projectsDbEntries: Object.keys(table).length,
  };
}

// ── Weather (Open-Meteo — free, no key) ─────────────────────────────────
// Open-Meteo's free geocoding only accepts place names (city / town /
// county), not full street addresses. A "106 Reynolds Ln, Hartford, KY"
// returns zero results but "Hartford, KY" resolves cleanly. This helper
// strips a US-style street address down to progressively simpler queries
// and returns the first one that hits — since we only need weather for
// the general area, city-level precision is plenty.
// Extract a "City, ST" pair from any US-style address, even when the
// commas are missing or in weird places. Finds the 2-letter state code
// at the end (with or without ZIP after it), then walks backward through
// the words picking up the city — stopping at a street suffix ("St",
// "Ln", "Cir", etc.) or a numeric token so a jammed-together address
// like "914 Faulkirk Cir Elizabethtown, KY 42701" still yields
// "Elizabethtown, KY" for geocoding.
function extractCityState(addr) {
  const stateMatch = String(addr || '').match(/[,\s]+([A-Z]{2})\b(?:\s+\d[\d\s-]*)?\s*$/);
  if (!stateMatch) return null;
  const state       = stateMatch[1];
  const beforeState = addr.substring(0, stateMatch.index);
  const streetSuffixes = /^(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cir|circle|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|trl|trail|ter|terrace|sq|square|loop|run|xing|crossing)$/i;
  const words = beforeState.trim().split(/\s+/).map(w => w.replace(/[.,]/g, '')).filter(Boolean);
  const city = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (streetSuffixes.test(w)) break;   // hit a street-type word
    if (/^\d/.test(w))         break;    // hit a house / apartment number
    city.unshift(w);
    if (city.length >= 3) break;         // cities almost never exceed 3 words
  }
  return city.length ? `${city.join(' ')}, ${state}` : null;
}

function addressAttempts(address) {
  const attempts = [address];

  // Primary smart attempt: city + state extracted regardless of comma placement.
  // Usually the fastest hit for Open-Meteo since it only understands place names.
  const cityState = extractCityState(address);
  if (cityState) attempts.push(cityState);

  // Comma-split fallbacks for well-formatted addresses
  const parts = (address || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    attempts.push(parts.slice(1).join(', '));                   // drop street
    const last      = parts[parts.length - 1];
    const noZipTail = last.replace(/\s+\d[\d\s-]*$/, '').trim();
    if (noZipTail && noZipTail !== last) {
      attempts.push(parts.slice(0, -1).concat(noZipTail).join(', '));
      attempts.push(parts.slice(1, -1).concat(noZipTail).join(', '));
    }
    attempts.push(parts[parts.length - 2]);                     // just second-to-last chunk
  }

  return [...new Set(attempts.map(s => s && s.trim()).filter(Boolean))];
}

async function geocode(address) {
  const tried = [];
  for (const q of addressAttempts(address)) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    tried.push(q);
    try {
      const res = await fetch(url);
      if (!res.ok) continue;                          // 404 / 500 → try next
      const j = await res.json();
      const hit = (j.results || [])[0];
      if (hit) return { lat: hit.latitude, lon: hit.longitude, place: `${hit.name}, ${hit.admin1 || hit.country_code || ''}`.trim(), matchedQuery: q };
    } catch { /* network glitch — try next */ }
  }
  throw new Error(`No geocode result (tried: ${tried.join(' | ')})`);
}

async function forecastMonFri(lat, lon, T) {
  const start = new Date(T);
  const end   = new Date(T); end.setDate(end.getDate() + 4);
  const iso = d => d.toISOString().slice(0, 10);
  // Open-Meteo defaults to Celsius + millimeters. Force Fahrenheit + inches
  // so weatherAdj's tempMin<=32 "freezing" check and precipSum>=0.25
  // threshold actually match U.S. weather expectations. Without these,
  // a warm summer day in Kentucky (~24°C) reads as freezing and 6mm of
  // spitting rain reads as heavy.
  const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
             + `&daily=weathercode,precipitation_sum,precipitation_probability_max,temperature_2m_min,temperature_2m_max`
             + `&temperature_unit=fahrenheit&precipitation_unit=inch`
             + `&timezone=America%2FChicago&start_date=${iso(start)}&end_date=${iso(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Forecast ${res.status}`);
  const j = await res.json();
  const d = j.daily || {};
  const days = (d.time || []).map((day, i) => ({
    date:       day,
    weatherCode: d.weathercode?.[i]                ?? null,
    precipSum:  d.precipitation_sum?.[i]          ?? 0,
    precipProb: d.precipitation_probability_max?.[i] ?? 0,
    tempMin:    d.temperature_2m_min?.[i]          ?? null,
    tempMax:    d.temperature_2m_max?.[i]          ?? null,
  }));
  return days;
}

// Interpret WMO weathercode + numbers into a short adjective
function weatherAdj(day) {
  if (day.tempMin != null && day.tempMin <= 32) return 'freezing';
  const c = day.weatherCode;
  if (c >= 95) return 'thunderstorms';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 61 && c <= 67) return 'heavy rain';
  if (c >= 51 && c <= 57) return 'showers';
  if (day.precipProb >= 60 || day.precipSum >= 0.25) return 'rain likely';
  return null;
}

function weatherSensitiveTasks(thisWeek) {
  return thisWeek.filter(t => WEATHER_SENSITIVE.test(`${t.trade || ''} ${t.name || ''}`));
}

// Fetch structured weather data — days[], sensitiveTasks[], place, error.
// Consumed by both the LLM polisher (structured input) and the deterministic
// renderer (fallback string). Keeps all HTTP calls / geocoding in one place
// so failures produce a clean error string once, not scattered messages.
async function weatherData(addr, tasks, thisWeek, T) {
  if (!addr.address) {
    if (addr.projectsDbError) {
      return { error: `could not read the Projects Notion database (${(addr.projectsDbError || '').slice(0, 120)}). Share it with the Six Arrows portal integration (··· → Connections in Notion), or fill Job Site Location on any task as a fallback.` };
    }
    if (addr.projectsDbEntries > 0) {
      return { error: `this project isn't matching an entry in the Projects Notion database, and no task has Job Site Location filled. Add a row with a Project Name starting with the same word as this client.` };
    }
    return { error: 'no address available. Add this project to the Projects Notion database (or fill Job Site Location on any task).' };
  }
  let geo;
  try { geo = await geocode(addr.address); }
  catch (e) { return { error: `could not resolve address "${addr.address}" — ${e.message}.` }; }

  let days;
  try { days = await forecastMonFri(geo.lat, geo.lon, T); }
  catch (e) { return { error: `forecast lookup failed — ${e.message}.` }; }

  const sensitive = weatherSensitiveTasks(thisWeek).map(t => ({
    name:      t.name,
    startDate: t.startDate,
    endDate:   t.endDate,
    trade:     t.trade || '',
  }));

  return {
    place:            geo.place,
    address:          addr.address,
    matchedQuery:     geo.matchedQuery,
    days:             days.map(d => ({ ...d, adj: weatherAdj(d), day: dayLabel(d.date) })),
    sensitiveTasks:   sensitive,
    error:            null,
  };
}

// Deterministic fallback renderer used when Claude polish is skipped or fails.
function renderWeatherLine(w) {
  if (w.error) return 'Weather: ' + w.error;
  const bad = (w.days || []).filter(d => d.adj);
  if (!bad.length) return 'Dry week ahead — no weather risk to this week\'s work.';
  if (!w.sensitiveTasks.length) {
    return `${bad.map(d => `${d.day} ${d.adj}`).join(', ')} — no weather-sensitive tasks scheduled, mostly indoor work.`;
  }
  const trades = Array.from(new Set(w.sensitiveTasks.map(t => (t.trade || t.name).split(/[—-]/)[0].trim()).filter(Boolean))).slice(0, 3);
  const badDays = bad.map(d => `${d.day} (${d.adj})`).join(', ');
  return `${badDays} — could slow or push ${trades.join(' / ') || 'weather-sensitive work'} this week.`;
}
function dayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

// ── Formatting (spec §6) ─────────────────────────────────────────────────
function fmtDateRange(t) {
  if (!t.startDate) return '';
  const s = new Date(t.startDate + (t.startDate.length === 10 ? 'T00:00:00' : ''));
  const startLbl = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (t.endDate && t.endDate !== t.startDate) {
    const e = new Date(t.endDate + (t.endDate.length === 10 ? 'T00:00:00' : ''));
    return `${startLbl}–${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  return startLbl;
}
function fmtDeadline(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderTaskLine(t, opts = {}) {
  const parts = [`- ${t.name}`];
  const when = fmtDateRange(t);
  const noteChunks = [];
  if (opts.showDate && when) noteChunks.push(when);
  if (opts.showStatus && t.status && !statusIsCompleted(t.status)) noteChunks.push(t.status);
  if (t.clientNote) noteChunks.push(t.clientNote);
  if (noteChunks.length) parts[0] += ' — ' + noteChunks.join('. ');
  // "What done looks like" sub-line (only when we have real content)
  if (opts.showDone && t.defOfDone) {
    parts.push(`  - What done looks like: ${t.defOfDone}`);
  }
  return parts.join('\n');
}

function renderSection(title, tasks, opts) {
  if (!tasks.length) return '';
  return `\n${title}\n` + tasks.map(t => renderTaskLine(t, opts)).join('\n');
}

function renderDecisionLine(t) {
  const label = t.approvalNotes ? `${t.name} — ${t.approvalNotes}` : t.name;
  const due   = t.decisionDeadline ? `needed by ${fmtDeadline(t.decisionDeadline)}` : '';
  const owner = /client/i.test(t.decisionOwner || '') ? ' (your call)' : '';
  return `- ${label}${due ? ` — ${due}` : ''}${owner}`;
}

function buildBody(clientName, T, buckets, weather) {
  const header = `${clientName} — Weekly Update — ${T.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const chunks = [header];

  const scheduledSection = renderSection('Scheduled this week', buckets.thisWeek, { showDate: true, showDone: true });
  if (scheduledSection) chunks.push(scheduledSection);

  const inProgSection = renderSection('In progress',
    buckets.inProgress.filter(t => !buckets.thisWeek.some(w => w.id === t.id)),
    { showStatus: false });
  if (inProgSection) chunks.push(inProgSection);

  const doneSection = renderSection('Recently completed', buckets.recentlyCompleted, {});
  if (doneSection) chunks.push(doneSection);

  const upSection = renderSection('Coming up next (2–4 weeks)', buckets.comingUp.slice(0, 8), { showDate: true });
  if (upSection) chunks.push(upSection);

  if (buckets.decisionsNeeded.length) {
    chunks.push('\nDecisions we need from you\n' + buckets.decisionsNeeded.map(renderDecisionLine).join('\n'));
  }

  if (buckets.potentialBlockers.length) {
    chunks.push('\nPotential blockers\n' + buckets.potentialBlockers.map(t => {
      const bits = [];
      if (t.isLongLead) bits.push('long lead');
      if (t.decisionDeadline) bits.push(`deadline ${fmtDeadline(t.decisionDeadline)}`);
      return `- ${t.name}${bits.length ? ' — ' + bits.join(', ') : ''}`;
    }).join('\n'));
  }

  if (weather) chunks.push('\nWeather watch\n- ' + weather);

  return chunks.join('\n');
}

// ── Claude polish (Cole's voice) ────────────────────────────────────────
// Takes the same bucketed data the deterministic renderer uses and asks
// Claude to compose a natural-voice update. Claude is told to use ONLY
// the provided data — nothing invented — and to match Cole's phrasing
// patterns from prior weeks. Falls back to the deterministic renderer if
// the API errors, so we never ship nothing.
//
// Uses ANTHROPIC_API_KEY (already set in Netlify for other functions).
// Model: claude-sonnet-4-5. About $0.05 per client per run.
async function polishWithClaude(client, T, buckets, weather) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set — cannot polish');

  const headerDate = T.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // Distill each bucket into compact JSON — trim fields Claude doesn't need
  const distill = t => {
    const o = { name: t.name };
    if (t.status)          o.status          = t.status;
    if (t.startDate)       o.start           = t.startDate;
    if (t.endDate)         o.end             = t.endDate;
    if (t.trade)           o.trade           = t.trade;
    if (t.phase)           o.phase           = t.phase;
    if (t.clientNote)      o.clientNote      = t.clientNote;
    if (t.defOfDone)       o.defOfDone       = t.defOfDone;
    if (t.isLongLead)      o.longLead        = true;
    if (t.isMilestone)     o.milestone       = true;
    if (t.approvalStatus)  o.approvalStatus  = t.approvalStatus;
    if (t.approvalNotes)   o.approvalNotes   = t.approvalNotes;
    if (t.decisionDeadline)o.decisionDeadline= t.decisionDeadline;
    if (t.decisionOwner)   o.decisionOwner   = t.decisionOwner;
    return o;
  };

  const payload = {
    clientName:       client.client_name,
    weekOf:           headerDate,
    place:            weather.place || null,
    tasks: {
      thisWeek:          buckets.thisWeek.map(distill),
      inProgress:        buckets.inProgress.map(distill),
      recentlyCompleted: buckets.recentlyCompleted.map(distill),
      comingUp:          buckets.comingUp.slice(0, 12).map(distill),
      decisionsNeeded:   buckets.decisionsNeeded.map(distill),
      longLeadBlockers:  buckets.potentialBlockers.filter(t => t.isLongLead).map(distill),
    },
    weather: weather.error
      ? { error: weather.error }
      : {
          place: weather.place,
          days:  (weather.days || []).map(d => ({
            day:        d.day,
            tempHigh:   d.tempMax,
            tempLow:    d.tempMin,
            precipProb: d.precipProb,
            precipIn:   d.precipSum,
            adj:        d.adj || 'clear',
          })),
          sensitiveTasks: weather.sensitiveTasks,
        },
  };

  const systemPrompt = `You are drafting the weekly customer construction update for Six Arrows Construction, in Cole Borders' voice. Cole reviews these before texting them to customers.

VOICE
- Warm, plain, specific — never fluffy. No jargon.
- Text-message friendly: short lines, no tables, no markdown headers beyond the section labels I give you.
- Cole phrases things like:
  * "Framing — walls, floors, and roof structure wrapped 8/14."
  * "Roof dry-in and roofing install — finishing up Tue 8/18"
  * "Plumbing rough-in (main + basement walls) — starts Mon 8/17, runs through 8/31"
  * "Cabinet order goes in — 8/17–8/21"
  * "Post-framing selections lockdown — still pending. Items to lock: cabinet style, wood species, finish, and hardware; tile selections including layouts."

STRICT DATA RULES
- Use ONLY the source data provided. NEVER invent tasks, dates, notes, prices, or details.
- If a task has no clientNote, don't add one.
- If defOfDone is missing, omit the "What done looks like:" sub-line entirely.
- If a whole section has zero items, OMIT the section header — do not write "No items" or leave a blank header.
- Do not add closing signatures or greetings.

STRUCTURE (in this exact order, omit any empty section)
<Client Name> — Weekly Update — <Sun, Mon D>

Scheduled this week
- <task natural sentence with date/range and clientNote woven in>
  - What done looks like: <defOfDone verbatim, only if provided>

In progress
- <task with status/context if useful>

Recently completed
- <task with clientNote or a brief factual note>

Coming up next (2–4 weeks)
- <task with approx timing>

Decisions we need from you
- <item with deadline and owner if present>
(If several decisions are tied together, feel free to combine into a single short paragraph — Cole often does this for a "selections lockdown" moment.)

Heads up on long-lead items
<Prose paragraph — ONLY when longLeadBlockers has entries. Name them, note the lead-time pressure.>

Weather watch (<City>)
<If weather.error is set, print exactly "Weather: <error>" as the whole section.>
<Otherwise: one line per Mon–Fri day with conditions/high/precip in Cole's voice, then a sentence connecting weather to any sensitiveTasks scheduled this week. State impact factually — do not estimate delay days.>

DATE PHRASING
- Refer to dates naturally: "8/14", "Mon 8/17", "8/17–8/31", "wrapped 8/14", "starts Mon 8/17", "targeting 8/26", "finishing up Tue 8/18".
- Don't say "date range" or use ISO dates.

OUTPUT the update text only. No preamble, no explanation, no code fences.`;

  const userContent = `SOURCE DATA (JSON):
${JSON.stringify(payload, null, 2)}

Write the update now, in Cole's voice, following every rule above.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          key,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 2000,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userContent }],
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
  }
  const j = await res.json();
  const text = (j.content?.[0]?.text || '').trim();
  if (!text) throw new Error('Anthropic returned empty text');
  return text;
}

// ── Supabase helpers ────────────────────────────────────────────────────
function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

async function fetchConstructionClients() {
  const url = `${SB_URL()}/rest/v1/clients?status_type=eq.construction&notion_timeline_db_id=not.is.null`
            + `&select=id,client_name,notion_timeline_db_id`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase clients fetch: ${res.status}`);
  return await res.json();
}

async function saveDraft(clientId, title, body, targetDateIso) {
  // Delete any prior unapproved draft for the same target date so we don't
  // stack multiple Sunday runs on top of each other (retriggering the
  // manual endpoint from admin should replace, not duplicate).
  const dupCheck = `${SB_URL()}/rest/v1/updates?client_id=eq.${clientId}&approved=eq.false&date=eq.${encodeURIComponent(targetDateIso)}`;
  await fetch(dupCheck, { method: 'DELETE', headers: sbHeaders() }).catch(() => {});

  const res = await fetch(`${SB_URL()}/rest/v1/updates`, {
    method:  'POST',
    headers: sbHeaders(),
    body:    JSON.stringify({
      client_id: clientId,
      title,
      body,
      date:      targetDateIso,
      approved:  false,
      manual:    false,
    }),
  });
  if (!res.ok) throw new Error(`Save draft: ${res.status} ${await res.text()}`);
  return await res.json();
}

// ── Per-client generation ───────────────────────────────────────────────
async function generateForClient(client, T, { raw = false } = {}) {
  const map    = fieldMap(client.notion_timeline_db_id);
  const pages  = await notionQueryAll(client.notion_timeline_db_id);
  const tasks  = pages.map(p => normalizeTask(p, map)).filter(t => t.name);

  const buckets = bucketTasks(tasks, T);

  // Skip clients with truly nothing to say (no active buckets)
  const anyActive = buckets.thisWeek.length + buckets.inProgress.length
                  + buckets.recentlyCompleted.length + buckets.comingUp.length
                  + buckets.decisionsNeeded.length;
  if (!anyActive) {
    return { clientId: client.id, clientName: client.client_name, skipped: true, reason: 'no active tasks in window' };
  }

  const address = await resolveAddress(client.client_name, tasks);
  const weather = await weatherData(address, tasks, buckets.thisWeek, T);

  // Try Claude polish for Cole's-voice output; fall back to deterministic
  // renderer if the API errors OR the caller asked for raw output (?raw=1).
  let body;
  let voice = 'raw';
  let polishError = null;
  if (!raw) {
    try {
      body  = await polishWithClaude(client, T, buckets, weather);
      voice = 'claude';
    } catch (e) {
      polishError = (e && e.message) ? e.message : String(e);
      console.warn(`polishWithClaude(${client.id}) failed, using raw:`, polishError);
    }
  }
  if (!body) {
    body = buildBody(client.client_name, T, buckets, renderWeatherLine(weather));
  }

  const title   = `Weekly Update — ${T.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const dateIso = T.toISOString().slice(0, 10);

  return {
    clientId:    client.id,
    clientName:  client.client_name,
    title,
    body,
    date:        dateIso,
    voice,
    polishError,
    stats: {
      thisWeek:          buckets.thisWeek.length,
      inProgress:        buckets.inProgress.length,
      recentlyCompleted: buckets.recentlyCompleted.length,
      comingUp:          buckets.comingUp.length,
      decisions:         buckets.decisionsNeeded.length,
      blockers:          buckets.potentialBlockers.length,
    },
  };
}

// ── T = next Monday from now ─────────────────────────────────────────────
function nextMonday(now = new Date()) {
  const d = new Date(now);
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const day = d.getDay();
  // If today is Monday, use today (T stays "this week"). Otherwise roll forward.
  const daysToAdd = day === 1 ? 0 : (1 - day + 7) % 7;
  d.setDate(d.getDate() + daysToAdd);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };

  if (!SB_URL() || !SB_KEY()) return respond(500, { error: 'Supabase env vars missing' });
  if (!NT_TOKEN())            return respond(500, { error: 'NOTION_TOKEN not set' });

  const q       = event.queryStringParameters || {};
  const dryRun  = q.dryRun === '1';
  const raw     = q.raw    === '1';    // skip Claude polish, force deterministic
  const oneOnly = q.clientId;
  const T       = nextMonday();

  try {
    const allClients = await fetchConstructionClients();
    const clients    = oneOnly ? allClients.filter(c => c.id === oneOnly) : allClients;
    if (!clients.length) return respond(200, { message: 'No matching construction clients found', T: T.toISOString() });

    const results = [];
    for (const c of clients) {
      try {
        const r = await generateForClient(c, T, { raw });
        if (r.skipped) { results.push(r); continue; }
        if (!dryRun) {
          const saved = await saveDraft(c.id, r.title, r.body, r.date);
          r.savedId = saved?.[0]?.id || null;
        }
        results.push(r);
      } catch (err) {
        console.error(`generateForClient(${c.id}) failed:`, err);
        results.push({ clientId: c.id, clientName: c.client_name, error: err.message });
      }
    }

    return respond(200, {
      T: T.toISOString().slice(0, 10),
      dryRun,
      generated: results.filter(r => !r.skipped && !r.error).length,
      skipped:   results.filter(r => r.skipped).length,
      failed:    results.filter(r => r.error).length,
      results,
    });
  } catch (err) {
    console.error('notion-weekly-update error:', err);
    return respond(500, { error: err.message });
  }
};
