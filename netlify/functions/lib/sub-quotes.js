// netlify/functions/lib/sub-quotes.js
//
// What price Six Arrows already holds from each subcontractor on a project,
// keyed by their Notion page id.
//
// Same shape and the same discipline as sub-compliance.js: cache-only reads, so
// the scheduling gate can call this on every run without downloading a single
// document. Anything not yet read comes back 'unread', which is a statement
// about us rather than about the subcontractor.
//
// Priming the cache is a separate job with its own time budget, which is what
// quote-lookup.js is for.

import { loadCacheIndex } from './doc-cache.js';
import {
  folderForProject, listQuoteFiles, groupQuotesBySub, readQuoteFile, quoteState,
} from './quote-docs.js';

export { quoteState, STALE_AFTER_DAYS } from './quote-docs.js';

// Returns Map(subId -> { ...quote, file, state, reason, alternates })
// plus the files that matched no subcontractor, which is its own finding: a
// price we hold from somebody nobody has linked to a task.
export async function quotesForProject(subs, project, gKey, opts = {}) {
  const empty = { bySub: new Map(), unmatched: [], files: 0, folder: null };
  const folder = folderForProject(project);
  if (!folder || !gKey || !subs?.length) return { ...empty, folder };

  let files, cache;
  try {
    [files, cache] = await Promise.all([
      listQuoteFiles(folder, gKey),
      loadCacheIndex().then(r => r.index),
    ]);
  } catch (err) {
    // Drive having a bad minute must not fail a gate run. Every sub comes back
    // with no quote, which reads as "not checked" rather than "none exists".
    console.error('sub-quotes: could not list the project folder:', err.message);
    return { ...empty, folder, error: err.message };
  }

  const { bySub, unmatched } = groupQuotesBySub(files, subs, project);
  const out = new Map();

  for (const [subId, list] of bySub) {
    const reads = [];
    for (const f of list.slice(0, opts.perSubLimit || 4)) {
      reads.push(await readQuoteFile(f, gKey, { cacheOnly: opts.cacheOnly !== false, cache, force: opts.force }));
    }

    // The newest readable quote is the one that counts. An older one that was
    // read while the new one has not been is still the wrong answer, so an
    // unread newest file wins and says so rather than quietly falling back to
    // a superseded price.
    const best = reads[0] || null;
    const { state, reason } = quoteState(best);
    out.set(subId, {
      ...best,
      state,
      reason,
      alternates: reads.slice(1).map(r => ({ file: r.file, total: r.total ?? null })),
    });
  }

  return { bySub: out, unmatched, files: files.length, folder };
}
