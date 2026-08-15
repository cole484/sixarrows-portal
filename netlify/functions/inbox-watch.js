// netlify/functions/inbox-watch.js
//
// Closes the loop on a compliance request: reads the reply, files the document,
// and updates Notion.
//
//   GET /                     find and file everything new (dry run)
//   GET /?apply=1             actually upload to Drive and record it
//   GET /?max=25              how many messages to look at
//   GET /?days=30             how far back to search
//   GET /?only=<text>         only attachments whose filename contains this
//   GET /?force=1             ignore what has already been filed and redo it
//   GET /?diag=1              what the Google token can actually do
//   GET /?diag=1&labels=1     list Gmail labels
//   GET /?diag=1&q=<search>   preview messages a query would reach
//   GET /?diag=1&agents=1     open every certificate in the label and report
//                             the issuing agency, so the addresses the
//                             verification and correction emails need can be
//                             checked before anything is sent to them
//
// Dry run is the default, deliberately. A run with apply unset downloads
// nothing, uploads nothing and writes nothing: it reports what it would file
// and under whose name, which is the thing worth checking before a certificate
// lands in the wrong sub's folder.
//
// On how much of the mailbox this touches. The original plan was to read only
// the threads Six Arrows started, by their recorded gmail_thread_id, and never
// to search at all. Cole changed that deliberately: he files certificates into
// a Gmail label as they arrive so his inbox stays clear, and asked that both
// the label and the inbox be checked. A sub who forwards a certificate from
// their agent, or replies from a different address, never lands in the original
// thread, so thread ids alone would have missed exactly the documents this
// exists to catch.
//
// So it searches, and the searches are narrow and written down: a specific
// label, or the inbox with an attachment filter and a date floor. gmail.readonly
// grants the whole mailbox; what this actually reads is bounded by the queries
// in QUERIES below, and widening them is a visible change rather than a quiet
// one.

import { gmailConfigured, tokenScopes, senderAddress } from './lib/gmail.js';
import { listLabels, searchMessages, getMessage, getAttachment, looksLikeDocument } from './lib/gmail-read.js';
import { uploadToFolder, documentName, deleteOwnFile } from './lib/drive-upload.js';
import { documentKind, matchDocument, explainMatch, identifyFromDocument } from './lib/inbox-match.js';
import { certificateRow, w9Row, putRead } from './lib/doc-cache.js';
import { setReadBudget, anthropicConfigured, readCertificate } from './lib/doc-ai.js';
import { COI_FOLDER_ID, W9_FOLDER_ID } from './lib/compliance-docs.js';
import { supabase, corsHeaders } from './lib/supabase-client.js';

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const SUBS_DB_ID     = '1944737b-ea6f-8086-8f45-f6b479ed36bb';

// The two places a certificate can be. Cole files them into the label as they
// arrive so his inbox stays clear, but a document that has only just landed is
// still sitting in the inbox, so both are searched.
//
// These are the entire footprint of gmail.readonly in this system. Widening
// them widens what the agent reads, and that should be a visible change.
const QUERIES = days => [
  { why: 'the COI & W9 label', q: `label:"COI & W9" has:attachment newer_than:${days}d` },
  { why: 'the inbox',          q: `in:inbox has:attachment newer_than:${days}d (coi OR "certificate of insurance" OR acord OR w-9 OR w9 OR insurance)` },
];

const DEFAULT_DAYS = 30;
const DEFAULT_MAX  = 25;
const BUDGET_MS    = 22_000;

// What the whole loop needs. Checked by name rather than counted, because
// "three scopes" being true says nothing about whether they are the right ones.
export const REQUIRED_SCOPES = {
  'https://www.googleapis.com/auth/gmail.send':     'send the requests and the correction replies',
  'https://www.googleapis.com/auth/gmail.readonly': 'read replies and pull down the attached certificate',
  'https://www.googleapis.com/auth/drive.file':     'upload that certificate into the COI and W9 folders',
};

