// netlify/functions/lib/doc-ai.js
//
// Reads a compliance document with Claude instead of a regular expression.
//
// Why this exists: a certificate of insurance is a form, but it is a form that
// arrives as a scan, a phone photo, a re-print from a different agency's
// template, or a PDF whose text layer is a picture. Pattern matching handles
// maybe two thirds of them, and the third it cannot handle is exactly the
// third somebody would otherwise have to open by hand.
//
// It also answers a question no regular expression can: is Six Arrows
// Construction actually listed as additionally insured, or does the
// certificate merely name Six Arrows as the holder? Those look identical in
// extracted text and mean very different things.
//
// Deliberately narrow. This reads one document and returns what it saw. It
// does not decide anything, does not write anywhere, and never throws: an
// unreadable document comes back as a result with a reason attached, because
// the caller has to be able to tell "we could not read it" apart from "the
// reader crashed".

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Overridable because this is the one lever on cost. Reads are cached by file
// and modification time, so in steady state this runs on new documents only,
// which is a handful a month.
export const READER_MODEL = process.env.COI_READER_MODEL || 'claude-opus-5';

// What the Messages API will accept as an image. HEIC is the notable absence,
// and phone cameras produce it by default, so it gets named in the failure
// message rather than being reported as a generic bad file.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
// The API's limits differ by block type, and they are not the same number.
// A PDF may be 32 MB. An image is capped at 10 MB *after* base64 encoding,
// which inflates by a third, so the real ceiling on a photo is about 7.5 MB.
// Sending a bigger one comes back as a 400 that reads like a malformed
// request rather than a file that is simply too large.
const MAX_PDF_BYTES   = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 7_500_000;

// What Six Arrows requires on a general liability policy. A certificate that
// is current and names Six Arrows correctly is still not acceptable if the
// limits are short, and that is invisible unless somebody reads the numbers.
export const REQUIRED_EACH_OCCURRENCE = 1_000_000;
export const REQUIRED_AGGREGATE       = 2_000_000;

export function anthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ── Per-run budget ────────────────────────────────────────────────────────
// Reading a document takes several seconds, and a request has tens of seconds
// before the platform cuts it off. The first sweep after this ships will meet a
// backlog of scans that have never been read, and trying to clear the whole
// backlog inside one request would time out and clear none of it.
//
// So each run reads a few and stops. Results are cached, the sweep runs daily,
// and the backlog drains over a handful of days without anyone doing anything.
// A manual run can raise the ceiling to push it through in one go.
//
// Module state survives a warm container, so callers reset this at the top of
// every invocation rather than trusting it to start at zero.
let budget = 6;
let used   = 0;

export function setReadBudget(n) {
  budget = Number.isFinite(n) && n >= 0 ? n : 6;
  used   = 0;
}
export function readsUsed()  { return used; }
export function readsLeft()  { return Math.max(0, budget - used); }

// Drive's mimeType is usually right but not always, so fall back to the
// extension rather than refusing a readable document over a metadata quirk.
function classify(file = {}) {
  const name = String(file.name || '');
  const mt   = String(file.mimeType || '').toLowerCase();
  const ext  = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

  if (mt === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', mediaType: 'application/pdf' };
  if (IMAGE_TYPES.has(mt))                       return { kind: 'image', mediaType: mt };

  const byExt = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif',  webp: 'image/webp',
  }[ext];
  if (byExt) return { kind: 'image', mediaType: byExt };

  if (mt.includes('heic') || mt.includes('heif') || ext === 'heic' || ext === 'heif') {
    return { kind: null, why: `${name} is a HEIC photo, which the reader cannot open. Re-save it as a PDF or JPEG in Drive.` };
  }
  return { kind: null, why: `${name} is a ${mt || ext || 'unknown'} file, which is neither a PDF nor an image the reader can open.` };
}

