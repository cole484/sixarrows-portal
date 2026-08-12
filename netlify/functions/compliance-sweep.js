// netlify/functions/compliance-sweep.js
//
// Keeps subcontractor compliance documents current without anyone remembering
// to check. Reads the two Drive folders, matches files to subs, pulls the
// policy expiry out of each certificate, writes the truth back to Notion, then
// emails subs whose documents are missing or expired ahead of work they are
// scheduled for.
//
//   GET /                    report only, sends nothing (the default)
//   GET /?send=1             actually send the due emails
//   GET /?test=1             send one sample email to Cole, nothing to any sub
//   GET /?days=45            how far ahead to look for scheduled work
//   GET /?syncOnly=1         refresh Notion from Drive, skip all email logic
//   GET /?sub=artisan        narrow the report to subs whose name matches,
//                            and show which file was used and why. 78 subs of
//                            JSON is unreadable when you are checking two.
//
// Sending is opt-in for manual runs and automatic on the cron, matching
// scheduling-gate.js. Nothing reaches a subcontractor from a casual curl.

import { supabase } from './lib/supabase-client.js';
import { sendGmail, gmailConfigured, senderAddress } from './lib/gmail.js';
import { buildSubject, buildBody, nextAction, FROM_EMAIL } from './lib/compliance-email.js';
import {
  listFolder, matchSub, readCoiExpiry, coiState,
  COI_FOLDER_ID, W9_FOLDER_ID,
} from './lib/compliance-docs.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
// Notion exposes two different ids per database, and they are easy to confuse:
// a "data source" / collection id (what the MCP tooling and collection:// URLs
// hand you) and the database id (what the REST API wants). Passing a data
// source id to /databases/{id}/query returns 404 object_not_found with a
// message about sharing, which sends you hunting for a permissions problem
// that does not exist. These are database ids.
const SUBS_DB_ID     = '1944737b-ea6f-8086-8f45-f6b479ed36bb';

// Six Arrows has a row in the Subcontractors DB. It is not a subcontractor of
// itself, and leaving it in means the sweep reports the company as having no
// insurance and would eventually email Cole asking Cole for a certificate.
const OWN_COMPANY = /^six arrows/i;

const DEFAULT_LOOKAHEAD_DAYS = 45;

const TIMELINE_DBS = [
  { dbId: '437bb594-ae27-437b-9014-48c5e6739e8c', project: 'Johnson' },
];

// ── Notion ────────────────────────────────────────────────────────────────
function nHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

async function nQueryAll(dbId, token, body = {}) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const payload = { page_size: 100, ...body };
    if (cursor) payload.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: 'POST', headers: nHeaders(token), body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      // A 404 here is far more often the wrong id than a sharing problem,
      // because Notion's message says 'share with your integration' either way.
      const why = res.status === 404
        ? ' (check this is the database id, not the data source / collection id, before chasing sharing)'
        : '';
      throw new Error(`Notion query ${dbId}: ${res.status}${why} ${txt}`);
    }
    const data = await res.json();
    out.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return out;
}

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'rich_text':    return p.rich_text?.map(t => t.plain_text).join('').trim() || null;
    case 'date':         return p.date || null;
    case 'number':       return p.number ?? null;
    case 'checkbox':     return !!p.checkbox;
    case 'select':       return p.select?.name || null;
    case 'status':       return p.status?.name || null;
    case 'email':        return p.email || null;
    case 'relation':     return (p.relation || []).map(r => r.id);
    default:             return null;
  }
}

async function patchSub(pageId, token, properties) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH', headers: nHeaders(token), body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Notion patch ${pageId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

