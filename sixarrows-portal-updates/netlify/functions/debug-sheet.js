// netlify/functions/debug-sheet.js
// Temporary debug function — remove after troubleshooting
// Usage:
//   /.netlify/functions/debug-sheet                          → check env vars only
//   /.netlify/functions/debug-sheet?sheetUrl=URL            → test metadata
//   /.netlify/functions/debug-sheet?sheetUrl=URL&billing=1  → test billing parse

import { corsHeaders } from './lib/supabase-client.js';

function parseCurrency(val) {
  if (val === null || val === undefined || val === '') return 0;
  const str = String(val).replace(/[$,\s#DIV\/0!]/g, '').trim();
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const apiKey  = process.env.GOOGLE_API_KEY;
  const sbUrl   = process.env.SUPABASE_URL;
  const sbKey   = process.env.SUPABASE_ANON_KEY;
  const sheetUrl = event.queryStringParameters?.sheetUrl;
  const billing  = event.queryStringParameters?.billing === '1';

  const result = {
    env: {
      GOOGLE_API_KEY:    apiKey  ? `set (${apiKey.length} chars, starts: ${apiKey.slice(0,8)}...)` : 'MISSING',
      SUPABASE_URL:      sbUrl   ? 'set' : 'MISSING',
      SUPABASE_ANON_KEY: sbKey   ? 'set' : 'MISSING',
    },
    sheetTest: null,
    billingTest: null,
  };

  if (sheetUrl && apiKey) {
    const sheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const sheetId = sheetIdMatch ? sheetIdMatch[1] : null;

    if (sheetId) {
      // Test metadata
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey}&fields=sheets.properties`;
      try {
        const res  = await fetch(metaUrl);
        const data = res.ok ? await res.json() : await res.text();
        const tabs = res.ok ? (data.sheets || []).map(s => ({ id: s.properties.sheetId, title: s.properties.title })) : [];
        result.sheetTest = { status: res.status, ok: res.ok, sheetId, tabs };

        // If billing test requested, fetch the Billing tab
        if (billing && res.ok && tabs.length > 0) {
          const billingTab = tabs.find(t => t.title.toLowerCase() === 'billing') || tabs[0];
          const range = `'${billingTab.title}'!A:Z`;
          const valUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}&valueRenderOption=FORMATTED_VALUE`;
          const valRes  = await fetch(valUrl);
          const valData = valRes.ok ? await valRes.json() : null;
          const rows    = valData?.values || [];

          // Find tagged rows
          const tagged = rows.filter(r => r[25] && r[25].toString().trim())
            .map(r => ({ tag: r[25], name: r[0], budget: parseCurrency(r[1]), actual: parseCurrency(r[3]) }));

          result.billingTest = {
            tab: billingTab.title,
            totalRows: rows.length,
            taggedRows: tagged.length,
            tagged: tagged.slice(0, 15), // first 15 tagged rows
          };
        }
      } catch(e) {
        result.sheetTest = { error: e.message };
      }
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(result, null, 2),
  };
};