// gmail.modify and the full drive scope are supersets. Accepting them means a
// broader grant than asked for still works rather than reporting a false
// failure, which would send somebody re-authorizing for no reason.
const SUPERSETS = {
  'https://www.googleapis.com/auth/gmail.readonly': [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://mail.google.com/',
  ],
  'https://www.googleapis.com/auth/gmail.send': [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://mail.google.com/',
  ],
  'https://www.googleapis.com/auth/drive.file': [
    'https://www.googleapis.com/auth/drive',
  ],
};

export function checkScopes(granted = []) {
  const have = new Set(granted);
  const rows = Object.entries(REQUIRED_SCOPES).map(([scope, why]) => {
    const via = have.has(scope)
      ? scope
      : (SUPERSETS[scope] || []).find(s => have.has(s)) || null;
    return { scope, why, ok: !!via, grantedAs: via };
  });
  return { rows, ok: rows.every(r => r.ok), missing: rows.filter(r => !r.ok).map(r => r.scope) };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };

  const q = event.queryStringParameters || {};

  const reply = (code, body) => ({
    statusCode: code,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  });

  if (!gmailConfigured()) {
    return reply(500, {
      error: 'GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN are not all set.',
      fix: 'See docs/gmail-setup.md.',
    });
  }

  let granted;
  try {
    granted = await tokenScopes();
  } catch (err) {
    return reply(500, {
      error: err.message,
      fix: 'The refresh token could not be exchanged at all. docs/gmail-setup.md, the "If it stops working" section.',
    });
  }

  const { rows, ok, missing } = checkScopes(granted);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  // Undoes duplicate uploads. Needed once because the first dedupe key was the
  // Gmail attachmentId, which is an opaque per-request token rather than an
  // identifier: the same file came back with a different id on every fetch, so
  // nothing ever matched and a second run filed everything twice.
  //
  // Kept afterwards because the failure it repairs is one an agent with write
  // access can always make again, and cleaning it up by hand across two Drive
  // folders is exactly the sort of job nobody does.
  if (q.cleanupDuplicates === '1') {
    if (!ok) return reply(500, { error: 'drive.file is not granted, so nothing can be deleted.' });
    return reply(200, await cleanupDuplicates(q.apply === '1'));
  }

  // ── The watcher ─────────────────────────────────────────────────────────
  if (!q.diag) {
    if (!ok) {
      return reply(500, {
        error: `Cannot read the mailbox: missing ${missing.join(', ')}.`,
        fix: 'docs/gmail-setup.md, step 5, with all three scopes.',
      });
    }
    return reply(200, await runWatcher(q));
  }

  // Who issued each certificate. Reads the documents straight from the mail
  // rather than through Drive and the read cache, because the question here is
  // what is printed on the page and a cached answer from before the reader
  // learned to look for a producer would not have it.
  if (ok && q.agents === '1') {
    setReadBudget(Math.min(Number(q.readLimit) || 10, 20));
    const out = [];
    try {
      const seen = new Set();
      for (const { q: query } of QUERIES(Math.min(Number(q.days) || 30, 365))) {
        for (const m of await searchMessages(query, { max: 25 })) seen.add(m.id);
      }
      for (const id of seen) {
        const msg = await getMessage(id);
        for (const att of msg.attachments.filter(looksLikeDocument)) {
          const kind = documentKind({ filename: att.filename, subject: msg.subject, body: msg.text });
          if (kind === 'w9') continue;                 // a W9 names no agency
          const bytes = await getAttachment(msg.id, att.attachmentId);
          const r = await readCertificate({ bytes, file: { name: att.filename, mimeType: att.mimeType } });
          out.push({
            emailedBy: msg.from?.email || null,
            file: att.filename,
            insured: r.insuredName,
            agency: r.producer?.name || null,
            agencyContact: r.producer?.contact || null,
            agencyEmail: r.producer?.email || null,
            agencyPhone: r.producer?.phone || null,
            generalLiabilityExpires: r.policies?.generalLiability || null,
            workersCompExpires: r.policies?.workersComp || null,
            eachOccurrence: r.policies?.eachOccurrence ?? null,
            aggregate: r.policies?.aggregate ?? null,
            additionalInsured: r.additionalInsured,
            error: r.error || null,
          });
        }
      }
    } catch (err) { sampleError = err.message; }
    agents = out;
  }

  // Labels and a sample search, so the watcher can be built against what is
  // actually in the mailbox rather than against a guess at the label name.
  // Reads envelopes only: no attachment is downloaded here.
  let labels = null, sample = null, sampleError = null, agents = null;
  if (ok && q.labels === '1') {
    try { labels = await listLabels(); }
    catch (err) { sampleError = err.message; }
  }
  if (ok && q.q) {
    try {
      const hits = await searchMessages(q.q, { max: Math.min(Number(q.max) || 10, 25) });
      sample = [];
      for (const h of hits) {
        const m = await getMessage(h.id);
        sample.push({
          from: m.from, subject: m.subject, on: m.internalDate, labelIds: m.labelIds,
          attachments: m.attachments.map(a => ({
            filename: a.filename, mimeType: a.mimeType, size: a.size,
            wouldRead: looksLikeDocument(a),
          })),
        });
      }
    } catch (err) { sampleError = err.message; }
  }

  return reply(200, {
    sender: senderAddress(),
    ready: ok,
    // The whole point of this endpoint: say plainly which of the three are
    // present, so a re-authorization is confirmed rather than assumed.
    scopes: rows.map(r => ({
      needed: r.scope.replace('https://www.googleapis.com/auth/', ''),
      for:    r.why,
      status: r.ok ? (r.grantedAs === r.scope ? 'granted' : `granted via ${r.grantedAs}`) : 'MISSING',
    })),
    granted,
    next: ok
      ? 'All three scopes are present. The watcher can be built against this token.'
      : `Still missing ${missing.length} scope(s). Redo step 5 of docs/gmail-setup.md with all three in the scopes box, then replace GMAIL_REFRESH_TOKEN in Netlify.`,
    labels,
    agents,
    sample,
    sampleError,
    note: q.q
      ? 'Diagnostic. Envelopes and attachment names only, nothing downloaded, nothing changed.'
      : 'Diagnostic only. Pass labels=1 to list Gmail labels, or q=<gmail search> to preview matching messages.',
  });
};

