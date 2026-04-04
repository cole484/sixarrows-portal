// netlify/functions/debug-sheet.js
// Temporary debug function — remove after troubleshooting
// Call: /.netlify/functions/debug-sheet?sheetUrl=YOUR_URL

import { corsHeaders } from './lib/supabase-client.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const apiKey  = process.env.GOOGLE_API_KEY;
  const sbUrl   = process.env.SUPABASE_URL;
  const sbKey   = process.env.SUPABASE_ANON_KEY;
  const sheetUrl = event.queryStringParameters?.sheetUrl;

  const result = {
    env: {
      GOOGLE_API_KEY:    apiKey  ? `set (${apiKey.length} chars, starts: ${apiKey.slice(0,8)}...)` : 'MISSING',
      SUPABASE_URL:      sbUrl   ? `set` : 'MISSING',
      SUPABASE_ANON_KEY: sbKey   ? `set` : 'MISSING',
    },
    sheetTest: null,
  };

  // If sheet URL provided, test the metadata call
  if (sheetUrl && apiKey) {
    const sheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const sheetId = sheetIdMatch ? sheetIdMatch[1] : null;

    if (sheetId) {
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
      try {
        const res  = await fetch(metaUrl);
        const text = await res.text();
        result.sheetTest = {
          status:  res.status,
          ok:      res.ok,
          sheetId,
          response: res.ok ? JSON.parse(text) : text.slice(0, 500),
        };
      } catch(e) {
        result.sheetTest = { error: e.message };
      }
    } else {
      result.sheetTest = { error: 'Could not parse sheet ID from URL' };
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(result, null, 2),
  };
};
