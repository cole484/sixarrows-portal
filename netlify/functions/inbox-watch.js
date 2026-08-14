// netlify/functions/inbox-watch.js
//
// Closes the loop on a compliance request: reads the reply, files the document,
// and updates Notion.
//
// Right now this is the diagnostic half only. The watcher itself is not built,
// because it cannot be until the Gmail token carries scopes it does not
// currently have. Shipping the check first means the re-authorization can be
// confirmed in one call rather than by running a real sweep and reading the
// failure.
//
//   GET /?diag=1     what the token can actually do
//
// What the watcher will do once the scopes are there, and the constraint that
// shapes it: every compliance email we send records its gmail_thread_id, so
// this reads THOSE THREADS BY ID. It never searches the mailbox and never opens
// a thread Six Arrows did not start. gmail.readonly grants far more than that;
// the narrowness lives in this code, which is the reason it is written down
// here rather than left as an intention.

import { gmailConfigured, tokenScopes, senderAddress } from './lib/gmail.js';
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
    note: 'Diagnostic only. This reads no mail, uploads nothing, and changes nothing.',
  });
};