const COI_PROMPT = `You are reading a subcontractor's certificate of liability insurance for a small home builder, Six Arrows Construction.

Report only what the document shows. Never infer a date, a name or a coverage that is not printed on it. If a field is unreadable or absent, use null and say so in notes. A wrong answer here puts an uninsured crew on a job site, so an honest "I cannot tell" is always the better answer.

Two things are easy to confuse and must be kept apart:
- The CERTIFICATE HOLDER is the party the certificate was issued to. Six Arrows is almost always the holder. That alone means nothing about coverage.
- ADDITIONAL INSURED means Six Arrows is covered under the subcontractor's policy. On an ACORD form this shows as a Y in the ADDL INSD column, or as wording in the Description of Operations naming Six Arrows as additional insured. Say yes only if you can actually see one of those.

Answer with a JSON object and nothing else. No preamble, no code fence.

{
  "insured_name": string or null,
  "insured_address": string or null,
  "certificate_holder": string or null,
  "six_arrows_is_holder": true or false,
  "additional_insured": "yes" or "no" or "unclear",
  "additional_insured_evidence": string or null,
  "general_liability_each_occurrence": number or null,
  "general_liability_aggregate": number or null,
  "products_completed_ops_aggregate": number or null,
  "general_liability_expiry": "YYYY-MM-DD" or null,
  "workers_comp_expiry": "YYYY-MM-DD" or null,
  "auto_liability_expiry": "YYYY-MM-DD" or null,
  "umbrella_expiry": "YYYY-MM-DD" or null,
  "controlling_expiry": "YYYY-MM-DD" or null,
  "issue_date": "YYYY-MM-DD" or null,
  "confidence": "high" or "low",
  "notes": string
}

insured_name is the NAMED INSURED box, meaning the subcontractor. It is not the agency or broker at the top left, and it is not the holder.

The limit fields come from the LIMITS column on the general liability row. Report them as plain numbers with no commas or dollar sign, so $1,000,000 is 1000000. EACH OCCURRENCE and GENERAL AGGREGATE are separate lines and must not be swapped. If a line is blank or unreadable, use null rather than guessing.

controlling_expiry is the EARLIEST expiration among the general liability and workers compensation policies that are actually listed. Those are the two coverages that matter here. Ignore auto and umbrella when choosing it. If only one of the two is listed, use that one. If neither is listed, use null.

confidence is "high" only when you can read the insured name and at least one policy expiration clearly. Anything you had to guess at makes it "low".

notes is one short sentence for a person: what is off, missing, or worth a second look. Leave it empty if the document is clean. Do not use em dashes.`;

const W9_PROMPT = `You are reading a form W9 for a small home builder's subcontractor records.

Report only what the form shows. If a field is blank or unreadable, use null.

Answer with a JSON object and nothing else. No preamble, no code fence.

{
  "name": string or null,
  "business_name": string or null,
  "tax_classification": string or null,
  "address": string or null,
  "tin_last4": string or null,
  "signed": true or false,
  "signed_date": "YYYY-MM-DD" or null,
  "confidence": "high" or "low",
  "notes": string
}

name is line 1, the name as shown on the income tax return. business_name is line 2, the DBA, which is often the name everyone actually uses for this subcontractor.

tin_last4 is the last four digits only. Never return a full SSN or EIN.

Do not use em dashes in notes.`;

// Some failures are facts about the document: it is a HEIC, it has no dates on
// it, it is a photograph of a thumb. Those are worth remembering, because the
// answer will not change until the file does.
//
// Others are facts about the moment: the account is out of credit, the API is
// overloaded, the key is wrong, the network dropped. Remembering one of those
// as if it were a property of the document is how a perfectly readable
// certificate becomes permanently unreadable, and nobody would ever know to
// look again once the real problem was fixed.
export function isTransientFailure(status, body = '') {
  if (status >= 500) return true;                       // overloaded, upstream fault
  if (status === 429) return true;                      // rate limited
  if (status === 401 || status === 403) return true;    // key wrong or revoked
  // Billing comes back as a 400, which otherwise means "this request is bad".
  if (status === 400 && /credit balance|billing|quota|insufficient/i.test(body)) return true;
  return false;
}

