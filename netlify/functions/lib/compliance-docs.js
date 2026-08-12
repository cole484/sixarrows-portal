// netlify/functions/lib/compliance-docs.js
//
// Reads the two Google Drive folders where Six Arrows keeps subcontractor
// compliance documents, matches each file to a row in the Subcontractors DB,
// and pulls the policy expiration date out of each certificate of insurance.
//
// Folders must be shared as "anyone with the link", same constraint as
// drive-photos.js, because this authenticates with a plain API key.
//
// Two jobs that fail independently on purpose:
//   listing + matching  cheap, reliable, and enough to answer "do we have
//                       anything at all for this sub?"
//   expiry extraction   downloads and parses a PDF, so it can fail for one
//                       document without taking the sweep down. A failure
//                       yields confidence 'none' and gets flagged for a human
//                       rather than guessed at.

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

export const COI_FOLDER_ID = process.env.COI_FOLDER_ID || '1B2bl0ubX8RvhjmhksIa9Yg1fKW5mH-h2';
export const W9_FOLDER_ID  = process.env.W9_FOLDER_ID  || '1hFgbzng4TG-cekOYa6t3ihgle7WfnrY1';

// ── Drive ─────────────────────────────────────────────────────────────────
export async function listFolder(folderId, apiKey) {
  const out = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size)',
      pageSize: '200',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${DRIVE_FILES}?${params}`);
    if (!res.ok) throw new Error(`Drive list ${folderId}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < 1000);
  return out;
}

