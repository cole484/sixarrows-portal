// netlify/functions/lib/drive-upload.js
//
// Puts a document into the COI or W9 folder, under a name the existing matcher
// can already find.
//
// Runs on OAuth, not on the API key the rest of the Drive code uses. The key
// can read a link-shared folder and cannot write anything, which is why filing
// a certificate needed a re-authorization rather than a config change.
//
// The scope is `drive.file`: this can only touch files it created itself. It
// cannot read the rest of the Drive, and it cannot modify a file somebody
// uploaded by hand. That is a deliberate limit and it has one consequence worth
// knowing: replacing a certificate a person put there is not possible, so a
// newer one is uploaded alongside and wins on modification time, which is how
// the matcher already picks between two files for the same sub.

import { googleAccessToken } from './gmail.js';

const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES  = 'https://www.googleapis.com/drive/v3/files';

// The naming convention the compliance matcher already reads. It matches on the
// subcontractor's name, so the vendor goes first and the rest is noise it
// already knows to strip.
//
// The date suffix exists because drive.file cannot overwrite, so a second
// certificate for the same sub has to sit beside the first rather than replace
// it. Without the date they would be "Artisan Electrical.pdf" and "Artisan
// Electrical (1).pdf", and the second tells nobody anything.
// Where the document came from, as one word, appended to every filename.
//
// This started as a tiebreaker for unmatched documents and became general once
// the first real batch showed why. Home Pro Pest Control sent two certificates
// on the same day: general liability from their agency, workers compensation
// from KEMI. Both are theirs, both are correct, and both wanted the identical
// filename. That is not an edge case; a sub carrying GL and WC from different
// carriers is the normal arrangement, and Six Arrows judges the controlling
// expiry as the earlier of the two, so losing one gets the answer wrong.
//
// Consumer mail domains are skipped because they identify nothing. A sub
// replying from gmail gets a clean name; a certificate from an agency carries
// the agency's name, which is the useful thing to see in a folder listing.
const NO_TAG = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|comcast|att|verizon|bellsouth|charter|twc|windstream)$/i;

function senderTag(fromEmail) {
  const domain = String(fromEmail || '').split('@')[1] || '';
  const label = domain.split('.').filter(p => !/^(com|net|org|co|us|inc)$/i.test(p)).pop() || '';
  if (NO_TAG.test(label)) return '';
  return label.replace(/[^a-z0-9]/gi, '').slice(0, 20);
}

export function documentName({ subName, kind, receivedOn, sourceName, fromEmail }) {
  const clean = String(subName || 'Unmatched')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = (String(sourceName || '').match(/\.([a-z0-9]{2,5})$/i) || [, 'pdf'])[1].toLowerCase();
  const day = String(receivedOn || '').slice(0, 10) || 'undated';
  const tag = senderTag(fromEmail) ? ` ${senderTag(fromEmail)}` : '';
  return `${clean} ${kind === 'w9' ? 'W9' : 'COI'} ${day}${tag}.${ext}`;
}

// Multipart upload: metadata and bytes in one request. Simple upload cannot
// set a parent folder, and resumable is for files far larger than a
// certificate, so multipart is the right middle.
export async function uploadToFolder({ bytes, name, mimeType, folderId }) {
  if (!folderId) throw new Error('uploadToFolder: no folderId');
  const token = await googleAccessToken();

  const boundary = 'sixarrows' + Math.abs(bytes.length * 2654435761 % 1e12).toString(36);
  const meta = JSON.stringify({ name, parents: [folderId] });

  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);

  const res = await fetch(`${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    // The two failures worth naming, because both read as generic permission
    // errors and have completely different fixes.
    const hint = /insufficient|scope/i.test(text)
      ? ' (the refresh token predates the drive.file grant: see inbox-watch?diag=1)'
      : /notFound|File not found/i.test(text)
        ? ' (drive.file can only write into a folder it has been given the id of, and cannot see folders it did not create. If this keeps failing, the folder may need sharing with the account, or the full drive scope.)'
        : '';
    throw new Error(`Drive upload "${name}": ${res.status}${hint} ${text}`);
  }
  return res.json();
}

// Whether a file this app uploaded is already there. drive.file cannot see
// files it did not create, so this can only ever find our own uploads, which is
// exactly what it is for: never uploading the same attachment twice.
export async function findOwnFile(name, folderId) {
  const token = await googleAccessToken();
  const q = `name = '${String(name).replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({ q, fields: 'files(id,name,modifiedTime)', pageSize: '5' });
  const res = await fetch(`${FILES}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;                    // never block an upload on this
  const data = await res.json();
  return (data.files || [])[0] || null;
}

// Removes a file this app uploaded. drive.file can only delete what it created,
// so this can never touch a document somebody filed by hand, which is the right
// limit for a cleanup that exists to undo the agent's own mistake.
export async function deleteOwnFile(fileId) {
  const token = await googleAccessToken();
  const res = await fetch(`${FILES}/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  // 404 means it is already gone, which is the outcome we wanted.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete ${fileId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return true;
}
