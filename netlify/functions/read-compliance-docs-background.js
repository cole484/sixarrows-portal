// netlify/functions/read-compliance-docs-background.js
//
// Reads every compliance document that has not been read yet, and stops.
//
// This exists because of a hard limit rather than a design preference. The
// sweep answers an HTTP request, so it has seconds; opening a document with
// Claude takes several of them. Six fits. Forty does not, and the attempt
// times out having cached nothing, which is the worst of both.
//
// A background function is not answering anybody, so it has minutes. It fills
// the cache and nothing else: no Notion writes, no email, no decisions. Every
// other part of the system reads from that cache and is unchanged by whether
// this has run, apart from getting better answers once it has.
//
// Returns 202 immediately with no body, which is how background functions
// work. Watch progress by re-running the sweep and reading documents.read, or
// in the Netlify function log.
//
//   POST|GET /.netlify/functions/read-compliance-docs-background
//     ?limit=200   ceiling on documents opened this run
//     ?kind=coi    restrict to one folder: coi | w9
//     ?force=1     re-read documents already in the cache
//
// If this URL 404s, background functions are not enabled on the account. The
// fallback is the sweep itself with a small budget, run a few times:
//   /compliance-sweep?syncOnly=1&rematch=1&aiLimit=5
// Reads are cached, so each run picks up where the last one stopped.

import { supabase } from './lib/supabase-client.js';
import {
  listFolder, readCoiExpiry, readW9Identity,
  COI_FOLDER_ID, W9_FOLDER_ID,
} from './lib/compliance-docs.js';
import { anthropicConfigured, setReadBudget, readsUsed, errorLooksTransient } from './lib/doc-ai.js';

// Generous but not unbounded. A runaway here would be expensive rather than
// dangerous, which is still worth a ceiling.
const DEFAULT_LIMIT = 200;

// Reading a certificate takes ten to twenty seconds. A hundred documents one
// after another is half an hour, and this function has fifteen minutes, which
// is why the first attempt got partway through and stopped. Six at a time
// brings it under five.
const CONCURRENCY = 6;

// Stop with time to spare rather than being killed mid-document. Whatever is
// left is picked up by the next run, since finished reads are cached.
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

// Every read already in the cache, in one query rather than one per file.
// The two folders hold about a hundred documents between them, so a single
// page covers it many times over. If that ever stops being true the reader
// still works, it just re-reads a few documents it did not need to.
// Which documents genuinely have an answer already.
//
// A row exists for every attempt, including the ones that failed for reasons
// that had nothing to do with the document: out of credit, rate limited, API
// down. Those must not count as read, or this function skips exactly the
// files it exists to fix and reports them as already cached.
//
// The reader in compliance-docs.js already refuses to trust those rows. This
// is the second place that decision has to be made, because this function
// short-circuits before ever calling it.
//
// A certificate the cheap text pass dated does not count as read here either.
// This function exists to fill the cache with answers the sweep can act on, and
// the text pass gives a date and nothing else: not which policy the date
// belongs to, not the limits, not whether Six Arrows is an additional insured.
// Those rows used to look finished, so the backlog of half-read certificates
// could only be cleared with force=1, which throws away every good AI read
// alongside them.
async function cachedKeys() {
  const rows = await supabase('document_reads', {
    select: 'file_id,modified_time,error,method,kind',
    order: 'created_at.desc',
    limit: 2000,
  });

  const done = new Set();
  const decided = new Set();
  // Newest first, so the first row seen for a file is the one that counts.
  for (const r of rows) {
    const k = `${r.file_id}|${r.modified_time || ''}`;
    if (decided.has(k)) continue;
    decided.add(k);
    if (errorLooksTransient(r.error)) continue;
    if (r.kind === 'coi' && r.method && r.method !== 'ai') continue;
    done.add(k);
  }
  return done;
}

export const handler = async (event) => {
  const gKey = process.env.GOOGLE_API_KEY;
  const q    = event.queryStringParameters || {};

  if (!gKey) { console.error('read-compliance-docs: GOOGLE_API_KEY not set'); return; }
  if (!anthropicConfigured()) {
    console.error('read-compliance-docs: ANTHROPIC_API_KEY not set, so nothing here can be read');
    return;
  }

  const limit = Number(q.limit) > 0 ? Number(q.limit) : DEFAULT_LIMIT;
  const kind  = (q.kind || '').toLowerCase();
  const force = q.force === '1';
  setReadBudget(limit);

  const started = Date.now();
  const tally   = { read: 0, cached: 0, failed: 0, skipped: 0 };

  try {
    // If the cache cannot be read, it cannot be written either, and every
    // document opened here would be paid for and then thrown away. Stop
    // before spending anything. This function's whole job is filling the
    // cache, so a cache that is not there is not a degraded mode, it is the
    // job being impossible.
    let seen;
    try {
      seen = force ? new Set() : await cachedKeys();
    } catch (err) {
      console.error(
        `read-compliance-docs: STOPPING without reading anything. The document_reads table could not be read: ${err.message}. ` +
        `Reading documents now would cost money and save nothing. Check that supabase/add-document-reads.sql has been run.`
      );
      return;
    }

    const [coiFiles, w9Files] = await Promise.all([
      kind === 'w9'  ? [] : listFolder(COI_FOLDER_ID, gKey),
      kind === 'coi' ? [] : listFolder(W9_FOLDER_ID,  gKey),
    ]);

    const queue = [
      ...coiFiles.map(f => ({ f, kind: 'coi' })),
      ...w9Files.map(f  => ({ f, kind: 'w9'  })),
    ];

    console.log(`read-compliance-docs: ${queue.length} documents, ${seen.size} already read, ceiling ${limit}, ${CONCURRENCY} at a time`);

    await eachInParallel(queue, CONCURRENCY, async ({ f, kind: k }) => {
      if (readsUsed() >= limit)                { tally.skipped++; return; }
      if (Date.now() - started > SOFT_DEADLINE_MS) { tally.skipped++; return; }
      if (!force && seen.has(`${f.id}|${f.modifiedTime || ''}`)) { tally.cached++; return; }

      // One document failing is not a reason to stop reading the rest. The
      // reader already swallows its own errors; this is for the unexpected.
      try {
        const r = k === 'coi'
          ? await readCoiExpiry(f.id, gKey, f, { ai: true, force })
          : await readW9Identity(f.id, gKey, f, { force });

        const ok = k === 'coi' ? !!r.expiry : !!(r.name || r.businessName);
        if (ok) tally.read++; else tally.failed++;

        console.log(`  ${ok ? 'read' : 'FAILED'}  ${k}  ${f.name}  ${k === 'coi' ? (r.expiry || r.error) : (r.name || r.error)}`);
      } catch (err) {
        tally.failed++;
        console.error(`  ERROR  ${k}  ${f.name}: ${err.message}`);
      }
    });

    console.log(
      `read-compliance-docs: done in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `${tally.read} read, ${tally.failed} could not be read, ${tally.cached} already cached, ${tally.skipped} left for the next run.`
    );
  } catch (err) {
    console.error('read-compliance-docs failed:', err.message);
  }
};
