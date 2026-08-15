// netlify/functions/lib/inbox-match.js
//
// Works out whose certificate this is, and whether it is a certificate at all.
//
// The assumption this replaces, and it was wrong: that the sender is the
// subcontractor. Of the first five documents to arrive in Cole's label, three
// came from somebody else entirely.
//
//   goodnightplumbing@gmail.com     the sub, replying to us
//   oliviagower@lipca.com           their insurance agent, naming nobody
//   agent@agencyinbox.com           an agent, sub named in the subject
//   bluegrassbookkeeper@gmail.com   a bookkeeper, sub named in the subject
//   notification@kemi.com           the carrier, sub named nowhere
//
// So there are five routes to an answer, tried strongest first, and which one
// produced the match is recorded. A certificate filed under the wrong sub is
// worse than one filed under nobody: it makes an uninsured sub look covered.
//
// Four of the five read the envelope and are free. The fifth opens the document
// and reads the insured name off it, which costs a document read and is the
// only thing that can identify the two above that name nobody.

import { matchSub, normalizeName } from './compliance-docs.js';
import { readCertificate, readW9 } from './doc-ai.js';

// ── What sort of document ────────────────────────────────────────────────
const W9_HINT  = /\bw-?9\b/i;
const COI_HINT = /\b(coi|certificate of (liability )?insurance|acord|insurance cert)/i;

export function documentKind({ filename, subject, body }) {
  const hay = `${filename || ''} ${subject || ''}`;
  // The filename and subject are checked before the body, because a covering
  // note that says "here is the W9 you asked for, and the COI is coming" would
  // otherwise label the attached certificate a W9.
  if (W9_HINT.test(hay))  return 'w9';
  if (COI_HINT.test(hay)) return 'coi';

  const b = String(body || '').slice(0, 500);
  if (W9_HINT.test(b))  return 'w9';
  if (COI_HINT.test(b)) return 'coi';

  // An ACORD form is the standard certificate and its filenames are unhelpful
  // ("acord_25__2016-03_.pdf"), but that string is itself the tell.
  if (/acord/i.test(filename || '')) return 'coi';
  return 'unknown';
}

// ── Whose is it ──────────────────────────────────────────────────────────
// threadsBySub: Map(gmail_thread_id -> { subId, subName }) built from the
//               compliance_requests we sent, which is the only fully reliable
//               link between a message and a subcontractor.
// subs:         [{ id, name, email }]
export function matchDocument({ message, threadsBySub, subs }) {
  // 1. The thread. We sent it, they replied, there is nothing to infer.
  const viaThread = threadsBySub?.get(message.threadId);
  if (viaThread) {
    return { ...viaThread, via: 'thread', confidence: 'high' };
  }

  // 2. The sender's address against the address we hold. Exact, so an agent
  //    writing from their own domain never matches by accident.
  const from = String(message.from?.email || '').toLowerCase();
  if (from) {
    const bySender = subs.find(s => s.email && s.email.toLowerCase() === from);
    if (bySender) return { subId: bySender.id, subName: bySender.name, via: 'sender', confidence: 'high' };
  }

  // 3. The subject line. This is how an agent identifies their client:
  //    "Certificate of Insurance for Firm Foundations LLC". Runs through the
  //    same conservative matcher the Drive filenames use, which refuses an
  //    ambiguous result rather than guessing between two similar names.
  const subject = message.subject || '';
  if (normalizeName(subject)) {
    const m = matchSub(subject, subs);
    if (m) return { subId: m.sub.id, subName: m.sub.name, via: 'subject', confidence: m.score >= 0.9 ? 'high' : 'low' };
  }

  // 4. The sender's display name, which is sometimes the firm rather than a
  //    person: "Home Pro Pest Control <...>".
  const fromName = message.from?.name || '';
  if (normalizeName(fromName)) {
    const m = matchSub(fromName, subs);
    if (m) return { subId: m.sub.id, subName: m.sub.name, via: 'from_name', confidence: m.score >= 0.9 ? 'high' : 'low' };
  }

  // Nothing in the envelope says who this is. The document itself still can,
  // and the compliance reader already answers that question, so this is not a
  // failure. It is a handoff.
  return { subId: null, subName: null, via: null, confidence: 'none' };
}

// A short line for a person reading the report, since "via: from_name" means
// nothing to anybody who has not read this file.
export function explainMatch(match, message) {
  switch (match.via) {
    case 'thread':    return 'replied to the request we sent';
    case 'sender':    return `sent from ${message.from?.email}, which is the address on their record`;
    case 'subject':   return `named in the subject: "${message.subject}"`;
    case 'from_name': return `sender's name is "${message.from?.name}"`;
    default:          return `nothing in the email says who this belongs to. It came from ${message.from?.email || 'an unknown address'} with the subject "${message.subject || '(none)'}". Reading the document will name the insured party.`;
  }
}

// ── The document itself ──────────────────────────────────────────────────
// Cole, on the first real run: it must open the attachment and read it to pull
// out the information, then upload it labelled correctly.
//
// He is right, and the envelope routes above cannot do it. Two of the first
// five documents came from an insurance agency and from KEMI, and neither email
// names the client anywhere. Only the certificate does. Filing those as
// "Unmatched" and leaving a later sweep to relabel them means the folder is
// wrong in the meantime, and a folder that is wrong in the meantime is how a
// sub looks uninsured when they are not.
//
// So this runs when the envelope has failed, and only then: it costs a document
// read, and four out of five documents never need it.
export async function identifyFromDocument({ bytes, filename, mimeType, kind, subs }) {
  const file = { name: filename, mimeType };
  try {
    const read = kind === 'w9'
      ? await readW9({ bytes, file })
      : await readCertificate({ bytes, file });

    // A W9 gives a legal name and often a DBA. The DBA is usually what everyone
    // calls the firm, so both are worth trying.
    const names = kind === 'w9'
      ? [read.businessName, read.name]
      : [read.insuredName];

    for (const n of names.filter(Boolean)) {
      const m = matchSub(n, subs);
      if (m) {
        return {
          subId: m.sub.id, subName: m.sub.name,
          via: 'document', confidence: m.score >= 0.9 ? 'high' : 'low',
          readAs: n, read,
        };
      }
    }
    // Read successfully and still nobody. That is a real answer: the insured
    // party has no row in the Subcontractors database. Worth reporting as such
    // rather than as a failure to read.
    return { subId: null, subName: null, via: null, confidence: 'none', readAs: names.find(Boolean) || null, read };
  } catch (err) {
    return { subId: null, subName: null, via: null, confidence: 'none', readError: err.message };
  }
}
