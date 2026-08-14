// netlify/functions/inbox-watch.js
//
// Closes the loop on a compliance request: reads the reply, files the document,
// and updates Notion.
//
//   GET /                     find and file everything new (dry run)
//   GET /?apply=1             actually upload to Drive and record it
//   GET /?max=25              how many messages to look at
//   GET /?days=30             how far back to search
//   GET /?diag=1              what the Google token can actually do
//   GET /?diag=1&labels=1     list Gmail labels
//   GET /?diag=1&q=<search>   preview messages a query would reach
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
import { uploadToFolder, documentName } from './lib/drive-upload.js';
import { documentKind, matchDocument, explainMatch } from './lib/inbox-match.js';
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

  // Labels and a sample search, so the watcher can be built against what is
  // actually in the mailbox rather than against a guess at the label name.
  // Reads envelopes only: no attachment is downloaded here.
  let labels = null, sample = null, sampleError = null;
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

// Everything already filed, in one query. A lookup per attachment would be a
// round trip each, which is the mistake the compliance sweep already made once.
async function loadSeen() {
  try {
    const rows = await supabase('inbox_documents', {
      select: 'message_id,attachment_id,uploaded',
      order: 'created_at.desc',
      limit: 2000,
    });
    const seen = new Set();
    for (const r of rows) if (r.uploaded) seen.add(`${r.message_id}|${r.attachment_id}`);
    return { seen, error: null };
  } catch (err) {
    return { seen: null, error: err.message };
  }
}

async function runWatcher(q) {
  const apply = q.apply === '1';
  const days  = Math.min(Math.max(Number(q.days) || DEFAULT_DAYS, 1), 365);
  const max   = Math.min(Number(q.max) || DEFAULT_MAX, 50);
  const token = process.env.NOTION_TOKEN;
  const started = Date.now();

  const report = {
    generatedAt: new Date().toISOString(),
    applied: apply,
    searchedBack: `${days} days`,
    searched: QUERIES(days).map(x => x.why),
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

    const docs = msg.attachments.filter(looksLikeDocument);
    if (!docs.length) continue;

    const match = matchDocument({ message: msg, threadsBySub, subs });

    for (const att of docs) {
      report.found++;
      const key = `${msg.id}|${att.attachmentId}`;
      if (seenRes.seen.has(key)) { report.alreadyFiled++; continue; }

      const kind = documentKind({ filename: att.filename, subject: msg.subject, body: msg.text });
      const entry = {
        from: msg.from, subject: msg.subject, receivedAt: msg.internalDate,
        attachment: att.filename, sizeBytes: att.size,
        kind,
        sub: match.subName, matchedVia: match.via, confidence: match.confidence,
        why: explainMatch(match, msg),
        willFileAs: documentName({ subName: match.subName, kind, receivedOn: msg.internalDate, sourceName: att.filename }),
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
        report.documents.push(entry);
        report.skipped++;
        continue;
      }

      try {
        const bytes  = await getAttachment(msg.id, att.attachmentId);
        const folder = kind === 'w9' ? W9_FOLDER_ID : COI_FOLDER_ID;
        const up = await uploadToFolder({
          bytes, name: entry.willFileAs, mimeType: att.mimeType, folderId: folder,
        });
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
  report.next = apply
    ? 'Filed documents are in Drive. Run compliance-sweep to read them and update Notion.'
    : 'Dry run. Nothing downloaded, uploaded or recorded. Add apply=1 to file these.';
  return report;
}