async function downloadFile(fileId, apiKey) {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&key=${apiKey}`);
  if (!res.ok) throw new Error(`Drive download ${fileId}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Name matching ─────────────────────────────────────────────────────────
// Drive filenames and Notion sub names disagree constantly: "Artisan
// Electric.pdf" vs "Artisan Electrical", "Angry Daves Plumbing" vs "Angry
// Dave's Plumbing", "Thomas Waldemar DBA Benny Waldemar Construction".
// Normalize hard, then match on containment in either direction.
const NOISE = /\b(llc|inc|incorporated|co|company|dba|the|and|of|coi|w9|w-9|certificate|insurance|workers|comp|form)\b/g;

// Certificates are frequently named for the certificate holder rather than the
// insured party, e.g. "Dan Kuhns COI for Six Arrows.pdf". Left in, that phrase
// matches Six Arrows itself and credits the wrong party with the policy.
const HOLDER = /\bfor six arrows( construction)?\b|\bsix arrows construction\b/g;

// Trade words appear in a third of these names. They are useful corroboration
// but must never carry a match alone: "plumbing" is shared by four different
// plumbers, and matching on it credits one sub with another's certificate.
const GENERIC = new Set([
  'plumbing', 'electric', 'electrical', 'construction', 'painting', 'paint',
  'drywall', 'insulation', 'insulators', 'concrete', 'roofing', 'masonry',
  'landscape', 'landscaping', 'tile', 'flooring', 'hardwood', 'cleaning',
  'cleanup', 'clean', 'demolition', 'services', 'service', 'contractors',
  'contractor', 'builds', 'building', 'builders', 'custom', 'home', 'homes',
  'heating', 'cooling', 'granite', 'guttering', 'gutters', 'interiors',
  'surveying', 'moving', 'carpets', 'tree', 'repair',
]);

export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')     // strip file extension
    .replace(/[^a-z0-9\s]/g, ' ')          // punctuation, apostrophes, ampersands
    .replace(HOLDER, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Spaces are unreliable in these names: "Vanmeter Slavey" versus "Van Meter &
// Slavey, LLC" are the same firm. Comparing a space-stripped form catches that
// without loosening anything else.
function compact(s) {
  return normalizeName(s).replace(/\s/g, '');
}

function distinctive(name) {
  return new Set(normalizeName(name).split(' ').filter(t => t.length >= 3 && !GENERIC.has(t)));
}

function scorePair(fileName, subName) {
  const f = normalizeName(fileName);
  const n = normalizeName(subName);
  if (!f || !n) return 0;

  if (f === n) return 1.0;

  const fc = compact(fileName);
  const nc = compact(subName);
  if (fc && nc && fc === nc) return 0.97;

  // Containment only counts on a substantial string. Requiring 8 characters
  // stops a short generic name being "contained" in everything.
  if (fc.length >= 8 && nc.length >= 8 && (fc.includes(nc) || nc.includes(fc))) return 0.9;

  const fTok = distinctive(fileName);
  const nTok = distinctive(subName);
  if (!fTok.size || !nTok.size) return 0;     // nothing distinctive to go on

  let shared = 0;
  for (const t of nTok) if (fTok.has(t)) shared++;
  if (!shared) return 0;

  // Denominator is the smaller set, so "Marcous Jones.pdf" still matches
  // "Jones construction clean up & demolition" on the one word that actually
  // identifies them. The Likens / C&A crossing is prevented upstream by the
  // generic list: "C&A Plumbing" has no distinctive token at all once the
  // trade word is excluded, so it never reaches this branch. Using the larger
  // set here as well was overcorrection, and it broke real matches.
  //
  // Capped below an exact or compact match so a name that genuinely is the
  // same always outranks one that merely shares a word.
  return 0.88 * (shared / Math.min(fTok.size, nTok.size));
}

// Returns the best matching sub, or null. Deliberately conservative in two
// ways: a minimum score, and a required margin over the runner-up. A wrong
// match writes "insured" onto a sub who is not, which is worse than no match
// at all, and an ambiguous result is a wrong match waiting to happen.
export function matchSub(fileName, subs) {
  if (!normalizeName(fileName)) return null;

  const scored = subs
    .map(sub => ({ sub, score: scorePair(fileName, sub.name) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const [best, runnerUp] = scored;
  if (best.score < 0.75) return null;

  // Two subs scoring within a hair of each other means the name does not
  // actually identify one of them. Refuse, and let a person look.
  if (runnerUp && best.score - runnerUp.score < 0.08) {
    return null;
  }

  return { sub: best.sub, score: best.score };
}

// ── COI expiry ────────────────────────────────────────────────────────────
const DATE_RE = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/((?:19|20)\d{2})\b/g;

function toISO(m, d, y) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// An ACORD certificate lists each policy as an effective/expiration pair, and
// also carries an issue date near the top. Taking the latest date on the page
// would be wrong: it could pick up something that is not an expiry and mark a
// dead certificate as live, which is the dangerous direction to err in.
//
// So: find adjacent date pairs that look like a policy term (later date, 5 to
// 26 months apart) and take the latest expiry among those.
export function extractCoiExpiry(text) {
  const dates = [];
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(text)) !== null) {
    dates.push(toISO(m[1], m[2], m[3]));
  }
  if (dates.length < 2) return { expiry: null, confidence: 'none', found: dates.length };

  const DAY = 86_400_000;
  const expiries = [];
  for (let i = 0; i < dates.length - 1; i++) {
    const a = Date.parse(dates[i] + 'T00:00:00Z');
    const b = Date.parse(dates[i + 1] + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const span = (b - a) / DAY;
    if (span >= 150 && span <= 800) expiries.push(dates[i + 1]);
  }

  if (!expiries.length) return { expiry: null, confidence: 'none', found: dates.length };

  expiries.sort();
  return {
    expiry: expiries[expiries.length - 1],
    confidence: expiries.length >= 2 ? 'high' : 'low',
    found: dates.length,
  };
}

// Downloads and parses one certificate. Never throws: a document this cannot
// read becomes confidence 'none' with the reason attached, so the sweep keeps
// going and a person gets told which file needs eyes on it.
export async function readCoiExpiry(fileId, apiKey, file = {}) {
  // Plenty of certificates are phone photos. There is no expiry to read out of
  // a HEIC, and "Invalid PDF structure" describes the symptom rather than the
  // situation, which sends people looking for a corrupt file.
  const isPdf = file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (file.name && !isPdf) {
    return {
      expiry: null, confidence: 'none', found: 0,
      error: `this certificate is an image (${file.name}), not a PDF, so the expiry cannot be read automatically. Enter COI Expiration by hand or replace it with a PDF.`,
    };
  }

  try {
    const bytes = await downloadFile(fileId, apiKey);
    const { extractText } = await import('unpdf');
    const { text } = await extractText(bytes, { mergePages: true });
    const raw = String(text || '');

    // A scanned certificate is a picture of a document: pdfjs finds almost no
    // text because there is no text layer to find. That is a different problem
    // from a readable document with no dates in it, and it has a different
    // fix, so do not report them the same way.
    if (raw.replace(/\s/g, '').length < 200) {
      return {
        expiry: null, confidence: 'none', found: 0, scanned: true,
        error: 'this certificate appears to be a scan or photo with no selectable text, so the expiry cannot be read automatically. Enter COI Expiration by hand, or ask the agent for a text PDF.',
      };
    }

    const result = extractCoiExpiry(raw);
    if (!result.expiry) {
      return { ...result, error: `the document text was readable (${raw.length} characters) but no policy term was found in it. Worth opening by hand.` };
    }
    return result;
  } catch (err) {
    return { expiry: null, confidence: 'none', found: 0, error: err.message };
  }
}

// Where the certificate stands. Four states, not three, because "we have no
// certificate for you" and "we have your certificate but our parser choked on
// it" must never produce the same outcome.
//
// Telling a sub who sent a certificate that we do not have one is the single
// most damaging thing this system could say, so 'unreadable' exists and never
// results in an email to the sub. It goes to a person to open by hand.
//
//   missing     no file matched this sub at all
//   unreadable  a file matched, but no expiry could be extracted from it
//   expired     parsed, and the policy term has passed
//   ok          parsed, and still in force
export function coiState(expiry, asOf = new Date().toISOString().slice(0, 10), hasFile = false) {
  if (expiry) return expiry < asOf.slice(0, 10) ? 'expired' : 'ok';
  return hasFile ? 'unreadable' : 'missing';
}
