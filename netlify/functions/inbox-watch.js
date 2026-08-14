// netlify/functions/inbox-watch.js
//
// Closes the loop on a compliance request: reads the reply, files the document,
// and updates Notion.
//
//   GET /?diag=1              what the Google token can actually do
//   GET /?diag=1&labels=1     list Gmail labels
//   GET /?diag=1&q=<search>   preview messages a query would reach
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
import { listLabels, searchMessages, getMessage, looksLikeDocument } from './lib/gmail-read.js';
import { corsHeaders } from './lib/supabase-client.js';

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
