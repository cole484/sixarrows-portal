// netlify/functions/read-quotes-background.js
//
// Opens every quote in a project's Drive folder that has not been read yet,
// and stops.
//
// Same reason read-compliance-docs-background.js exists: opening one of these
// with Claude took fourteen seconds on the Johnson plumbing quote, and
// quote-lookup answers an HTTP request. Two fit. Fifteen do not, and the
// attempt times out having cached almost nothing.
//
// This fills the cache and nothing else. No Notion writes, no decisions about
// whether a price is good, nothing sent to anybody. The gate and quote-lookup
// both read from that cache and are unchanged by whether this has run, apart
// from having answers once it has.
//
//   POST|GET /.netlify/functions/read-quotes-background
//     ?project=Johnson   which folder (default Johnson)
//     ?limit=100         ceiling on documents opened this run
//     ?force=1           re-read documents already in the cache
//
// Returns 202 immediately with no body. Watch progress by re-running
// quote-lookup, or in the Netlify function log.

import { supabase } from './lib/supabase-client.js';
import { folderForProject, listQuoteFiles, readQuoteFile, PROJECT_FOLDERS } from './lib/quote-docs.js';
import { anthropicConfigured, setReadBudget, readsUsed, errorLooksTransient } from './lib/doc-ai.js';

const DEFAULT_LIMIT    = 100;
const CONCURRENCY      = 6;
const SOFT_DEADLINE_MS = 12 * 60 * 1000;

async function eachInParallel(items, workers, fn) {
  const iter = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const { value, done } = iter.next();
      if (done) return;
      await fn(value);
    }
  }));
}

// Which documents genuinely have an answer already.
//
// A row exists for every attempt, including ones that failed for reasons that
// had nothing to do with the document: out of credit, rate limited, API down.
// Those must not count as read, or this skips exactly the files it exists to
// fix and reports them as cached.
async function cachedKeys() {
  const rows = await supabase('document_reads', {
    select: 'file_id,modified_time,error',
    order: 'created_at.desc',
    limit: 2000,
  });
  const done = new Set(), decided = new Set();
  for (const r of rows) {
    const k = `${r.file_id}|${r.modified_time || ''}`;
    if (decided.has(k)) continue;
    decided.add(k);
    if (!errorLooksTransient(r.error)) done.add(k);
  }
  return done;
}

export const handler = async (event) => {
  const gKey = process.env.GOOGLE_API_KEY;
  const q    = event.queryStringParameters || {};

  if (!gKey) { console.error('read-quotes: GOOGLE_API_KEY not set'); return; }
  if (!anthropicConfigured()) {
    console.error('read-quotes: ANTHROPIC_API_KEY not set, so nothing here can be read');
    return;
  }

  const projects = q.project ? [q.project] : Object.keys(PROJECT_FOLDERS);
  const limit    = Number(q.limit) > 0 ? Number(q.limit) : DEFAULT_LIMIT;
  const force    = q.force === '1';
  setReadBudget(limit);

  const started = Date.now();
  const tally   = { read: 0, cached: 0, failed: 0, skipped: 0 };

  try {
    // If the cache cannot be read it cannot be written either, and every
    // document opened here would be paid for and thrown away. Filling the
    // cache is this function's whole job, so a cache that is not there is not
    // a degraded mode, it is the job being impossible.
    let seen;
    try {
      seen = force ? new Set() : await cachedKeys();
    } catch (err) {
      console.error(
        `read-quotes: STOPPING without reading anything. document_reads could not be read: ${err.message}. ` +
        `Reading now would cost money and save nothing. Check supabase/add-document-reads.sql and add-document-reads-data.sql have been run.`
      );
      return;
    }

    const queue = [];
    for (const project of projects) {
      const folder = folderForProject(project);
      if (!folder) { console.error(`read-quotes: no folder mapped for "${project}"`); continue; }
      const files = await listQuoteFiles(folder, gKey);
      queue.push(...files.map(f => ({ f, project })));
    }

    console.log(`read-quotes: ${queue.length} documents across ${projects.join(', ')}, ${seen.size} already read, ceiling ${limit}, ${CONCURRENCY} at a time`);

    await eachInParallel(queue, CONCURRENCY, async ({ f, project }) => {
      if (readsUsed() >= limit)                    { tally.skipped++; return; }
      if (Date.now() - started > SOFT_DEADLINE_MS) { tally.skipped++; return; }
      if (!force && seen.has(`${f.id}|${f.modifiedTime || ''}`)) { tally.cached++; return; }

      try {
        const r  = await readQuoteFile(f, gKey, { force });
        const ok = r.total != null;
        if (ok) tally.read++; else tally.failed++;
        console.log(`  ${ok ? 'read' : 'FAILED'}  ${project}  ${f.name}  ${ok ? r.total : r.error}`);
      } catch (err) {
        tally.failed++;
        console.error(`  ERROR  ${project}  ${f.name}: ${err.message}`);
      }
    });

    console.log(
      `read-quotes: done in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `${tally.read} read, ${tally.failed} could not be read, ${tally.cached} already cached, ${tally.skipped} left for the next run.`
    );
  } catch (err) {
    console.error('read-quotes failed:', err.message);
  }
};
