// netlify/functions/lib/coverage.js
//
// One subcontractor's insurance position, assembled from every certificate we
// hold for them rather than from the newest file.
//
// Why this exists: a sub carrying general liability and workers compensation
// from the same carrier sends one certificate. A sub carrying them from two
// carriers sends two, and that is a normal arrangement rather than an edge
// case. Home Pro Pest Control is the case that forced this: general liability
// through LIPCA to 2027-07-15, workers compensation through KEMI to 2026-09-28.
// Reading only the newest file answered "covered until 2027", which is true of
// one policy and false of the sub, and it hid a general liability aggregate of
// 1,000,000 against the 2,000,000 Six Arrows requires.
//
// The rules, in the order they matter:
//
//   1. Per coverage, the LATEST expiry wins. Two certificates both carrying
//      general liability means a renewal, and the older one is dead paper. This
//      is the one place where taking the later date is right.
//   2. Across coverages, the EARLIEST expiry controls. Workers compensation
//      lapsing in September is not rescued by liability running to next July.
//   3. Additional insured is judged on the document that carries the general
//      liability policy, and on no other. A workers compensation certificate
//      never names an additional insured, so reading one and concluding "no"
//      accuses a sub of a paperwork failure they did not commit.
//   4. Limits come from the same document as the general liability policy, for
//      the same reason.
//
// Decides nothing and sends nothing. It reports the position; the sweep decides
// what to do about it.

// A read from the text pass knows a date but not which policy it belongs to,
// because it found the date by pattern rather than by reading the form. Those
// are kept apart from the AI reads and only used when nothing better exists.
function attributed(entry) {
  const p = entry?.read?.policies;
  return !!(p && (p.generalLiability || p.workersComp));
}

// Latest expiry wins, then the newer file, so a renewal supersedes the policy
// it renews and a re-issue of the same term supersedes the original.
function pickLatest(entries, key) {
  let best = null;
  for (const e of entries) {
    const d = e.read?.policies?.[key];
    if (!d) continue;
    if (!best) { best = e; continue; }
    const bd = best.read.policies[key];
    if (d > bd) { best = e; continue; }
    if (d === bd && String(e.file?.modifiedTime || '') > String(best.file?.modifiedTime || '')) best = e;
  }
  return best;
}

const REQUIRED_EACH_OCCURRENCE = 1_000_000;
const REQUIRED_AGGREGATE       = 2_000_000;