// ── The watcher ───────────────────────────────────────────────────────────
function nHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
}

function nprop(page, name) {
  const p = page?.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':  return p.title?.map(t => t.plain_text).join('').trim() || null;
    case 'select': return p.select?.name || null;
    case 'email':  return p.email || null;
    default:       return null;
  }
}

async function loadSubs(token) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${SUBS_DB_ID}/query`, {
      method: 'POST', headers: nHeaders(token), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Notion subs query: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return out
    .map(p => ({ id: p.id, name: nprop(p, 'Subcontractor Name'), email: nprop(p, 'Email') }))
    .filter(s => s.name);
}

// Which subcontractor each compliance email went to, keyed by its Gmail thread.
// This is the only link between a message and a sub that involves no guessing.
async function loadThreadOwners() {
  const map = new Map();
  try {
    const rows = await supabase('compliance_requests', {
      select: 'gmail_thread_id,sub_id,sub_name',
      order: 'created_at.desc',
      limit: 1000,
    });
    for (const r of rows) {
      if (r.gmail_thread_id && !map.has(r.gmail_thread_id)) {
        map.set(r.gmail_thread_id, { subId: r.sub_id, subName: r.sub_name });
      }
    }
  } catch (err) {
    // Not fatal. Losing this drops the strongest match route and the other
    // three still work, so say so rather than stopping.
    console.error('inbox-watch: could not read compliance_requests:', err.message);
  }
  return map;
}

// What identifies an attachment across two runs.
//
// NOT the Gmail attachmentId, which was the first attempt and was wrong. That
// id is an opaque per-request token: fetching the same message twice returns
// two different ones for the same file. Keyed on it, nothing ever matched, the
// watcher believed it had never seen anything, and a second run uploaded a
// duplicate of all five documents into the COI folder.
//
// The message id, the filename and the byte count are all properties of the
// mail itself and do not move.
export function attachmentKey(messageId, filename, size) {
  return `${messageId}|${filename || ''}|${size || 0}`;
}

// Everything already filed, in one query. A lookup per attachment would be a
// round trip each, which is the mistake the compliance sweep already made once.
async function loadSeen() {
  try {
    const rows = await supabase('inbox_documents', {
      select: 'message_id,source_filename,size_bytes,uploaded',
      order: 'created_at.desc',
      limit: 2000,
    });
    const seen = new Set();
    for (const r of rows) {
      if (r.uploaded) seen.add(attachmentKey(r.message_id, r.source_filename, r.size_bytes));
    }
    return { seen, error: null };
  } catch (err) {
    return { seen: null, error: err.message };
  }
}

async function runWatcher(q) {
  const apply = q.apply === '1';
  // Reading a document to identify it costs a Claude call, so a run is capped.
  // Four of five documents are identified from the envelope and never reach it.
  setReadBudget(Math.min(Number(q.readLimit) || 6, 20));
  const days  = Math.min(Math.max(Number(q.days) || DEFAULT_DAYS, 1), 365);
  // force redoes work already done, which means uploading a second copy of
  // anything still in Drive. Paired with only= it is how a single document gets
  // reprocessed after a fix; used alone with apply it duplicates everything, so
  // the report says so rather than leaving it to be discovered.
  const force = q.force === '1';
  const only  = String(q.only || '').toLowerCase();
  const max   = Math.min(Number(q.max) || DEFAULT_MAX, 50);
  const token = process.env.NOTION_TOKEN;
  const started = Date.now();

  const report = {
    generatedAt: new Date().toISOString(),
    applied: apply,
    searchedBack: `${days} days`,
    searched: QUERIES(days).map(x => x.why),
    only: only || null,
    forced: force,
    found: 0, alreadyFiled: 0, filed: 0, skipped: 0,
    documents: [], errors: [], truncated: false,
  };

  if (!token) { report.errors.push({ error: 'NOTION_TOKEN is not set, so subcontractors cannot be matched.' }); return report; }

  const [subs, threadsBySub, seenRes] = await Promise.all([
    loadSubs(token), loadThreadOwners(), loadSeen(),
  ]);

  if (seenRes.error) {
    // Without this the watcher cannot know what it has already filed, and every
    // run would upload another copy of every certificate. Stop rather than
    // make a mess that has to be cleaned up by hand.
    report.errors.push({
      error: `inbox_documents could not be read: ${seenRes.error}`,
      fix: 'Run supabase/add-inbox-documents.sql. Refusing to file anything until then, because without it every run would upload another copy of every document.',
    });
    return report;
  }

  // One id set, because the same message reaches us through the label query and
  // the inbox query both.
  const messageIds = new Map();
  for (const { q: query } of QUERIES(days)) {
    try {
      for (const m of await searchMessages(query, { max })) messageIds.set(m.id, m);
    } catch (err) {
      report.errors.push({ query, error: err.message });
    }
  }

  for (const [id] of messageIds) {
    if (Date.now() - started > BUDGET_MS) { report.truncated = true; break; }

    let msg;
    try { msg = await getMessage(id); }
    catch (err) { report.errors.push({ messageId: id, error: err.message }); continue; }

    const docs = msg.attachments
      .filter(looksLikeDocument)
      .filter(a => !only || String(a.filename || '').toLowerCase().includes(only));
    if (!docs.length) continue;

    let match = matchDocument({ message: msg, threadsBySub, subs });

    for (const att of docs) {
      report.found++;
      const key = attachmentKey(msg.id, att.filename, att.size);
      if (!force && seenRes.seen.has(key)) { report.alreadyFiled++; continue; }

      const kind = documentKind({ filename: att.filename, subject: msg.subject, body: msg.text });
      const entry = {
        from: msg.from, subject: msg.subject, receivedAt: msg.internalDate,
        attachment: att.filename, sizeBytes: att.size,
        kind,
        sub: match.subName, matchedVia: match.via, confidence: match.confidence,
        why: explainMatch(match, msg),
        willFileAs: documentName({ subName: match.subName, kind, receivedOn: msg.internalDate, sourceName: att.filename, fromEmail: msg.from?.email }),
        uploaded: false,
      };

      // An unmatched document is still worth filing: the compliance sweep's
      // rematch pass reads the insured name out of the document itself and
      // fixes the name later. Leaving it in the inbox is the one outcome that
      // helps nobody.
      if (!match.subName) entry.note = 'Filed under "Unmatched". The compliance sweep with rematch=1 reads the insured name out of the document and links it.';

      if (!apply) {
        entry.uploaded = false;
        entry.dryRun = true;
        if (!match.subName) entry.willFileAs = '(decided after reading the document)';
        report.documents.push(entry);
        report.skipped++;
        continue;
      }

      try {
        const bytes  = await getAttachment(msg.id, att.attachmentId);

        // Cole: it has to open the attachment and read it to pull out the
        // information, then upload it labelled correctly. Only reached when the
        // envelope said nothing, which is where the agency and carrier emails
        // land and where the envelope can never help.
        if (!match.subId && anthropicConfigured()) {
          const fromDoc = await identifyFromDocument({
            bytes, filename: att.filename, mimeType: att.mimeType, kind, subs,
          });
          entry.readInsuredAs = fromDoc.readAs || null;
          if (fromDoc.readError) entry.readError = fromDoc.readError;
          if (fromDoc.subId) {
            match = fromDoc;
            entry.sub        = fromDoc.subName;
            entry.matchedVia = 'document';
            entry.confidence = fromDoc.confidence;
            entry.why        = `read off the document itself, which names the insured as "${fromDoc.readAs}"`;
            delete entry.note;
          } else if (fromDoc.readAs) {
            entry.note = `The document names "${fromDoc.readAs}", which matches no row in the Subcontractors database. Filed under "Unmatched" and worth a look: either the row is missing or the name differs.`;
          }
          // The read is kept so the compliance sweep does not pay for it twice.
          entry.docRead = fromDoc.read || null;
        }

        // Computed after the read, so an identified document lands under the
        // right name the first time rather than being relabelled later.
        entry.willFileAs = documentName({
          subName: match.subName, kind, receivedOn: msg.internalDate,
          sourceName: att.filename, fromEmail: msg.from?.email,
        });

        const folder = kind === 'w9' ? W9_FOLDER_ID : COI_FOLDER_ID;
        const up = await uploadToFolder({
          bytes, name: entry.willFileAs, mimeType: att.mimeType, folderId: folder,
        });

        // Hand the read to the document cache under the Drive id it now has, so
        // the sweep reads it from cache rather than opening it again. The cache
        // is keyed on Drive file id plus modifiedTime, both of which only exist
        // once the upload has happened.
        if (entry.docRead && up.id) {
          const f = { id: up.id, name: up.name, modifiedTime: up.modifiedTime || '' };
          try {
            await putRead(kind === 'w9' ? w9Row(f, entry.docRead) : certificateRow(f, entry.docRead));
          } catch { /* a missed cache costs one re-read, nothing more */ }
        }
        entry.uploaded      = true;
        entry.driveFileId   = up.id;
        entry.driveFileName = up.name;
        report.filed++;

        await supabase('inbox_documents', { method: 'POST', body: {
          message_id: msg.id, thread_id: msg.threadId, attachment_id: att.attachmentId,
          from_email: msg.from?.email || null, from_name: msg.from?.name || null,
          subject: msg.subject, received_at: msg.internalDate,
          source_filename: att.filename, mime_type: att.mimeType, size_bytes: att.size,
          kind, sub_id: match.subId, sub_name: match.subName,
          matched_via: match.via, match_confidence: match.confidence,
          drive_file_id: up.id, drive_file_name: up.name, drive_folder_id: folder,
          uploaded: true,
        } });
        // Rewritten after the possible document read, so the row records who it
        // actually belongs to rather than who the envelope guessed.
        entry.sub = match.subName;
      } catch (err) {
        entry.error = err.message;
        report.errors.push({ attachment: att.filename, from: msg.from?.email, error: err.message });
        // Recorded as not uploaded, so the next run tries again rather than
        // treating a failure as done.
        try {
          await supabase('inbox_documents', { method: 'POST', body: {
            message_id: msg.id, thread_id: msg.threadId, attachment_id: att.attachmentId,
            from_email: msg.from?.email || null, subject: msg.subject,
            source_filename: att.filename, kind, sub_id: match.subId, sub_name: match.subName,
            matched_via: match.via, uploaded: false, error: err.message,
          } });
        } catch { /* the report already carries it */ }
      }

      report.documents.push(entry);
    }
  }

  report.elapsedMs = Date.now() - started;
  if (force && apply) {
    report.warning = 'force ignores what was already filed, so anything still in Drive now has a second copy. Run cleanupDuplicates=1 to check.';
  }
  report.next = apply
    ? 'Filed documents are in Drive. Run compliance-sweep to read them and update Notion.'
    : 'Dry run. Nothing downloaded, uploaded or recorded. Add apply=1 to file these.';
  return report;
}

// One document, uploaded more than once. Keeps the earliest copy and removes
// the rest, because the earliest is the one anything else may already point at.
async function cleanupDuplicates(apply) {
  const report = { applied: apply, groups: 0, duplicates: 0, deleted: 0, kept: [], removed: [], errors: [] };

  let rows;
  try {
    rows = await supabase('inbox_documents', {
      select: 'id,created_at,message_id,source_filename,size_bytes,drive_file_id,drive_file_name,uploaded',
      order: 'created_at.asc',
      limit: 2000,
    });
  } catch (err) {
    report.errors.push({ error: `could not read inbox_documents: ${err.message}` });
    return report;
  }

  const byKey = new Map();
  for (const r of rows) {
    if (!r.uploaded || !r.drive_file_id) continue;
    const k = attachmentKey(r.message_id, r.source_filename, r.size_bytes);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    report.groups++;
    // The NEWEST is kept, not the oldest, and that took getting wrong once to
    // see. Two copies of one document arise two ways: an accidental re-upload,
    // where both are identical and it makes no difference which survives, and a
    // reprocess after a fix, where the newer one carries the better name. An
    // "Unmatched" file superseded by one named for the sub who actually owns it
    // is the second case, and keeping the older copy would have thrown away the
    // correction.
    const ordered = [...group].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const [keep, ...extra] = ordered;
    report.kept.push({ file: keep.drive_file_name, driveFileId: keep.drive_file_id, uploadedAt: keep.created_at });

    for (const dup of extra) {
      report.duplicates++;
      if (!apply) { report.removed.push({ file: dup.drive_file_name, driveFileId: dup.drive_file_id, dryRun: true }); continue; }
      try {
        await deleteOwnFile(dup.drive_file_id);
        report.deleted++;
        report.removed.push({ file: dup.drive_file_name, driveFileId: dup.drive_file_id, deleted: true });
        // The row stays. The table is append-only and it is a true record of
        // what happened, including the mistake. A new row records the removal.
        await supabase('inbox_documents', { method: 'POST', body: {
          message_id: dup.message_id, attachment_id: 'deleted-duplicate',
          source_filename: dup.source_filename, size_bytes: dup.size_bytes,
          drive_file_id: dup.drive_file_id, drive_file_name: dup.drive_file_name,
          uploaded: false, error: `duplicate upload removed, superseded by ${keep.drive_file_id}`,
        } });
      } catch (err) {
        report.errors.push({ driveFileId: dup.drive_file_id, error: err.message });
      }
    }
  }

  report.next = apply
    ? `Removed ${report.deleted} duplicate file(s).`
    : `Dry run. ${report.duplicates} duplicate(s) found across ${report.groups} document(s). Add apply=1 to delete them.`;
  return report;
}
