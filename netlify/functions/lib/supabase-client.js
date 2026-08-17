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
    if (order) params.set('order', order);
    if (limit) params.set('limit', limit);
  }

  // Filters go on every method that has a WHERE clause, which is everything
  // except an insert.
  //
  // They used to be applied to GET and DELETE only, which is safe for a POST
  // and quietly catastrophic for a PATCH: PostgREST takes an unfiltered PATCH
  // to mean every row in the table. The first caller to pass filters with a
  // PATCH would have updated the lot. Nothing had yet, because every other
  // update in this codebase builds its own URL, which is how it stayed hidden.
  if (method !== 'POST') {
    filters.forEach(f => params.set(`${f.col}`, `${f.op}.${f.val}`));
  }

  // A PATCH or DELETE with no filter at all is almost always a bug rather than
  // an intention, and the consequence is the whole table. Refuse it here rather
  // than let PostgREST be literal about it.
  if ((method === 'PATCH' || method === 'DELETE') && !filters.length) {
    throw new Error(`Supabase ${method} ${table}: refusing an unfiltered ${method}, which would affect every row. Pass a filter.`);
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
  const preferParts = ['return=representation', 'resolution=merge-duplicates'];
  if (conflictCols.length > 0) preferParts.push(`on_conflict=${conflictCols.join(',')}`);
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': preferParts.join(','),
  };
  const res = await fetch(url, {
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
