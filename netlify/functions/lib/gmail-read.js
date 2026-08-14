// netlify/functions/lib/gmail-read.js
//
// Reading side of the Gmail integration. Sending lives in gmail.js and stays
// there; this is deliberately a separate file because it runs on a scope that
// grants far more than it uses.
//
// `gmail.readonly` is full inbox read access. Google publishes no narrower
// scope that can reach an attachment, so there was no smaller thing to ask for.
// What keeps this narrow is the code, and specifically the fact that every
// function here takes an explicit query or an explicit id. Nothing in this file
// browses. If a future caller wants to widen that, it has to write the query
// itself and the widening is visible in the diff.
//
// Cole files certificates into a Gmail label as they arrive so his inbox stays
// clear, and asked that both the label and the inbox be checked. Both are
// searched by explicit query, in the watcher, not here.

import { googleAccessToken } from './gmail.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function get(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // A 403 here is almost always the scope rather than the mailbox, and the
    // raw message says "Request had insufficient authentication scopes", which
    // sends people to the wrong place.
    const hint = res.status === 403
      ? ' (check inbox-watch?diag=1: the refresh token probably predates the gmail.readonly grant)'
      : '';
    throw new Error(`Gmail ${path.split('?')[0]}: ${res.status}${hint} ${body}`);
  }
  return res.json();
}

export async function listLabels() {
  const token = await googleAccessToken();
  const data = await get('/labels', token);
  return (data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type }));
}

// An explicit Gmail search string. Callers pass their own; this builds none.
export async function searchMessages(query, { max = 25 } = {}) {
  const token = await googleAccessToken();
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(max, 100)) });
  const data = await get(`/messages?${params}`, token);
  return (data.messages || []).map(m => ({ id: m.id, threadId: m.threadId }));
}

function header(payload, name) {
  const h = (payload?.headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

// Walks the MIME tree. A phone photo of a certificate arrives as a nested
// multipart with the image two or three levels down, so a shallow look at
// payload.parts finds nothing on exactly the messages that matter most.
function collectAttachments(part, out = []) {
  if (!part) return out;
  const id = part.body?.attachmentId;
  if (id && part.filename) {
    out.push({
      attachmentId: id,
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      size: part.body?.size || 0,
    });
  }
  for (const p of part.parts || []) collectAttachments(p, out);
  return out;
}

// Plain text body, for reading what a sub actually wrote back. Falls back to
// stripping the HTML part, because plenty of people reply from a phone and
// never send a text alternative.
function bodyText(part, found = { text: null, html: null }) {
  if (!part) return found;
  const data = part.body?.data;
  if (data) {
    if (part.mimeType === 'text/plain' && !found.text) found.text = decodeB64(data).toString('utf8');
    if (part.mimeType === 'text/html'  && !found.html) found.html = decodeB64(data).toString('utf8');
  }
  for (const p of part.parts || []) bodyText(p, found);
  return found;
}

function decodeB64(s) {
  return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// An address line is "Ray Goodnight <ray@example.com>" or bare. Both halves are
// useful: the display name matches a subcontractor row, the address matches the
// one we emailed.
export function parseAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: s.toLowerCase() || null };
}

export async function getMessage(id) {
  const token = await googleAccessToken();
  const msg = await get(`/messages/${id}?format=full`, token);
  const p = msg.payload;
  const body = bodyText(p);
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    from:    parseAddress(header(p, 'From')),
    to:      header(p, 'To'),
    subject: header(p, 'Subject'),
    snippet: msg.snippet || null,
    text:    body.text || (body.html ? stripHtml(body.html) : null),
    attachments: collectAttachments(p),
  };
}

export async function getAttachment(messageId, attachmentId) {
  const token = await googleAccessToken();
  const data = await get(`/messages/${messageId}/attachments/${attachmentId}`, token);
  return new Uint8Array(decodeB64(data.data));
}

// What could plausibly be a certificate or a W9. Everything else in a reply is
// a signature logo, and downloading those wastes the run's time budget.
const DOCUMENT_TYPES = /^(application\/pdf|image\/(jpeg|png|heic|heif|tiff))$/i;
const DOCUMENT_EXT   = /\.(pdf|jpe?g|png|heic|heif|tiff?)$/i;

// A tracking pixel and a logo are both images. Nobody's certificate is 8 KB.
const MIN_DOCUMENT_BYTES = 20_000;

export function looksLikeDocument(att) {
  if (!att) return false;
  if (!DOCUMENT_TYPES.test(att.mimeType) && !DOCUMENT_EXT.test(att.filename || '')) return false;
  return (att.size || 0) >= MIN_DOCUMENT_BYTES;
}
