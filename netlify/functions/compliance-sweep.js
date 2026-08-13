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
//   GET /?sub=artisan        narrow the run to subs whose name matches. This
//                            narrows the work and not just the printout: no
//                            document outside the filter is opened, no Notion
//                            row outside it is written, and nobody outside it
//                            is emailed.
//   GET /?force=1            re-read documents instead of using cached reads
//   GET /?rematch=1          open the files that no filename matched and match
//                            them on the name printed inside instead. Slower
//                            and costs a little, so it is opt-in rather than
//                            part of every run.
//   GET /?aiLimit=6          how many documents this run may open with Claude.
//                            0 means read nothing new at all: no downloads, no
//                            parsing, cached answers only. That is the fast
//                            and free report.
//   GET /?diag=1             per file: never opened, opened and failed, or
//                            read cleanly. Opens nothing. This is the call to
//                            make when certificates report as unreadable and
//                            it is not obvious why.
//   GET /?maxWrites=20       ceiling on Notion writebacks in one run
//   GET /?budgetMs=18000     give up and return a partial report after this
//
// Documents are read by the layered reader in lib/compliance-docs.js: a cached
// result, then a local PDF text pass, then Claude for the scans and phone
// photos that have no text to extract. Reads are cached per file and
// modification time, so a daily run costs nothing until a document changes.
//
// aiLimit exists because this function answers an HTTP request and therefore
// has seconds, while opening a document takes several of them. Six fits.
// Twenty-five times out having cached nothing. To read a whole backlog at
// once, use read-compliance-docs-background.js, which has minutes.
//
// Sending is opt-in for manual runs and automatic on the cron, matching
// scheduling-gate.js. Nothing reaches a subcontractor from a casual curl.

