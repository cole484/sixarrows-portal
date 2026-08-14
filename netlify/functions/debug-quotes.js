// netlify/functions/debug-quotes.js
//
// Temporary probe. Answers one question: where do the quotes we have already
// received actually live? Cole says they are in the client's budget and billing
// spreadsheet or somewhere in the client's Drive folder, and before anything is
// built to search those places automatically, the real shape of both has to be
// looked at rather than guessed.
//
// Usage:
//   ?sheetId=<id>&tab=Budget&max=200      raw rows from one tab
//   ?sheetId=<id>&tabs=1                  list the tabs
//   ?folder=<driveFolderId>&depth=3       walk a Drive folder tree
//   ?folder=<id>&depth=3&q=quote          same, but only names matching q
//
// Delete once the quote lookup is built.

import { corsHeaders } from './lib/supabase-client.js';

const reply = body => ({
  statusCode: 200,
  headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  body: JSON.stringify(body, null, 2),
});

async function listFolder(id, key) {
  const out = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${id}' in parents and trashed = false`);
    url.searchParams.set('key', key);
    url.searchParams.set('fields', 'nextPageToken, files(id,name,mimeType,modifiedTime,size)');
    url.searchParams.set('pageSize', '200');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      out.push({ error: `${res.status} ${(await res.text()).slice(0, 200)}` });
      break;
    }
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function walk(id, key, depth, match, path = '') {
  const files = await listFolder(id, key);
  const rows = [];
  for (const f of files) {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    const here = `${path}/${f.name}`;
    if (!match || here.toLowerCase().includes(match)) {
      rows.push({
        path: here,
        id: f.id,
        kind: isFolder ? 'folder' : f.mimeType.replace('application/', '').replace('vnd.google-apps.', 'gdoc:'),
        modified: f.modifiedTime,
      });
    }
    if (isFolder && depth > 1) rows.push(...await walk(f.id, key, depth - 1, match, here));
  }
  return rows;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };

  const key = process.env.GOOGLE_API_KEY;
  if (!key) return reply({ error: 'GOOGLE_API_KEY not set' });

  const q       = event.queryStringParameters || {};
  const sheetId = q.sheetId;
  const folder  = q.folder;
  const max     = Math.min(Number(q.max) || 120, 500);

  try {
    if (folder) {
      const rows = await walk(folder, key, Math.min(Number(q.depth) || 2, 5), (q.q || '').toLowerCase());
      return reply({ folder, count: rows.length, rows: rows.slice(0, 400) });
    }

    if (q.file) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${q.file}?alt=media&key=${key}`);
      if (!res.ok) return reply({ error: `${res.status} ${(await res.text()).slice(0, 200)}` });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { extractText } = await import('unpdf');
      const { text } = await extractText(bytes, { mergePages: true });
      const raw = String(text || '');
      return reply({ file: q.file, bytes: bytes.length, chars: raw.length, head: raw.slice(0, Number(q.chars) || 3000) });
    }

    if (sheetId && q.tabs) {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${key}&fields=sheets.properties`);
      const data = await res.json();
      return reply({ tabs: (data.sheets || []).map(s => s.properties) });
    }

    if (sheetId) {
      const tab   = q.tab || 'Budget';
      const range = `'${tab}'!${q.range || 'A1:AA' + max}`;
      const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${key}&valueRenderOption=FORMATTED_VALUE`;
      const res   = await fetch(url);
      if (!res.ok) return reply({ error: `${res.status} ${(await res.text()).slice(0, 300)}` });
      const rows = (await res.json()).values || [];
      return reply({
        tab,
        rowCount: rows.length,
        // Trailing empty cells are dropped by the API, so rows come back ragged.
        // Left as-is: the ragged shape is itself information about the sheet.
        rows: rows.slice(0, max),
      });
    }

    return reply({ usage: 'pass sheetId (with tab or tabs=1) or folder' });
  } catch (err) {
    return reply({ error: err.message });
  }
};
