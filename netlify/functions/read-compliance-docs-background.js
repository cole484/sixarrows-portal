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
import { anthropicConfigured, setReadBudget, readsUsed } from './lib/doc-ai.js';

// Generous but not unbounded. A runaway here would be expensive rather than
// dangerous, which is still worth a ceiling.
const DEFAULT_LIMIT = 200;

// Every read already in the cache, in one query rather than one per file.
// The two folders hold about a hundred documents between them, so a single
// page covers it many times over. If that ever stops being true the reader
// still works, it just re-reads a few documents it did not need to.
async function cachedKeys() {
  try {
    const rows = await supabase('document_reads', {
      select: 'file_id,modified_time',
      order: 'created_at.desc',
      limit: 2000,
    });
    return new Set(rows.map(r => `${r.file_id}|${r.modified_time || ''}`));
  } catch (err) {
    console.error(`read-compliance-docs: could not read the cache index (${err.message}), falling back to per-file lookups`);
    return new Set();
  }
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
    const [coiFiles, w9Files, seen] = await Promise.all([
      kind === 'w9'  ? [] : listFolder(COI_FOLDER_ID, gKey),
      kind === 'coi' ? [] : listFolder(W9_FOLDER_ID,  gKey),
      force ? new Set() : cachedKeys(),
    ]);

    const queue = [
      ...coiFiles.map(f => ({ f, kind: 'coi' })),
      ...w9Files.map(f  => ({ f, kind: 'w9'  })),
    ];

    console.log(`read-compliance-docs: ${queue.length} documents, ${seen.size} already read, ceiling ${limit}`);

    for (const { f, kind: k } of queue) {
      if (readsUsed() >= limit) { tally.skipped++; continue; }
      if (!force && seen.has(`${f.id}|${f.modifiedTime || ''}`)) { tally.cached++; continue; }

      // One document failing is not a reason to stop reading the rest. The
      // reader already swallows its own errors; this is for the unexpected.
      try {
        const before = readsUsed();
        const r = k === 'coi'
          ? await readCoiExpiry(f.id, gKey, f, { ai: true, force })
          : await readW9Identity(f.id, gKey, f, { force });

        if (readsUsed() === before) { tally.cached++; continue; }

        const ok = k === 'coi' ? !!r.expiry : !!(r.name || r.businessName);
        if (ok) tally.read++; else tally.failed++;

        console.log(`  ${ok ? 'read' : 'FAILED'}  ${k}  ${f.name}  ${k === 'coi' ? (r.expiry || r.error) : (r.name || r.error)}`);
      } catch (err) {
        tally.failed++;
        console.error(`  ERROR  ${k}  ${f.name}: ${err.message}`);
      }
    }

    console.log(
      `read-compliance-docs: done in ${Math.round((Date.now() - started) / 1000)}s. ` +
      `${tally.read} read, ${tally.failed} could not be read, ${tally.cached} already cached, ${tally.skipped} left for the next run.`
    );
  } catch (err) {
    console.error('read-compliance-docs failed:', err.message);
  }
};
