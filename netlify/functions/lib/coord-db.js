// netlify/functions/lib/coord-db.js
// Connection to the coordinator's own tables (the `coord` schema), used only by
// the coord-* functions. It connects as the `coord_app` database role, which can
// read and write coord and nothing else: none of the portal's tables.
//
// Env:
//   COORD_DATABASE_URL  Postgres connection string for coord_app (Supabase pooler)
//   COORD_TOKEN         passcode the coordinator page sends; no default, ever
import pg from 'pg';
import { timingSafeEqual } from 'node:crypto';

let pool = null;

export function db() {
  if (!process.env.COORD_DATABASE_URL) throw new Error('COORD_DATABASE_URL is not configured');
  if (!pool) {
    const url = process.env.COORD_DATABASE_URL;
    pool = new pg.Pool({
      connectionString: url,
      max: 2,
      ssl: /localhost|127\.0\.0\.1|\/var\/tmp/.test(url) ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function tx(fn) {
  const client = await db().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// The page sends `Authorization: Bearer <passcode>`. Refuse when the passcode
// is not configured rather than falling back to anything.
export function authorized(event) {
  const want = process.env.COORD_TOKEN || '';
  const got = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
