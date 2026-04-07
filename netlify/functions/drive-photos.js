// netlify/functions/drive-photos.js
// Lists image files from Google Drive folders
// Requires GOOGLE_API_KEY with Drive API enabled
// Folders must be shared as "Anyone with the link"
//
// POST { folders: [{label, url}] }  — list images across multiple folders (preferred)
// GET  ?folderId=ID                 — list images in a single folder

const GS_KEY = () => process.env.GOOGLE_API_KEY;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function extractFolderId(urlOrId) {
  if (!urlOrId) return null;
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const m = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // Already an ID (10+ alphanumeric chars with no path separators)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(urlOrId.trim())) return urlOrId.trim();
  return null;
}

async function listFolderImages(folderId, apiKey) {
  const query  = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const fields  = 'files(id,name,mimeType,createdTime)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${apiKey}&fields=${encodeURIComponent(fields)}&orderBy=createdTime+desc&pageSize=100`;

  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    let msg = `Drive API error ${res.status}`;
    try { msg = JSON.parse(txt).error?.message || msg; } catch(e) {}
    throw new Error(msg);
  }

  const data = await res.json();
  return (data.files || []).map(f => ({
    id:       f.id,
    name:     f.name,
    thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
    date:     f.createdTime
      ? new Date(f.createdTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null,
  }));
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const apiKey = GS_KEY();
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'GOOGLE_API_KEY not configured' }) };
  }

  // ── POST: JSON body with folders array ──────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch(e) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const folders = body.folders || [];
    if (!folders.length) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'folders array required' }) };
    }

    const results = [];
    for (const folder of folders) {
      const folderId = extractFolderId(folder.url);
      if (!folderId) {
        results.push({ label: folder.label, url: folder.url, error: 'Invalid folder URL', files: [] });
        continue;
      }
      try {
        const files = await listFolderImages(folderId, apiKey);
        results.push({ folderId, label: folder.label, files, count: files.length });
      } catch(err) {
        results.push({ folderId, label: folder.label, error: err.message, files: [] });
      }
    }

    return {
      statusCode: 200,
      headers:    CORS,
      body:       JSON.stringify({
        folders:     results,
        totalPhotos: results.reduce((s, r) => s + (r.files?.length || 0), 0),
      }),
    };
  }

  // ── GET: single folder via query param ─────────────────────────────────
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    const folderId = extractFolderId(q.folderId);
    if (!folderId) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'folderId required' }) };
    }
    try {
      const files = await listFolderImages(folderId, apiKey);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ files, count: files.length }) };
    } catch(err) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
