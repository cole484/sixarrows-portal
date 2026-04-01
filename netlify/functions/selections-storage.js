// netlify/functions/selections-storage.js
// Wave Selections cross-device storage using Supabase
// Replaces the broken Netlify Blobs approach

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
  };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Env var health check
  const url = SB_URL();
  const key = SB_KEY();
  if (!url || !key) {
    console.error('MISSING ENV VARS — SUPABASE_URL:', !!url, 'SUPABASE_ANON_KEY:', !!key);
    return respond(503, { 
      error: 'Storage not configured', 
      detail: `SUPABASE_URL: ${url ? 'set' : 'MISSING'}, SUPABASE_ANON_KEY: ${key ? 'set' : 'MISSING'}` 
    });
  }

  const clientKey = event.queryStringParameters?.clientKey;
  if (!clientKey) return respond(400, { error: 'clientKey required' });

  // ── GET ──────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const suffix = event.queryStringParameters?.suffix || null;
    try {
      let url = `${SB_URL()}/rest/v1/selections?client_id=eq.${clientKey}&select=suffix,data`;
      if (suffix) url += `&suffix=eq.${suffix}`;

      const res = await fetch(url, { headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase GET: ${res.status} ${await res.text()}`);
      const rows = await res.json();

      if (suffix) {
        const row = rows?.[0];
        return respond(200, { key: `${clientKey}_${suffix}`, data: row?.data ?? null });
      }
      const data = {};
      (rows || []).forEach(r => { data[r.suffix] = r.data; });
      return respond(200, { clientKey, data });
    } catch (err) {
      console.error('selections GET error:', err.message, 'URL:', url, 'KEY set:', !!key);
      return respond(500, { error: err.message, debug: `URL: ${url}` });
    }
  }

  // ── POST ─────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const isBatch = event.queryStringParameters?.batch === '1';

      if (isBatch && body.batch) {
        // Save all suffixes in parallel individual upserts
        const entries = Object.entries(body.batch);
        const results = await Promise.all(entries.map(async ([suffix, data]) => {
          // Use URL param for on_conflict (works with all PostgREST versions)
          const url = `${SB_URL()}/rest/v1/selections?on_conflict=client_id%2Csuffix`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              ...sbHeaders(),
              'Prefer': 'return=minimal,resolution=merge-duplicates',
            },
            body: JSON.stringify({
              client_id: clientKey,
              suffix,
              data,
              updated_at: new Date().toISOString(),
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            console.error(`Supabase upsert failed for ${suffix}:`, res.status, errText);
            return { suffix, ok: false, error: errText };
          }
          return { suffix, ok: true };
        }));

        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) {
          console.error('Some upserts failed:', failed);
          return respond(207, { success: false, results, failed });
        }
        return respond(200, { success: true, saved: entries.length });
      }

      // Single suffix save
      const { suffix, data } = body;
      if (!suffix) return respond(400, { error: 'suffix required' });

      const url = `${SB_URL()}/rest/v1/selections?on_conflict=client_id%2Csuffix`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...sbHeaders(),
          'Prefer': 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify({ client_id: clientKey, suffix, data, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('Supabase POST failed:', res.status, errText);
        throw new Error(`Supabase POST: ${res.status} ${errText}`);
      }
      return respond(200, { success: true });
    } catch (err) {
      console.error('selections POST error:', err.message);
      return respond(500, { error: err.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    try {
      const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${clientKey}`;
      const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
      if (!res.ok) throw new Error(`Supabase DELETE: ${res.status}`);
      return respond(200, { success: true });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed' });
};