// The same question asked of a cached row rather than a live response. Reads
// recorded before this distinction existed still carry the reason in their
// error text, so matching on it lets those rows heal themselves rather than
// needing to be found and cleared by hand.
const TRANSIENT_TEXT = /credit balance|billing|quota|insufficient|rate.?limit|overloaded|could not reach|Claude API (5\d\d|429|401|403)/i;
export function errorLooksTransient(text) {
  return !!text && TRANSIENT_TEXT.test(String(text));
}

// Pulls the object out of a response that may be wrapped in prose or a fence.
// Claude was told to return bare JSON and usually does, but a parse failure
// here would throw away a read that cost real money, so be forgiving.
function parseJson(text) {
  const t = String(text || '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body   = fenced ? fenced[1] : t;
  const start  = body.indexOf('{');
  const end    = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); }
  catch { return null; }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function cleanDate(v) {
  const s = String(v || '').slice(0, 10);
  if (!ISO.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  // A certificate from 1998 or 2099 is a misread, not a policy.
  const year = Number(s.slice(0, 4));
  if (year < 2000 || year > 2100) return null;
  return s;
}

function cleanStr(v, max = 200) {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

// One call. Returns { ok, data, error, usage }.
async function ask(prompt, bytes, mediaType, kind) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set, so documents cannot be read automatically.' };
  const cap = kind === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length > cap) {
    const mb = (bytes.length / 1048576).toFixed(1);
    return {
      ok: false,
      error: kind === 'pdf'
        ? `this PDF is ${mb} MB, larger than the reader accepts.`
        : `this photo is ${mb} MB, and the reader cannot open an image over 7.5 MB. Open it in Drive and re-save it smaller, or save it as a PDF.`,
    };
  }
  if (readsLeft() === 0) {
    // Deliberately not cached by the caller: this is a fact about the run, not
    // about the document, and the next run should try again.
    return { ok: false, budgetExhausted: true, error: `this run's document reading budget of ${budget} is used up. The next run will pick this one up.` };
  }
  used++;

  const doc = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }
    : { type: 'image',    source: { type: 'base64', media_type: mediaType,        data: Buffer.from(bytes).toString('base64') } };

  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      // The document goes first: the model reads better when the page is in
      // front of it before the instructions arrive.
      body: JSON.stringify({
        model: READER_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: [doc, { type: 'text', text: prompt }] }],
      }),
    });
  } catch (err) {
    return { ok: false, transient: true, error: `could not reach the Claude API: ${err.message}` };
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    return { ok: false, transient: isTransientFailure(res.status, body), error: `Claude API ${res.status}: ${body}` };
  }

  const payload = await res.json();
  const text = (payload.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  const data = parseJson(text);
  if (!data) return { ok: false, error: `the reader replied but not with usable JSON: ${text.slice(0, 200)}` };

  return { ok: true, data, usage: payload.usage || null, model: payload.model || READER_MODEL };
}

