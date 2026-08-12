// netlify/functions/lib/gmail.js
//
// Sends mail as cole@sixarrowsconstruction.com through the Gmail API, so
// outbound compliance requests come from a real Six Arrows address, land in
// Cole's Sent folder, and replies come straight back to his inbox.
//
// Auth is OAuth2 with a stored refresh token. A refresh token is exchanged for
// a short-lived access token on each run; nothing long-lived is held in memory.
//
// Required env:
//   GMAIL_CLIENT_ID       from the Google Cloud OAuth client
//   GMAIL_CLIENT_SECRET   same
//   GMAIL_REFRESH_TOKEN   from the one-time consent flow, see docs/gmail-setup.md
// Optional env:
//   GMAIL_SENDER          defaults to cole@sixarrowsconstruction.com
//
// Gmail API pricing is free. The daily quota is far above anything this will
// use: sending costs 100 quota units against a 1,000,000,000 unit daily budget.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const DEFAULT_SENDER = 'cole@sixarrowsconstruction.com';

export function gmailConfigured() {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

export function senderAddress() {
  return process.env.GMAIL_SENDER || DEFAULT_SENDER;
}

async function accessToken() {
  const body = new URLSearchParams({
    client_id:     process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type:    'refresh_token',
  });

  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    // invalid_grant almost always means the refresh token was revoked or the
    // OAuth app is still in Testing mode, where Google expires them after 7
    // days. Say so, because the raw error is not self-explanatory.
    const hint = data.error === 'invalid_grant'
      ? ' (refresh token revoked or expired. If the OAuth consent screen is still in Testing, publish it or set User Type to Internal, then re-run the consent flow.)'
      : '';
    throw new Error(`Gmail token exchange failed: ${data.error || res.status}${hint}`);
  }
  return data.access_token;
}

// RFC 2822 headers must be ASCII. Anything outside that gets MIME-encoded so a
// sub's name with an accent does not corrupt the subject line.
function encodeHeader(value) {
  const s = String(value);
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function buildRaw({ to, from, subject, body, replyTo, cc }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc      ? `Cc: ${cc}`            : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  const message = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(body, 'utf8').toString('base64')}`;

  // Gmail wants base64url, unpadded.
  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Sends one message. Returns Gmail's message id and thread id so a follow-up
// can be threaded onto the original request rather than starting a new one.
export async function sendGmail({ to, subject, body, replyTo, cc, threadId }) {
  if (!gmailConfigured()) throw new Error('Gmail is not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)');
  if (!to)      throw new Error('sendGmail: `to` is required');
  if (!subject) throw new Error('sendGmail: `subject` is required');
  if (!body)    throw new Error('sendGmail: `body` is required');

  const from  = `Six Arrows Construction <${senderAddress()}>`;
  const raw   = buildRaw({ to, from, subject, body, replyTo, cc });
  const token = await accessToken();

  const payload = { raw };
  if (threadId) payload.threadId = threadId;

  const res  = await fetch(SEND_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Gmail send to ${to} failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { id: data.id, threadId: data.threadId, to };
}
