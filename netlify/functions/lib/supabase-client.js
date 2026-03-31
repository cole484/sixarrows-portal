// netlify/functions/lib/supabase-client.js
// Shared Supabase client — imported by all functions

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

// Lightweight REST client — no npm package needed
export async function supabase(table, options = {}) {
  const {
    method   = 'GET',
    select   = '*',
    filters  = [],   // array of { col, op, val } e.g. { col:'client_id', op:'eq', val:'hoops' }
    body     = null,
    single   = false,
    upsert   = false,
    order    = null,
    limit    = null,
  } = options;

  let url = `${SUPABASE_URL}/rest/v1/${table}`;

  const params = new URLSearchParams();
  if (method === 'GET' || method === 'DELETE') {
    params.set('select', select);
    filters.forEach(f => params.set(`${f.col}`, `${f.op}.${f.val}`));
    if (order) params.set('order', order);
    if (limit) params.set('limit', limit);
  }

  const qs = params.toString();
  if (qs) url += '?' + qs;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': single
      ? 'return=representation,count=exact'
      : upsert
      ? 'return=representation,resolution=merge-duplicates'
      : 'return=representation',
  };

  const fetchOptions = { method, headers };
  if (body) fetchOptions.body = JSON.stringify(body);

  const res = await fetch(url, fetchOptions);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${err}`);
  }

  const text = await res.text();
  if (!text) return single ? null : [];

  const data = JSON.parse(text);
  return single ? (Array.isArray(data) ? data[0] : data) : data;
}

// Upsert helper
export async function upsertRow(table, row, conflictCols = []) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation,resolution=merge-duplicates',
  };
  if (conflictCols.length > 0) {
    headers['Prefer'] += `,on_conflict=${conflictCols.join(',')}`;
  }
  const res = await fetch(url + '?on_conflict=' + conflictCols.join(','), {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert ${table}: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
});

export const respond = (status, body) => ({
  statusCode: status,
  headers: corsHeaders(),
  body: JSON.stringify(body),
});