// ── Handler ───────────────────────────────────────────────────────────────
export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };

  const token  = process.env.NOTION_TOKEN;
  const gKey   = process.env.GOOGLE_API_KEY;
  if (!token) return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };
  if (!gKey)  return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'GOOGLE_API_KEY not set' }) };

  const q        = event.queryStringParameters || {};
  const days     = Number(q.days) > 0 ? Number(q.days) : DEFAULT_LOOKAHEAD_DAYS;
  const syncOnly = q.syncOnly === '1';
  const only     = (q.sub || '').trim().toLowerCase();   // narrow the report
  const isCron   = event.httpMethod === 'POST' && String(event.body || '').includes('next_run');
  const doSend   = isCron || q.send === '1';
  const today    = new Date().toISOString().slice(0, 10);

  const report = {
    generatedAt: new Date().toISOString(),
    sent: doSend, syncOnly,
    documents: { coiFiles: 0, w9Files: 0, matched: 0, unmatched: [] },
    subs: [], actions: [], errors: [],
  };

  try {
    // ── 1. Smoke test: one email to Cole, nothing to any sub ──────────────
    if (q.test === '1') {
      if (!gmailConfigured()) return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: 'Gmail not configured' }) };
      const body = buildBody({
        contactName: 'Cole', subName: 'Test Sub', projectName: 'Johnson',
        projectAddress: '106 Reynolds Ln, Hartford, KY',
        taskName: 'Underslab plumbing rough-in', startDate: '2026-08-24',
        coiState: 'expired', coiExpiry: '2025-08-04', needsW9: true, attempt: 1,
      });
      const sent = await sendGmail({
        to: FROM_EMAIL,
        subject: '[TEST] ' + buildSubject({ coiState: 'expired', needsW9: true, taskName: 'Underslab plumbing rough-in' }),
        body: `This is a test send from compliance-sweep. No subcontractor received anything.\n\nBelow is what a real request looks like.\n\n${'-'.repeat(60)}\n\n${body}`,
      });
      return { statusCode: 200, headers: corsH, body: JSON.stringify({ test: true, sentTo: FROM_EMAIL, from: senderAddress(), ...sent }, null, 2) };
    }

    // ── 2. Read Drive and the Subcontractors DB ───────────────────────────
    const [coiFiles, w9Files, subPages] = await Promise.all([
      listFolder(COI_FOLDER_ID, gKey),
      listFolder(W9_FOLDER_ID,  gKey),
      nQueryAll(SUBS_DB_ID, token),
    ]);

    report.documents.coiFiles = coiFiles.length;
    report.documents.w9Files  = w9Files.length;

    const subs = subPages.map(p => ({
      id:      p.id,
      name:    prop(p, 'Subcontractor Name'),
      email:   prop(p, 'Email'),
      contact: prop(p, 'Contact Name'),
      status:  prop(p, 'Status'),
      insured: prop(p, 'Insurance on File'),
      coiOn:   prop(p, 'COI Expiration')?.start || null,
      w9On:    prop(p, 'W9 on File'),
    })).filter(s => s.name && !OWN_COMPANY.test(s.name));

    // Newest file wins when a sub has several certificates on file.
    const bySub = new Map();          // subId -> { coiFile, w9File }
    const claim = (file, kind) => {
      const m = matchSub(file.name, subs);
      if (!m) { report.documents.unmatched.push({ kind, file: file.name }); return; }
      const cur = bySub.get(m.sub.id) || {};
      const key = kind === 'coi' ? 'coiFile' : 'w9File';
      if (!cur[key] || file.modifiedTime > cur[key].modifiedTime) cur[key] = file;
      bySub.set(m.sub.id, cur);
    };
    coiFiles.forEach(f => claim(f, 'coi'));
    w9Files.forEach(f  => claim(f, 'w9'));
    report.documents.matched = bySub.size;

    // ── 3. Read expiry from each matched certificate, write back to Notion ─
    const state = new Map();          // subId -> { coiState, coiExpiry, hasW9 }
    for (const sub of subs) {
      const docs = bySub.get(sub.id) || {};
      let expiry = null, confidence = 'none', parseError = null;

      if (docs.coiFile) {
        const r = await readCoiExpiry(docs.coiFile.id, gKey, docs.coiFile);
        expiry = r.expiry; confidence = r.confidence; parseError = r.error || null;
        if (parseError) report.errors.push({ sub: sub.name, file: docs.coiFile.name, error: parseError });
      }

      const cs     = coiState(expiry, today, !!docs.coiFile);
      const hasW9  = !!docs.w9File;
      state.set(sub.id, { coiState: cs, coiExpiry: expiry, hasW9 });

      // Only write when something actually changed, to keep Notion's edit
      // history meaningful rather than a wall of no-op touches.
      // We hold a certificate in the 'unreadable' case, so the checkbox stays
      // true. It is the expiry we do not know, and that is what the report
      // surfaces for a human to fill in.
      const wantInsured = cs === 'ok' || cs === 'unreadable';
      const changed =
        sub.insured !== wantInsured ||
        (sub.coiOn || null) !== (expiry || null) ||
        sub.w9On !== hasW9;

      if (changed) {
        const properties = {
          'Insurance on File': { checkbox: wantInsured },
          'W9 on File':        { checkbox: hasW9 },
        };
        if (expiry) properties['COI Expiration'] = { date: { start: expiry } };
        try {
          await patchSub(sub.id, token, properties);
        } catch (err) {
          report.errors.push({ sub: sub.name, error: `Notion writeback failed: ${err.message}` });
        }
      }

      if (!only || sub.name.toLowerCase().includes(only)) {
        report.subs.push({
          name: sub.name,
          coiState: cs,
          coiExpiry: expiry,
          confidence,
          // The two questions worth answering when a state looks wrong: did a
          // file get matched at all, and if so could its expiry be read?
          coiFile: docs.coiFile ? docs.coiFile.name : null,
          coiParseError: parseError,
          w9File: docs.w9File ? docs.w9File.name : null,
          hasW9,
          email: sub.email || null,
          updated: changed,
        });
      }
    }

    if (only) {
      // Keep unmatched files that plausibly relate to what is being asked
      // about, and drop the rest so the answer is readable.
      report.documents.unmatched = report.documents.unmatched.filter(u => u.file.toLowerCase().includes(only));
      report.errors = report.errors.filter(e => JSON.stringify(e).toLowerCase().includes(only));
    }

    if (syncOnly) {
      return { statusCode: 200, headers: corsH, body: JSON.stringify(report, null, 2) };
    }

    // ── 4. Which subs have work coming up? ────────────────────────────────
    const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const upcoming = new Map();       // subId -> soonest { project, taskId, taskName, start }

    for (const t of TIMELINE_DBS) {
      const pages = await nQueryAll(t.dbId, token, {
        filter: { and: [
          { property: 'Start', date: { on_or_after:  today   } },
          { property: 'Start', date: { on_or_before: horizon } },
        ] },
      });
      for (const page of pages) {
        if (prop(page, 'Status') === 'Completed') continue;
        const ids = prop(page, 'Subcontractor') || [];
        if (!ids.length) continue;
        const start = prop(page, 'Start')?.start || null;
        const entry = { project: t.project, taskId: page.id, taskName: prop(page, 'Task'), start };
        const cur   = upcoming.get(ids[0]);
        if (!cur || (start && start < cur.start)) upcoming.set(ids[0], entry);
      }
    }

    // ── 5. Decide and act, per sub with a problem on upcoming work ────────
    for (const [subId, job] of upcoming) {
      const sub = subs.find(s => s.id === subId);
      if (!sub) continue;
      const st = state.get(subId) || { coiState: 'missing', coiExpiry: null, hasW9: false };

      // 'unreadable' means we hold their certificate and could not read the
      // expiry. Emailing "we need a certificate of insurance" to someone who
      // sent one is the worst thing this system could do, so it never does.
      // It becomes a job for a person instead.
      if (st.coiState === 'unreadable') {
        report.actions.push({
          sub: sub.name, action: 'review',
          reason: 'a certificate is on file but its expiry could not be read automatically. Open it and set COI Expiration by hand.',
          task: job.taskName, start: job.start,
        });
        if (!st.hasW9) {
          report.actions.push({
            sub: sub.name, action: 'skipped',
            reason: 'W9 is also missing, but holding the email until the certificate above is resolved so the sub gets one message rather than two.',
          });
        }
        continue;
      }

      const needsCoi = st.coiState !== 'ok';
      const needsW9  = !st.hasW9;
      if (!needsCoi && !needsW9) continue;

      const docNeeds = [needsCoi && 'coi', needsW9 && 'w9'].filter(Boolean).join('+');

      let history = [];
      try {
        history = await supabase('compliance_requests', {
          select: 'created_at,attempt,action,gmail_thread_id', filters: [{ col: 'sub_id', op: 'eq', val: subId }],
          order: 'created_at.desc', limit: 10,
        });
      } catch (err) {
        report.errors.push({ sub: sub.name, error: `could not read request history: ${err.message}` });
        continue;                    // never re-send blind
      }

      const sends   = history.filter(h => h.action === 'send').map(h => ({ sent_at: h.created_at, attempt: h.attempt }));
      const decided = nextAction({ history: sends, startDate: job.start, today });
      if (!decided) continue;

      const record = {
        sub_id: subId, sub_name: sub.name, to_email: sub.email || null,
        doc_needs: docNeeds, coi_state: st.coiState, coi_expiry: st.coiExpiry,
        project: job.project, task_id: job.taskId, task_name: job.taskName,
        start_date: job.start, action: decided.action,
        attempt: decided.attempt || sends.length,
      };

      if (decided.action === 'escalate') {
        record.error = decided.reason;
        report.actions.push({ sub: sub.name, action: 'escalate', reason: decided.reason, task: job.taskName });
        if (doSend) { try { await supabase('compliance_requests', { method: 'POST', body: record }); } catch (e) { report.errors.push({ sub: sub.name, error: e.message }); } }
        continue;
      }

      if (!sub.email) {
        report.actions.push({ sub: sub.name, action: 'skipped', reason: 'no email address on the subcontractor record' });
        continue;
      }

      const subject = buildSubject({ coiState: st.coiState, needsW9, taskName: job.taskName });
      const body    = buildBody({
        contactName: sub.contact, subName: sub.name,
        projectName: job.project, projectAddress: null,
        taskName: job.taskName, startDate: job.start,
        coiState: st.coiState, coiExpiry: st.coiExpiry,
        needsW9, attempt: decided.attempt,
      });
      record.subject = subject;
      record.body    = body;

      report.actions.push({
        sub: sub.name, action: 'send', attempt: decided.attempt,
        to: sub.email, task: job.taskName, start: job.start, subject,
        preview: doSend ? undefined : body,
      });

      if (!doSend) continue;

      try {
        const threadId = history.find(h => h.gmail_thread_id)?.gmail_thread_id || undefined;
        const res = await sendGmail({ to: sub.email, subject, body, threadId });
        record.sent = true;
        record.gmail_message_id = res.id;
        record.gmail_thread_id  = res.threadId;
      } catch (err) {
        record.sent  = false;
        record.error = err.message;
        report.errors.push({ sub: sub.name, error: `send failed: ${err.message}` });
      }

      try { await supabase('compliance_requests', { method: 'POST', body: record }); }
      catch (err) { report.errors.push({ sub: sub.name, error: `could not record request: ${err.message}` }); }
    }

    return { statusCode: 200, headers: corsH, body: JSON.stringify(report, null, 2) };

  } catch (err) {
    console.error('compliance-sweep error:', err);
    return { statusCode: 500, headers: corsH, body: JSON.stringify({ error: err.message }) };
  }
};
