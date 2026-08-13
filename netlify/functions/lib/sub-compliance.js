// netlify/functions/lib/sub-compliance.js
//
// What the certificate on file actually says about a subcontractor, keyed by
// their Notion page id.
//
// This exists so the scheduling gate and the compliance sweep answer the same
// question the same way. Six Arrows checks compliance at the moment work is
// scheduled rather than chasing a back catalogue, which makes the gate the
// place the answer has to be right.
//
// Reads from the document cache only. No downloads, no API calls, no cost, so
// it is safe to call on every gate run. Anything not yet read comes back as
// 'unread' rather than as a problem with the subcontractor, because those are
// different situations and only one of them is the sub's fault.

import { listFolder, matchSub, readCoiExpiry, COI_FOLDER_ID } from './compliance-docs.js';
import { loadCacheIndex } from './doc-cache.js';

// Six Arrows requires this on the general liability policy only. The ADDL INSD
// column on the auto, umbrella and workers comp rows is not our concern.
export { REQUIRED_EACH_OCCURRENCE, REQUIRED_AGGREGATE } from './doc-ai.js';

// verdict values, in the order a person would care about them:
//   unread   nothing has read this sub's certificate yet
//   missing  no certificate file matched this sub at all
//   expired  the policy term has passed, or passes before the work starts
//   review   read, current, but something needs a person: not named as
//            additionally insured, or the reader could not tell
//   ok       current, Six Arrows named, nothing outstanding
//
// Limits are deliberately NOT part of the verdict. Per Cole, short limits get
// flagged and reported to him so he can talk to the subcontractor, and do not
// stop work being scheduled.
export async function certificatesBySub(subs, gKey, opts = {}) {
  const out = new Map();
  if (!subs?.length || !gKey) return out;

  let files, cache;
  try {
    [files, cache] = await Promise.all([
      listFolder(COI_FOLDER_ID, gKey),
      loadCacheIndex().then(r => r.index),
    ]);
  } catch (err) {
    // A gate run must not fail because Drive is having a bad minute. Every sub
    // comes back 'unread', which reads as "not checked" rather than "failed".
    console.error('sub-compliance: could not load documents:', err.message);
    return out;
  }

  // Newest file wins where a sub has several certificates on file.
  const bySub = new Map();
  for (const f of files) {
    const m = matchSub(f.name, subs);
    if (!m) continue;
    const cur = bySub.get(m.sub.id);
    if (!cur || f.modifiedTime > cur.modifiedTime) bySub.set(m.sub.id, f);
  }

  for (const sub of subs) {
    const file = bySub.get(sub.id);
    if (!file) {
      out.set(sub.id, { verdict: 'missing', file: null });
      continue;
    }

    const r = await readCoiExpiry(file.id, gKey, file, { cacheOnly: true, cache });
    out.set(sub.id, {
      file: file.name,
      expiry: r.expiry || null,
      confidence: r.confidence || 'none',
      additionalInsured: r.additionalInsured || 'unclear',
      limitsOk: r.limitsOk || 'unknown',
      limits: {
        eachOccurrence: r.policies?.eachOccurrence ?? null,
        aggregate:      r.policies?.aggregate ?? null,
      },
      notes: r.notes || null,
      verdict: r.expiry ? 'read' : 'unread',
    });
  }

  return out;
}

// Turns a certificate into the verdict for one task, which needs the task's
// start date: a policy that is current today but lapses before the crew shows
// up is not cover, and saying "ok" about it would be the wrong answer at
// exactly the moment it matters.
export function verdictForStart(cert, startDate) {
  if (!cert)                     return { verdict: 'missing', reason: 'no certificate on file' };
  if (cert.verdict === 'missing') return { verdict: 'missing', reason: 'no certificate on file' };
  if (cert.verdict === 'unread')  return { verdict: 'unread',  reason: `a certificate is on file (${cert.file}) but it has not been read yet` };

  const start = startDate ? String(startDate).slice(0, 10) : null;
  if (start && cert.expiry && cert.expiry < start) {
    return { verdict: 'expired', reason: `the certificate expires ${cert.expiry}, before the work starts ${start}` };
  }

  if (cert.additionalInsured === 'no') {
    return { verdict: 'review', reason: 'Six Arrows is not listed as an additional insured on the general liability policy' };
  }
  if (cert.additionalInsured === 'unclear') {
    return { verdict: 'review', reason: 'the certificate does not clearly show whether Six Arrows is an additional insured on general liability' };
  }

  return { verdict: 'ok', reason: null };
}

// Short limits are their own thing: reported, never blocking. Returns null when
// there is nothing to say.
export function limitsShortfall(cert) {
  if (!cert || cert.limitsOk !== 'no') return null;
  const l = cert.limits || {};
  return {
    eachOccurrence: l.eachOccurrence ?? null,
    aggregate:      l.aggregate ?? null,
    detail: `carries ${money(l.eachOccurrence)} each occurrence and ${money(l.aggregate)} aggregate, against the 1,000,000 and 2,000,000 Six Arrows requires`,
  };
}

function money(v) {
  return typeof v === 'number' ? v.toLocaleString('en-US') : 'an unreadable amount';
}