// entries: [{ file, read }] where read is whatever readCoiExpiry returned.
// Returns the same field names the sweep already used for a single document,
// plus the per coverage detail, so callers read one shape either way.
export function mergeCoverage(entries = []) {
  const usable = entries.filter(e => e && e.read);
  const withDate = usable.filter(e => e.read.expiry || attributed(e));

  const blank = {
    expiry: null, confidence: 'none', additionalInsured: null,
    insuredName: null, producer: null, limits: null, limitsOk: null,
    policies: null, coverage: { generalLiability: null, workersComp: null },
    missingCoverage: [], needsAttribution: [],
    sources: {}, files: usable.map(e => e.file?.name).filter(Boolean),
    combined: false, readVia: null, readError: null, notes: null,
    cacheDecision: null, retryBecause: null,
  };
  if (!usable.length) return blank;

  const attributedEntries = withDate.filter(attributed);
  const gl = pickLatest(attributedEntries, 'generalLiability');
  const wc = pickLatest(attributedEntries, 'workersComp');

  // Nothing told us which policy is which. That is the text pass, or a document
  // nobody could read. Fall back to the behaviour that existed before this
  // file: take the best date on offer and say plainly that it is not attributed
  // to a coverage.
  let unattributed = null;
  if (!gl && !wc) {
    for (const e of usable) {
      if (!e.read.expiry) continue;
      if (!unattributed || e.read.expiry > unattributed.read.expiry) unattributed = e;
    }
  }

  const source = gl || unattributed || wc || usable[0];
  const read   = source.read;

  const glDate = gl?.read?.policies?.generalLiability || null;
  const wcDate = wc?.read?.policies?.workersComp || null;

  // Rule 2. The earliest of the two coverages that are actually on file.
  const dates = [glDate, wcDate].filter(Boolean);
  const expiry = dates.length ? dates.slice().sort()[0] : (unattributed?.read?.expiry || null);

  // Rules 3 and 4: both answers belong to the general liability document.
  const limitsSource = gl || unattributed || null;
  const limits = limitsSource?.read?.policies
    ? {
        eachOccurrence: limitsSource.read.policies.eachOccurrence ?? null,
        aggregate:      limitsSource.read.policies.aggregate ?? null,
      }
    : null;

  // Three states as before, and the third one matters: a limit nobody could
  // read is not a limit that is too low, and only one of those is the
  // subcontractor's problem.
  const limitsOk = !limitsSource
    ? null
    : (limits && limits.eachOccurrence != null && limits.aggregate != null)
      ? (limits.eachOccurrence >= REQUIRED_EACH_OCCURRENCE && limits.aggregate >= REQUIRED_AGGREGATE ? 'yes' : 'no')
      : 'unknown';

  const additionalInsured = limitsSource?.read?.additionalInsured || null;

  // Which coverages we hold nothing for. Reported, never acted on: plenty of
  // one-man operations legitimately carry no workers compensation, and a sole
  // proprietor being told they are out of compliance for not insuring themselves
  // is the kind of message that costs a relationship.
  //
  // Silent when the date came from the text pass. That reader knows a date and
  // not which policy it belongs to, so it cannot tell a missing coverage from
  // one it simply could not name, and reporting the guess as a gap sends
  // somebody chasing paperwork that is already on file.
  const missingCoverage = [];
  if (!unattributed) {
    if (!glDate) missingCoverage.push('generalLiability');
    if (!wcDate) missingCoverage.push('workersComp');
  }

  // A document the text pass dated but could not place, sitting next to one that
  // was properly read, and expiring sooner than the date we are about to call
  // controlling. It is either a second coverage or a superseded copy, and
  // nothing here can tell which, so it is named rather than guessed at. Home Pro
  // is exactly this: a small workers compensation certificate with a text layer,
  // dated by the cheap pass, quietly outranked by the liability certificate.
  const needsAttribution = expiry
    ? withDate
        .filter(e => !attributed(e) && e.read.expiry && e.read.expiry < expiry)
        .map(e => e.file?.name)
        .filter(Boolean)
    : [];

  // Every read that failed, named by its file, so a sub whose good certificate
  // was found still reports the one that could not be opened.
  const failures = usable
    .filter(e => !e.read.expiry && e.read.error)
    .map(e => `${e.file?.name || 'a file'}: ${e.read.error}`);

  const notes = [];
  if (glDate && wcDate && gl.file?.id !== wc.file?.id) {
    notes.push(
      `General liability runs to ${glDate} on ${gl.file?.name}, workers compensation to ${wcDate} on ${wc.file?.name}. ` +
      `The earlier of the two is what controls.`
    );
  }
  if (unattributed) {
    notes.push('The date came from the text pass, which cannot say which policy it belongs to.');
  }
  if (needsAttribution.length) {
    notes.push(
      `${needsAttribution.join(' and ')} expires sooner than that and has only been dated by the text pass, ` +
      `which cannot say which policy the date belongs to. Read it with the AI reader before trusting the date above.`
    );
  }
  if (usable.length > 1) {
    notes.push(`${usable.length} certificates are on file for this subcontractor.`);
  }
  if (read.notes) notes.push(read.notes);

  return {
    expiry,
    // Confidence follows the document that supplied the controlling date, not
    // the one we happened to read first.
    confidence: expiry
      ? ((glDate && glDate === expiry ? gl : wcDate && wcDate === expiry ? wc : source).read.confidence || 'low')
      : 'none',
    additionalInsured,
    additionalInsuredEvidence: limitsSource?.read?.additionalInsuredEvidence || null,
    insuredName: (gl || wc || source).read.insuredName || null,
    producer: (gl || source).read.producer || wc?.read?.producer || null,
    limits,
    limitsOk,
    policies: { generalLiability: glDate, workersComp: wcDate },
    coverage: {
      generalLiability: glDate ? { expiry: glDate, from: gl.file?.name || null, limits } : null,
      workersComp:      wcDate ? { expiry: wcDate, from: wc.file?.name || null } : null,
    },
    missingCoverage,
    needsAttribution,
    sources: {
      generalLiability: gl?.file?.name || null,
      workersComp:      wc?.file?.name || null,
      controlling:      (glDate && glDate === expiry ? gl : wcDate && wcDate === expiry ? wc : source)?.file?.name || null,
    },
    files: usable.map(e => e.file?.name).filter(Boolean),
    combined: !!(glDate && wcDate && gl.file?.id !== wc.file?.id),
    readVia: read.method || null,
    // A sub with one good certificate and one unreadable file is not an
    // unreadable sub, but somebody still has to hear about the second file.
    readError: expiry ? (failures.length ? failures.join(' ') : null) : (failures[0] || read.error || null),
    notes: notes.length ? notes.join(' ') : null,
    cacheDecision: read.cacheDecision || null,
    retryBecause: read.retryBecause || null,
  };
}

// What a single certificate covers, as a short tag for a filename or a report.
// Two certificates for the same sub on the same day are the norm when the
// carriers differ, and "Home Pro COI 2026-08-14 lipca" next to "Home Pro COI
// 2026-08-14 kemi" tells a person nothing about which one is the liability.
export function coverageLabel(read) {
  const p = read?.policies || {};
  const parts = [];
  if (p.generalLiability) parts.push('GL');
  if (p.workersComp)      parts.push('WC');
  return parts.join('+');
}