import { supabase } from './lib/supabase-client.js';
import { sendGmail, gmailConfigured, senderAddress } from './lib/gmail.js';
import { buildSubject, buildBody, nextAction, FROM_EMAIL } from './lib/compliance-email.js';
import {
  listFolder, matchSub, readCoiExpiry, readW9Identity, coiState,
  COI_FOLDER_ID, W9_FOLDER_ID,
} from './lib/compliance-docs.js';
import { anthropicConfigured, setReadBudget, readsUsed, readsLeft, errorLooksTransient } from './lib/doc-ai.js';
import { loadCacheIndex, cacheKey, probeCache } from './lib/doc-cache.js';

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
  const force    = q.force === '1';
  const rematch  = q.rematch === '1';
  const only     = (q.sub || '').trim().toLowerCase();   // narrow the report
  const isCron   = event.httpMethod === 'POST' && String(event.body || '').includes('next_run');
  const doSend   = isCron || q.send === '1';
  const today    = new Date().toISOString().slice(0, 10);

  // How many documents this run may open with Claude. Cached reads are free
  // and do not count. Six is enough to keep a warm system current; raise it on
  // a manual run to clear a backlog in one go.
  const aiLimit = (q.aiLimit ?? '') === '' ? 6 : Math.max(0, Number(q.aiLimit) || 0);
  setReadBudget(aiLimit);

  // aiLimit=0 means read nothing new, and that has to mean nothing at all.
  // Blocking only the Claude call still left every uncached document being
  // downloaded from Drive and parsed locally, which is where a supposedly free
  // report spent twenty-two seconds. With this, a cache miss is simply
  // reported as not read yet.
  const cacheOnly = aiLimit === 0;

  // This function answers an HTTP request, so it has a fixed and fairly short
  // life. Everything below is written to give up gracefully and return what it
  // has rather than be killed mid-flight: a truncated report tells you what is
  // happening, and a dead connection tells you nothing at all.
  const startedAt = Date.now();
  const deadline  = Number(q.budgetMs) > 0 ? Number(q.budgetMs) : 18_000;
  const outOfTime = () => Date.now() - startedAt > deadline;

  // Writing back to Notion is one request per subcontractor, and the first full
  // sweep after a batch of new reads wants to write nearly all of them. Bounded
  // so the run finishes; the rest go on the next one, and the daily cron means
  // there always is a next one.
  const maxWrites = Number(q.maxWrites) > 0 ? Number(q.maxWrites) : 20;
  let   writes    = 0, writesDeferred = 0, notRead = 0;

  const report = {
    generatedAt: new Date().toISOString(),
    sent: doSend, syncOnly,
    reader: anthropicConfigured() ? 'cache, then PDF text, then Claude' : 'cache, then PDF text (ANTHROPIC_API_KEY not set, so scans cannot be read)',
    documents: { coiFiles: 0, w9Files: 0, matched: 0, rematched: [], unmatched: [] },
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
    // Four requests in parallel, and then no further lookups per document.
    // The cache index is the important one: asking about each file separately
    // meant seventy-odd sequential round trips before the run could start, and
    // that is what was killing this endpoint.
    const [coiFiles, w9Files, subPages, cacheLoad] = await Promise.all([
      listFolder(COI_FOLDER_ID, gKey),
      listFolder(W9_FOLDER_ID,  gKey),
      nQueryAll(SUBS_DB_ID, token),
      loadCacheIndex(),
    ]);
    const cache = cacheLoad.index;
    report.documents.cachedReads = cache ? cache.size : 0;

    // Loud, at the top level, because a cache that cannot be read is not a
    // degraded mode. Every document gets opened, every result is thrown away,
    // and the next run does it all again. That has to be the first thing the
    // report says, not something a person infers from everything else looking
    // wrong.
    if (cacheLoad.error) {
      report.cacheError = `The read cache could not be read, so nothing can be remembered between runs: ${cacheLoad.error}. Until this is fixed, every run re-opens every document. Check that supabase/add-document-reads.sql has been run.`;
    }

    // ── 2a. Diagnostic: what does the reader actually know about each file? ─
    // Every certificate reported as unreadable is one of three different
    // situations, and from a report alone they look identical: never opened,
    // opened and failed, or opened fine but not connected to a sub. This says
    // which, per file, without opening anything.
    if (q.diag === '1') {
      const diag = {
        anthropicKeySet: anthropicConfigured(),
        driveFiles: coiFiles.length + w9Files.length,
        cacheRows: cache ? cache.size : 0,
        cacheError: cacheLoad.error || null,
        // The decisive test: can this key read and write the table at all.
        // The raw database message is the answer, so it is passed through
        // untouched rather than summarized.
        cacheProbe: await probeCache(),
        neverRead: [], willRetry: [], readButFailed: [], readOk: 0, byMethod: {},
      };

      for (const [kind, files] of [['coi', coiFiles], ['w9', w9Files]]) {
        for (const f of files) {
          const row = cache ? cache.get(cacheKey(f.id, f.modifiedTime)) : null;
          if (!row) {
            diag.neverRead.push({ kind, file: f.name, mimeType: f.mimeType, modified: f.modifiedTime });
            continue;
          }
          const m = row.method || 'unknown';
          diag.byMethod[m] = (diag.byMethod[m] || 0) + 1;
          const ok = kind === 'coi' ? !!row.expiry : !!(row.insured_name || row.business_name);
          if (ok) diag.readOk++;
          // A failure that was never about the document belongs in its own
          // list. Reported alongside genuinely unreadable files it looks like
          // a hundred broken certificates rather than one broken account.
          else if (errorLooksTransient(row.error)) diag.willRetry.push({ kind, file: f.name, readAt: row.created_at, error: row.error });
          else diag.readButFailed.push({ kind, file: f.name, method: m, readAt: row.created_at, error: row.error });
        }
      }
      diag.summary =
        `${diag.driveFiles} files in Drive, ${diag.readOk} read cleanly, ` +
        `${diag.readButFailed.length} opened but genuinely unreadable, ` +
        `${diag.willRetry.length} failed for a reason that was not about the document and will be read again, ` +
        `${diag.neverRead.length} never opened.`;
      return { statusCode: 200, headers: corsH, body: JSON.stringify(diag, null, 2) };
    }

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

    // ?sub= narrows the work, not just the printout. It used to narrow only
    // what got rendered, which meant checking one subcontractor quietly opened
    // documents for the other seventy and spent the run's read budget doing it.
    // Matching still runs against every sub, because a file has to be allowed
    // to belong to somebody outside the filter before it can be called
    // unmatched.
    const focus = only ? subs.filter(s => s.name.toLowerCase().includes(only)) : subs;
    const focusIds = new Set(focus.map(s => s.id));

    // Newest file wins when a sub has several certificates on file.
    const bySub   = new Map();        // subId -> { coiFile, w9File }
    const orphans = [];               // files no name matched

    const assign = (file, kind, subId) => {
      const cur = bySub.get(subId) || {};
      const key = kind === 'coi' ? 'coiFile' : 'w9File';
      if (!cur[key] || file.modifiedTime > cur[key].modifiedTime) cur[key] = file;
      bySub.set(subId, cur);
    };

    const claim = (file, kind) => {
      const m = matchSub(file.name, subs);
      if (!m) { orphans.push({ kind, file }); return; }
      assign(file, kind, m.sub.id);
    };
    coiFiles.forEach(f => claim(f, 'coi'));
    w9Files.forEach(f  => claim(f, 'w9'));

    // ── 2b. Match the leftovers on the name printed inside the document ────
    // A filename is whoever typed it. The insured name on a certificate, or
    // line 1 and line 2 of a W9, is who the firm actually is, and it matches
    // the Notion row far more often. Reads are cached, so a rerun costs
    // nothing; opening files that were never read is the part that is opt-in.
    for (const o of orphans) {
      // Same rule as above: a narrowed run reads only what it was asked about.
      if (only && !o.file.name.toLowerCase().includes(only)) continue;
      if (outOfTime()) { report.truncated = 'ran out of time while rematching leftover files'; break; }

      let names = [];
      try {
        const opts = { cacheOnly: cacheOnly || !rematch, force: force && rematch, cache };
        if (o.kind === 'coi') {
          const r = await readCoiExpiry(o.file.id, gKey, o.file, { ...opts, ai: true });
          names = [r.insuredName];
        } else {
          const r = await readW9Identity(o.file.id, gKey, o.file, opts);
          names = [r.name, r.businessName];
        }
      } catch (err) {
        report.errors.push({ file: o.file.name, error: `could not read for rematch: ${err.message}` });
      }

      // Six Arrows is the certificate holder on most of these, so its own name
      // turns up inside documents that belong to somebody else entirely.
      names = names.filter(n => n && !OWN_COMPANY.test(n));

      let hit = null;
      for (const n of names) {
        const m = matchSub(n, subs);
        if (m) { hit = { sub: m.sub, via: n, score: m.score }; break; }
      }

      if (hit) {
        assign(o.file, o.kind, hit.sub.id);
        report.documents.rematched.push({ kind: o.kind, file: o.file.name, matchedTo: hit.sub.name, onName: hit.via });
      } else {
        report.documents.unmatched.push({
          kind: o.kind, file: o.file.name,
          readAs: names[0] || null,
          hint: names.length ? 'the name inside the document does not match any subcontractor row either' : 'not read yet, add rematch=1 to open it',
        });
      }
    }

    report.documents.matched = bySub.size;

    // ── 3. Which subs have work coming up? ────────────────────────────────
    // Computed before the documents are read, not after, because it decides
    // how hard to read them. A sub with a crew arriving in three weeks gets
    // the full read; the other seventy get whatever is cheap.
    const horizon  = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const upcoming = new Map();       // subId -> soonest { project, taskId, taskName, start }

    if (!syncOnly) {
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
    }

    // ── 4. Read each matched certificate, write the truth back to Notion ──
    const state = new Map();          // subId -> { coiState, coiExpiry, hasW9 }
    for (const sub of focus) {
      if (outOfTime()) { report.truncated = `ran out of time after ${report.subs.length} of ${focus.length} subcontractors`; break; }
      const docs = bySub.get(sub.id) || {};
      let expiry = null, confidence = 'none', parseError = null;
      let readVia = null, additionalInsured = null, insuredName = null, readNotes = null;
      let limitsOk = null, limits = null;

      if (docs.coiFile) {
        // Work coming up means the additional insured answer matters as much
        // as the date, and only the AI reader can see the ADDL INSD column.
        // Everyone else gets the cheap pass, which escalates on its own if it
        // cannot read the document.
        const r = await readCoiExpiry(docs.coiFile.id, gKey, docs.coiFile, {
          ai: upcoming.has(sub.id), force, cache, cacheOnly,
        });
        if (r.method === 'none' && !r.expiry) notRead++;
        expiry = r.expiry; confidence = r.confidence; parseError = r.error || null;
        readVia = r.method || null;
        additionalInsured = r.additionalInsured || null;
        insuredName = r.insuredName || null;
        readNotes = r.notes || null;
        limitsOk = r.limitsOk || null;
        limits = r.policies
          ? { eachOccurrence: r.policies.eachOccurrence ?? null, aggregate: r.policies.aggregate ?? null }
          : null;
        if (parseError) report.errors.push({ sub: sub.name, file: docs.coiFile.name, error: parseError });
      }

      const cs     = coiState(expiry, today, !!docs.coiFile);
      const hasW9  = !!docs.w9File;
      state.set(sub.id, { coiState: cs, coiExpiry: expiry, hasW9, additionalInsured, confidence, limitsOk, limits, readError: parseError });

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

      let wrote = false;
      if (changed && writes >= maxWrites) {
        writesDeferred++;
      } else if (changed) {
        writes++;
        const properties = {
          'Insurance on File': { checkbox: wantInsured },
          'W9 on File':        { checkbox: hasW9 },
        };
        if (expiry) properties['COI Expiration'] = { date: { start: expiry } };
        try {
          await patchSub(sub.id, token, properties);
          wrote = true;
        } catch (err) {
          report.errors.push({ sub: sub.name, error: `Notion writeback failed: ${err.message}` });
        }
      }

      report.subs.push({
        name: sub.name,
        coiState: cs,
        coiExpiry: expiry,
        confidence,
        // Which layer produced the answer. 'text' is the local PDF pass,
        // 'ai' is Claude, 'none' means nothing could read it.
        readVia,
        // Only the AI reader fills these in.
        insuredName,
        additionalInsured,
        readNotes,
        // The two questions worth answering when a state looks wrong: did a
        // file get matched at all, and if so could its expiry be read?
        coiFile: docs.coiFile ? docs.coiFile.name : null,
        coiParseError: parseError,
        w9File: docs.w9File ? docs.w9File.name : null,
        hasW9,
        email: sub.email || null,
        updated: wrote,
        writeDeferred: changed && !wrote,
      });
    }

    if (only) {
      // Keep unmatched files that plausibly relate to what is being asked
      // about, and drop the rest so the answer is readable.
      report.documents.unmatched = report.documents.unmatched.filter(u => u.file.toLowerCase().includes(only));
      report.errors = report.errors.filter(e => JSON.stringify(e).toLowerCase().includes(only));
    }

    report.documents.read = {
      withClaude: readsUsed(), budgetLeft: readsLeft(),
      // The number that says whether the background reader still has work to
      // do. Anything above zero means those certificates are sitting in Drive
      // unread, which is why they show as unreadable here.
      certificatesNotReadYet: notRead,
    };
    report.notionWrites = { written: writes, deferredToNextRun: writesDeferred, ceiling: maxWrites };
    report.elapsedMs = Date.now() - startedAt;

    if (syncOnly) {
      return { statusCode: 200, headers: corsH, body: JSON.stringify(report, null, 2) };
    }

    // ── 5. Decide and act, per sub with a problem on upcoming work ────────
    for (const [subId, job] of upcoming) {
      const sub = subs.find(s => s.id === subId);
      if (!sub) continue;

      // A narrowed run did not read this sub's documents, so it knows nothing
      // about them. Without this guard the default state below would read as
      // 'missing' and a diagnostic run on one subcontractor could email
      // seventy others to say we have no certificate for them.
      if (!focusIds.has(subId)) continue;

      const st = state.get(subId) || { coiState: 'missing', coiExpiry: null, hasW9: false };

      // 'unreadable' means we hold their certificate and could not read the
      // expiry. Emailing "we need a certificate of insurance" to someone who
      // sent one is the worst thing this system could do, so it never does.
      // It becomes a job for a person instead.
      if (st.coiState === 'unreadable') {
        report.actions.push({
          sub: sub.name, action: 'review',
          // The reason the reader gave is the useful part. A run that simply
          // ran out of budget is not a document anybody needs to open.
          reason: st.readError
            ? `a certificate is on file but the expiry could not be read: ${st.readError}`
            : 'a certificate is on file but its expiry could not be read automatically. Open it and set COI Expiration by hand.',
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

      // A current certificate that does not name Six Arrows as additionally
      // insured is a real exposure, and it is the one thing only the AI reader
      // can see. It does not send an email yet: the approved wording covers
      // missing and expired certificates, and telling a sub their certificate
      // is wrong on the strength of one read deserves a person's eyes first.
      // Current, correctly named, and still not acceptable: the limits are
      // short of what Six Arrows requires. Reported rather than emailed, for
      // the same reason as the additional insured case below.
      if (st.coiState === 'ok' && st.limitsOk === 'no') {
        const l = st.limits || {};
        report.actions.push({
          sub: sub.name, action: 'review',
          reason: `the certificate is current but the limits are short of the 1,000,000 each occurrence and 2,000,000 aggregate Six Arrows requires. It reads ${l.eachOccurrence ?? 'unknown'} each occurrence and ${l.aggregate ?? 'unknown'} aggregate.`,
          task: job.taskName, start: job.start,
        });
      }

      if (st.coiState === 'ok' && st.additionalInsured === 'no') {
        report.actions.push({
          sub: sub.name, action: 'review',
          reason: 'the certificate is current but the reader could not find Six Arrows listed as additionally insured. Confirm, then ask their agent for a corrected certificate.',
          task: job.taskName, start: job.start,
        });
      }

      // Every sub with work coming up gets the full AI read, so a low
      // confidence here is Claude saying it had to squint at the date. Calling
      // a certificate expired on a date nobody is sure of, and emailing the
      // sub about it, is the wrong way to be wrong. The W9 half of the ask is
      // held with it so they get one message rather than two.
      if (st.coiState === 'expired' && st.confidence === 'low') {
        report.actions.push({
          sub: sub.name, action: 'review',
          reason: `read as expiring ${st.coiExpiry}, but the reader was not confident of that date. Confirm it before this goes out.`,
          task: job.taskName, start: job.start,
        });
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