// ── Certificates of insurance ─────────────────────────────────────────────
// Returns the same shape whatever happens, so callers never branch on
// exceptions:
//   { expiry, confidence, method, insuredName, additionalInsured,
//     sixArrowsIsHolder, policies, notes, error, raw }
export async function readCertificate({ bytes, file = {} }) {
  const blank = {
    expiry: null, confidence: 'none', method: 'ai',
    insuredName: null, additionalInsured: 'unclear', sixArrowsIsHolder: false,
    policies: {}, notes: null, raw: null,
  };

  const { kind, mediaType, why } = classify(file);
  if (!kind) return { ...blank, error: why };

  const r = await ask(COI_PROMPT, bytes, mediaType, kind);
  if (!r.ok) return { ...blank, error: r.error, budgetExhausted: !!r.budgetExhausted, transient: !!r.transient };

  const d = r.data;
  const money = v => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    // A limit under ten thousand is a misread of the deductible column, not a
    // policy limit, and reporting it would fail a compliant subcontractor.
    return Number.isFinite(n) && n >= 10_000 ? Math.round(n) : null;
  };

  const policies = {
    generalLiability: cleanDate(d.general_liability_expiry),
    workersComp:      cleanDate(d.workers_comp_expiry),
    autoLiability:    cleanDate(d.auto_liability_expiry),
    umbrella:         cleanDate(d.umbrella_expiry),
    eachOccurrence:   money(d.general_liability_each_occurrence),
    aggregate:        money(d.general_liability_aggregate),
    productsCompletedOps: money(d.products_completed_ops_aggregate),
  };

  // Three states, not two. A limit that could not be read is not a limit that
  // is too low, and only one of those is the subcontractor's problem.
  const limitsOk =
    policies.eachOccurrence == null || policies.aggregate == null
      ? 'unknown'
      : (policies.eachOccurrence >= REQUIRED_EACH_OCCURRENCE &&
         policies.aggregate     >= REQUIRED_AGGREGATE) ? 'yes' : 'no';

  // Trust the model's controlling date only if it is one of the dates it also
  // reported. Recomputing it here from general liability and workers comp is
  // cheap insurance against a reasonable-looking date that came from nowhere.
  const required = [policies.generalLiability, policies.workersComp].filter(Boolean);
  const derived  = required.length ? required.slice().sort()[0] : null;
  const stated   = cleanDate(d.controlling_expiry);
  const expiry   = derived || stated;

  const ai = String(d.additional_insured || 'unclear').toLowerCase();
  const additionalInsured = ['yes', 'no', 'unclear'].includes(ai) ? ai : 'unclear';

  const notes = [
    cleanStr(d.notes, 400),
    stated && derived && stated !== derived
      ? `The reader called ${stated} the controlling date; general liability and workers comp put it at ${derived}, which is what was used.`
      : null,
  ].filter(Boolean).join(' ') || null;

  return {
    expiry,
    // Without a date there is nothing to be confident about, whatever the
    // model said about itself.
    confidence: expiry ? (String(d.confidence) === 'high' ? 'high' : 'low') : 'none',
    method: 'ai',
    insuredName:       cleanStr(d.insured_name),
    additionalInsured,
    additionalInsuredEvidence: cleanStr(d.additional_insured_evidence, 300),
    sixArrowsIsHolder: !!d.six_arrows_is_holder,
    certificateHolder: cleanStr(d.certificate_holder),
    policies,
    limitsOk,
    issueDate: cleanDate(d.issue_date),
    notes,
    error: expiry ? null : 'the reader opened the document but found no policy expiration on it.',
    model: r.model,
    usage: r.usage,
    raw: d,
  };
}

// ── W9s ───────────────────────────────────────────────────────────────────
// Only the identifying fields. The value here is the name: a W9 says who this
// firm actually is, which is better evidence than the filename somebody typed.
export async function readW9({ bytes, file = {} }) {
  const blank = { name: null, businessName: null, signed: false, confidence: 'none', method: 'ai', notes: null, raw: null };

  const { kind, mediaType, why } = classify(file);
  if (!kind) return { ...blank, error: why };

  const r = await ask(W9_PROMPT, bytes, mediaType, kind);
  if (!r.ok) return { ...blank, error: r.error, budgetExhausted: !!r.budgetExhausted, transient: !!r.transient };

  const d = r.data;
  return {
    name:         cleanStr(d.name),
    businessName: cleanStr(d.business_name),
    address:      cleanStr(d.address, 300),
    // Four digits, never more. If the model returned a whole number by
    // mistake, do not store it.
    tinLast4:     /^\d{4}$/.test(String(d.tin_last4 || '')) ? String(d.tin_last4) : null,
    signed:       !!d.signed,
    signedDate:   cleanDate(d.signed_date),
    confidence:   String(d.confidence) === 'high' ? 'high' : 'low',
    method:       'ai',
    notes:        cleanStr(d.notes, 400),
    error:        null,
    model:        r.model,
    usage:        r.usage,
    raw:          d,
  };
}
