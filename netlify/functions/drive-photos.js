// netlify/functions/drive-photos.js
// Lists image files from one or more Google Drive folders
// Requires: GOOGLE_API_KEY with Drive API enabled
// Folders must be shared as "Anyone with the link"
//
// GET ?folderId=ID                     — list images in a single folder
// GET ?folders=ID1,ID2,ID3             — list images across multiple folders
// GET ?folders=ID1:Label1,ID2:Label2   — with phase labels

const GS_KEY = () => process.env.GOOGLE_API_KEY;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

function extractFolderId(urlOrId) {
  if (!urlOrId) return null;
  // https://drive.google.com/drive/folders/FOLDER_ID
  const m = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  // Already just an ID
  if (/^[a-zA-Z0-9_-]{10,}$/.test(urlOrId.trim())) return urlOrId.trim();
  return null;
}

async function listFolderImages(folderId, apiKey) {
  // Query for image files in this folder, newest first
  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`
  );
  const fields = encodeURIComponent('files(id,name,mimeType,createdTime,modifiedTime)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&key=${apiKey}&fields=${fields}&orderBy=createdTime+desc&pageSize=50`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    let msg = `Drive API error ${res.status}`;
    try { msg = JSON.parse(err).error?.message || msg; } catch(e) {}
    throw new Error(msg);
  }

  const data = await res.json();
  return (data.files || []).map(f => ({
    id:       f.id,
    name:     f.name,
    // Thumbnail URL — works for publicly shared files
    thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
    date:     f.createdTime ? new Date(f.createdTime).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : null,
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

  const q = event.queryStringParameters || {};

  // Single folder
  if (q.folderId) {
    const folderId = extractFolderId(q.folderId);
    if (!folderId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid folder ID or URL' }) };
    try {
      const files = await listFolderImages(folderId, apiKey);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ files, count: files.length }) };
    } catch(err) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  // Multiple folders — format: "ID1:Label1,ID2:Label2" or "URL1:Label1,URL2:Label2"
  if (q.folders) {
    const entries = q.folders.split(',').map(entry => {
      const colonIdx = entry.lastIndexOf(':');
      if (colonIdx > 10) { // colon after the ID part
        const raw   = entry.slice(0, colonIdx).trim();
        const label = entry.slice(colonIdx + 1).trim();
        return { raw, label };
      }
      return { raw: entry.trim(), label: null };
    });

    const results = [];
    for (const { raw, label } of entries) {
      const folderId = extractFolderId(raw);
      if (!folderId) { results.push({ label, error: 'Invalid folder ID', files: [] }); continue; }
      try {
        const files = await listFolderImages(folderId, apiKey);
        results.push({ folderId, label: label || folderId, files, count: files.length });
      } catch(err) {
        results.push({ folderId, label: label || folderId, error: err.message, files: [] });
      }
    }

    return {
      statusCode: 200,
      headers:    CORS,
      body:       JSON.stringify({ folders: results, totalPhotos: results.reduce((s,r) => s + r.files.length, 0) }),
    };
  }

  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'folderId or folders parameter required' }) };
};
