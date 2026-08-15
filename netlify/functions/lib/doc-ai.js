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
- ADDITIONAL INSURED means Six Arrows is covered under the subcontractor's policy. Six Arrows only requires this on the GENERAL LIABILITY policy, so judge it on that row alone. Ignore the ADDL INSD column on the auto, umbrella and workers compensation rows entirely. On an ACORD form it shows as a Y or X in the ADDL INSD column of the general liability row, or as wording in the Description of Operations naming Six Arrows as an additional insured. Say yes only if you can actually see one of those.

Answer with a JSON object and nothing else. No preamble, no code fence.

{
  "insured_name": string or null,
  "insured_address": string or null,
  "producer_name": string or null,
  "producer_email": string or null,
  "producer_phone": string or null,
  "producer_contact": string or null,
  "certificate_holder": string or null,
  "six_arrows_is_holder": true or false,
  "additional_insured": "yes" or "no" or "unclear",   // general liability only
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

The PRODUCER is that agency or broker at the top left, the people who issued this certificate. producer_name is the firm. producer_email and producer_phone are their contact details if the form prints them, and producer_contact is the individual named if there is one. Report only what is printed. Six Arrows verifies certificates with the issuing agency, so a wrong address here sends a query to a stranger.

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

// A subcontractor's quote is not a form. Three real Johnson quotes, opened side
// by side, had almost nothing in common: one was a line-item invoice from
// accounting software, one a fill-in-the-blank sheet with a TOTAL line, one a
// typed proposal letter. Two carried the price of the job in a line called
// "Total"; the third carried most of its meaning in the paragraph above the
// price, which said that water and sewer were charged per foot and were not in
// the number at all.
//
// That paragraph is the reason this reads with Claude rather than a regular
// expression. Pulling the largest dollar figure off the page would produce a
// number for every one of these documents and would be quietly wrong about the
// one that mattered, and the way that error surfaces is a change order nobody
// budgeted for.
const QUOTE_PROMPT = `You are reading a price a subcontractor or supplier sent to a small home builder, Six Arrows Construction. It may call itself an estimate, a quote, a proposal or a bid.

Report only what the document says. Never infer a price, a date or a term that is not printed on it. If something is absent, use null.

The most important thing you can get right is the difference between a price that covers the job and a price that covers part of it. Many of these documents state a total and then, elsewhere, list work that is charged separately: priced per foot, "extra", "if needed", "by others", "not included", or added to the final invoice. If any such work exists, the total is not the whole cost and you must say so.

Answer with a JSON object and nothing else. No preamble, no code fence.

{
  "vendor_name": string or null,
  "document_type": "estimate" or "quote" or "proposal" or "invoice" or "other",
  "quote_number": string or null,
  "quote_date": "YYYY-MM-DD" or null,
  "project_reference": string or null,
  "total": number or null,
  "total_covers_whole_scope": true or false,
  "line_items": [ { "description": string, "amount": number or null } ],
  "priced_separately": [ string ],
  "exclusions": [ string ],
  "valid_until": "YYYY-MM-DD" or null,
  "validity_text": string or null,
  "scope_summary": string,
  "confidence": "high" or "low",
  "notes": string
}

total is the bottom line the vendor is asking for, as a plain number with no commas or dollar sign. If the document shows a subtotal, tax and a grand total, report the grand total. If it prices several alternatives and does not choose one, use null and explain in notes.

line_items is at most 15 entries and exists so a person can see how the price was built up, not to reproduce the document. A supplier's material takeoff can run to hundreds of rows; when that happens, group them into the handful of headings the vendor themselves used, or into obvious ones like "framing lumber" and "sheathing", and say in notes that you grouped them. Never let this list run long enough to crowd out the fields below it.

total_covers_whole_scope is false whenever any work is priced separately, charged by the foot, or called extra. Default to false when you are unsure. Saying a partial price is complete is the worst mistake available here.

priced_separately is one short line per item, in the vendor's own terms, including the rate if one is given. For example: "Water line at $5/ft if owner digs, $15/ft if we dig".

exclusions is work the vendor states they are not doing at all, as opposed to work they will do for an additional charge.

valid_until is a date the document actually prints. If it instead says something like "good for 90 days" or "expires in 10 days", leave valid_until null and put that wording in validity_text.

scope_summary is two or three sentences describing what this vendor is being paid to do, written so a project manager could put it on a work order.

Do not use em dashes anywhere in your answer.`;

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
// "ran out of room" and "not with usable JSON" are here because they are facts
// about a request rather than about a document. Three of the first Johnson
// quotes were recorded that way before the allowance was raised, and matching
// on the wording is what lets those rows heal on the next run rather than
// needing to be found and cleared by hand.
const TRANSIENT_TEXT = /credit balance|billing|quota|insufficient|rate.?limit|overloaded|could not reach|ran out of room|not with usable JSON|Claude API (5\d\d|429|401|403)/i;
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
async function ask(prompt, bytes, mediaType, kind, maxTokens = 2000) {
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
        max_tokens: maxTokens,
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
  if (!data) {
    // A lumber takeoff can run to two hundred line items, and transcribing all
    // of them ran the answer off the end of its token allowance mid-object.
    // That looks identical to a model that ignored the format instruction, and
    // the two have completely different fixes, so say which one happened.
    const cut = payload.stop_reason === 'max_tokens';
    return {
      ok: false,
      error: cut
        ? `the reader ran out of room before finishing its answer. This document has more detail on it than the allowance of ${maxTokens} tokens covers.`
        : `the reader replied but not with usable JSON: ${text.slice(0, 200)}`,
      // Room is a property of the request, not of the file. Reading it again
      // with a bigger allowance is the fix, so do not remember this as an
      // answer about the document.
      transient: cut,
    };
  }

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

  // The issuing agency. Six Arrows verifies certificates with them rather than
  // taking a forwarded PDF at face value, so these are worth pulling off every
  // certificate even though nothing else reads them.
  const producer = {
    name:    cleanStr(d.producer_name, 200),
    email:   /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(d.producer_email || '').trim())
               ? String(d.producer_email).trim().toLowerCase() : null,
    phone:   cleanStr(d.producer_phone, 40),
    contact: cleanStr(d.producer_contact, 120),
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
    producer,
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

// ── Quotes ────────────────────────────────────────────────────────────────
// Returns what the document says, never a decision about it. Whether a price
// is still good, and whether it is close enough to the budget to act on, are
// judgements made where the task and the budget are both in view.
export async function readQuote({ bytes, file = {} }) {
  const blank = {
    total: null, coversWholeScope: false, quoteDate: null, validUntil: null,
    validityText: null, scope: null, lineItems: [], pricedSeparately: [],
    exclusions: [], confidence: 'none', method: 'ai', notes: null, raw: null,
  };

  const { kind, mediaType, why } = classify(file);
  if (!kind) return { ...blank, error: why };

  // Roomier than a certificate on purpose. A supplier's quote for a framing
  // package is a takeoff, and the first three of these ran off the end of a
  // 2,000 token answer partway through the line items.
  const r = await ask(QUOTE_PROMPT, bytes, mediaType, kind, 8000);
  if (!r.ok) return { ...blank, error: r.error, budgetExhausted: !!r.budgetExhausted, transient: !!r.transient };

  const d = r.data;

  // A quote is money, so a total that came back as "$4,250.50" or with a stray
  // character is cleaned rather than refused, but anything that is not a
  // positive finite number is dropped instead of guessed at.
  const money = v => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  const lines = a => (Array.isArray(a) ? a : []).map(x => cleanStr(x, 300)).filter(Boolean).slice(0, 25);

  const quoteDate = cleanDate(d.quote_date);
  const stated    = cleanDate(d.valid_until);

  // "Good for 90 days" is the commonest way these documents express an expiry
  // and the least useful, because it needs the quote date to mean anything.
  // Computing it here is the difference between knowing a price is dead and
  // having a sentence about it.
  const validityText = cleanStr(d.validity_text, 200);
  let validUntil = stated;
  let validityDerived = false;
  if (!validUntil && quoteDate && validityText) {
    const m = validityText.match(/(\d{1,3})\s*(day|business day|week|month)/i);
    if (m) {
      const n    = Number(m[1]);
      const unit = m[2].toLowerCase();
      const days = unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n;
      const t    = Date.parse(quoteDate + 'T00:00:00Z') + days * 86400000;
      if (Number.isFinite(t)) {
        validUntil      = new Date(t).toISOString().slice(0, 10);
        validityDerived = true;
      }
    }
  }

  const total = money(d.total);
  const pricedSeparately = lines(d.priced_separately);

  // The model was told to default to false, but a total with carve-outs beside
  // it is not a whole-scope price whatever it answered, so the two are
  // reconciled here rather than trusted separately.
  const coversWholeScope = !!d.total_covers_whole_scope && pricedSeparately.length === 0;

  return {
    vendorName:  cleanStr(d.vendor_name),
    documentType: cleanStr(d.document_type, 20),
    quoteNumber: cleanStr(d.quote_number, 40),
    projectReference: cleanStr(d.project_reference, 200),
    total,
    coversWholeScope,
    lineItems: (Array.isArray(d.line_items) ? d.line_items : []).slice(0, 40)
      .map(li => ({ description: cleanStr(li?.description, 200), amount: money(li?.amount) }))
      .filter(li => li.description),
    pricedSeparately,
    exclusions: lines(d.exclusions),
    quoteDate,
    validUntil,
    validityDerived,
    validityText,
    scope: cleanStr(d.scope_summary, 1200),
    // No number means nothing to be confident about, whatever the model said.
    confidence: total == null ? 'none' : (String(d.confidence) === 'high' ? 'high' : 'low'),
    method: 'ai',
    notes: cleanStr(d.notes, 400),
    error: total == null ? 'the reader opened the document but found no price on it.' : null,
    model: r.model,
    usage: r.usage,
    raw:   d,
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
