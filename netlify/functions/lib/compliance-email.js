// netlify/functions/lib/compliance-email.js
//
// Builds the outbound emails that chase a subcontractor's compliance documents:
// a current certificate of insurance naming Six Arrows as additionally insured,
// and a W9 on file.
//
// Deterministic. Every sentence is assembled from what is actually known about
// the sub and the task. Nothing is generated, so nothing can be invented about
// a policy, a date or a scope.
//
// Voice is Cole's: direct, professional, no padding. No em dashes anywhere,
// including in outbound copy.

export const SIX_ARROWS_ADDRESS = [
  'Six Arrows Construction',
  'PO Box 10059',
  'Bowling Green, KY 42102',
].join('\n');

export const FROM_NAME  = 'Cole Borders';
export const FROM_EMAIL = 'cole@sixarrowsconstruction.com';

// How the chase escalates. Bounded on purpose: these are relationships Six
// Arrows depends on, so the system asks a small number of times and then hands
// the problem to a person rather than emailing indefinitely.
//
// Every number here is BUSINESS days. A subcontractor's agent does not issue
// certificates on a Saturday, so counting the weekend against them produces a
// follow-up that arrives before anybody could have acted on the first email.
// Three calendar days from a Thursday is Sunday; three business days is
// Tuesday, which is when a person would actually have chased it.
export const ESCALATION = {
  followUpDays:   [3, 7],   // business days after the previous email
  maxEmails:      3,        // initial + 2 follow-ups, ever, per sub per doc
  // The ladder reaches its third email 10 business days after the first, so an
  // escalation set at 10 fired on the same day and the third email could never
  // be sent at all. maxEmails said three and the system sent two. 15 leaves the
  // last follow-up a week to work before a person takes it over.
  escalateAfter:  15,       // business days after the first request
  escalateWithin: 2,        // or this many business days before start
};

// Business days between two dates, counting the end and not the start, so
// Friday to Monday is 1.
//
// Federal holidays are not handled. Adding them means a calendar that has to
// be maintained every year, and the cost of being wrong is one follow-up email
// arriving a day early, which is not worth that.
export function businessDaysBetween(fromISO, toISO) {
  const from = Date.parse(String(fromISO).slice(0, 10) + 'T00:00:00Z');
  const to   = Date.parse(String(toISO).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (to === from) return 0;

  const sign = to > from ? 1 : -1;
  let n = 0;
  // Bounded so a bad date cannot spin. Nothing here reasons past a year out.
  for (let t = from, i = 0; t !== to && i < 800; i++) {
    t += sign * 86_400_000;
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) n += sign;
  }
  return n;
}

export function isBusinessDay(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z').getUTCDay();
  return d !== 0 && d !== 6;
}

// "Eric Haley" becomes "Eric". Per Cole: these are people he has worked with
// for years and greeting them by their full name reads like a mail merge.
//
// Deliberately just the first word. All 65 Contact Name values in the
// Subcontractors database were checked and every one is either "First Last" or
// a bare first name: no company names, no "Last, First", no titles. Parsing for
// cases that do not occur is how a real name eventually gets mangled, so this
// stays as simple as the data allows. If a company name ever lands in that
// field it will greet somebody as "Hi Goodnight's," which is why the sweep
// report now prints the contact for every sub.
export function firstName(full) {
  const s = String(full ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.split(' ')[0].replace(/[,;:]+$/, '') || null;
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// What is actually missing, phrased as the sub would need to hear it. The
// explanatory aside belongs in the first email only; repeating "we do not have
// one on file for you" in a third follow-up reads as talking down to them.
function needsClause({ coiState, coiExpiry, needsW9 }, terse = false) {
  const parts = [];
  if (coiState === 'expired') {
    const on = fmtDate(coiExpiry);
    parts.push(terse || !on
      ? 'an updated certificate of insurance'
      : `an updated certificate of insurance (the one we have expired ${on})`);
  } else if (coiState === 'missing') {
    parts.push('a certificate of insurance');
  }
  if (needsW9) parts.push('a current W9');
  return parts;
}

// Per Cole: the subject says what is needed and stops. No project, no task, no
// date. A sub who works on three of our jobs does not need to be told which one
// prompted this, because the certificate covers all of them anyway.
export function buildSubject({ coiState, needsW9 }) {
  // "Updated" is wrong when there was never one to update.
  if (coiState !== 'ok' && needsW9) return 'Insurance certificate and W9 needed';
  if (needsW9)                      return 'W9 needed';
  if (coiState === 'expired')       return 'Updated insurance certificate needed';
  return 'Insurance certificate needed';
}

// attempt: 1 = initial request, 2+ = follow-up. The follow-ups get shorter and
// more direct rather than repeating the whole message.
//
// The email says what we need and how to send it, and nothing else. Cole's
// call, and it is the right one: naming the project and the task turns a
// standing requirement into a negotiation about one job. A certificate is
// something a sub has to carry to work for us at all, not a condition attached
// to Thursday's rough-in, and the version that named the task invited the reply
// "we can sort it out when we get closer".
//
// projectName, taskName and startDate are deliberately not parameters. Leaving
// them in the signature unused would read as an oversight and invite somebody
// to put them back into a sentence.
export function buildBody({ contactName, coiState, coiExpiry, needsW9, attempt = 1 }) {
  const needs = needsClause({ coiState, coiExpiry, needsW9 }, attempt > 1);
  if (!needs.length) return null;              // nothing to ask for

  const first = firstName(contactName);
  const L = [];
  L.push(first ? `Hi ${first},` : 'Hi,');
  L.push('');

  if (attempt === 1) {
    L.push(`We need ${joinList(needs)} on file.`);
    L.push('');

    if (coiState !== 'ok') {
      L.push('Please have your agent send a current certificate listing Six Arrows Construction as additionally insured:');
      L.push('');
      L.push(SIX_ARROWS_ADDRESS);
      L.push('');
    }
    if (needsW9) {
      L.push(coiState !== 'ok'
        ? 'You can send the W9 to this same address or reply to this email with it attached.'
        : 'You can reply to this email with the W9 attached.');
      L.push('');
    }

    L.push(coiState !== 'ok'
      ? 'Let me know if you need anything from us to get it issued.'
      : 'Let me know if you need anything from us.');
  } else {
    // Follow-up. Assume they read the first one; do not re-explain.
    L.push(`Following up on ${joinList(needs)}. We still do not have ${needs.length > 1 ? 'them' : 'it'}.`);

    if (coiState !== 'ok') {
      L.push('');
      L.push('Certificate holder, listed as additionally insured:');
      L.push('');
      L.push(SIX_ARROWS_ADDRESS);
    }
    L.push('');
    L.push('If you have already sent it, let me know and I will track it down on our end.');
  }

  L.push('');
  L.push('Thanks,');
  L.push(FROM_NAME);
  L.push('Six Arrows Construction');

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Asking for a corrected certificate ────────────────────────────────────
//
// The case this covers: the certificate is current, the limits may be fine, and
// Six Arrows is named as the certificate HOLDER but not as an ADDITIONAL
// INSURED on the general liability policy. Those two look almost identical on
// an ACORD form and mean completely different things. Holder means they sent us
// a copy. Additional insured means we are covered under their policy.
//
// This was reported as `review` and deliberately never sent until Cole approved
// the wording, because telling a subcontractor their paperwork is wrong on the
// strength of one automated read is the kind of message that damages a
// relationship if it is wrong.
//
// Two things it deliberately does not do. It does not say the sub did anything
// wrong: nine times out of ten their agent issued a holder-only certificate
// because that is the default, and the sub has never seen the distinction. And
// it does not ask the sub to fix it, because they cannot. Only the agent can
// reissue, so the message is written to be forwarded.
export function buildCorrectionSubject() {
  return 'Correction needed on insurance certificate';
}

export function buildCorrectionBody({ contactName, insuredName, expiry }) {
  const first = firstName(contactName);
  const L = [];

  L.push(first ? `Hi ${first},` : 'Hi,');
  L.push('');
  L.push('Thanks for sending the certificate over. There is one correction we need before we can put it on file.');
  L.push('');
  L.push('Six Arrows Construction is listed as the certificate holder, but not as an additional insured on the general liability policy. We need both. Your agent can reissue it with that added.');
  L.push('');
  L.push('The wording to give them:');
  L.push('');
  L.push('    Six Arrows Construction is named as an additional insured');
  L.push('    on the general liability policy.');
  L.push('');
  L.push(SIX_ARROWS_ADDRESS);
  L.push('');
  // The expiry tells them nothing needs renewing, which heads off the most
  // common reply: "that certificate is current, I just sent it".
  if (expiry) {
    L.push(`Everything else looks right, and the policy runs to ${fmtDate(expiry)}, so this should just be a reissue rather than anything new.`);
  } else {
    L.push('Everything else looks right, so this should just be a reissue rather than anything new.');
  }
  L.push('');
  L.push('Forward this along to them if it is easier, and let me know if you hit a snag.');
  L.push('');
  L.push('Thanks,');
  L.push(FROM_NAME);
  L.push('Six Arrows Construction');

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Decides whether an email is due, and which one. Returns null when nothing
// should be sent, which is the common case on any given day.
//
// history: prior sends for this sub + doc set, newest first,
//          [{ sent_at, attempt }]
// Every interval is measured in business days. See ESCALATION above for why.
export function nextAction({ history = [], startDate, today = new Date().toISOString().slice(0, 10) }) {
  const sent = history.length;

  if (sent >= ESCALATION.maxEmails) {
    return { action: 'escalate', reason: `already sent ${sent} requests with no document` };
  }

  // Escalation is a decision, not an email, so it stands on a weekend. Sending
  // does not: an email that lands on a subcontractor's Saturday is either
  // ignored until Monday or read as us not knowing what day it is, and either
  // way it burns one of the three we are ever going to send.
  const canSendToday = isBusinessDay(today);

  const daysTo = startDate ? businessDaysBetween(today, startDate) : null;

  if (!sent) return canSendToday ? { action: 'send', attempt: 1 } : null;

  const firstSent  = history[history.length - 1].sent_at.slice(0, 10);
  const lastSent   = history[0].sent_at.slice(0, 10);
  const sinceFirst = businessDaysBetween(firstSent, today);
  const sinceLast  = businessDaysBetween(lastSent,  today);

  // Stop emailing and hand it to a person once we are out of runway, whether
  // that is elapsed time or the start date arriving.
  if (sinceFirst != null && sinceFirst >= ESCALATION.escalateAfter) {
    return { action: 'escalate', reason: `${sinceFirst} business days since the first request` };
  }
  if (daysTo != null && daysTo <= ESCALATION.escalateWithin) {
    return { action: 'escalate', reason: `work starts in ${daysTo} business day(s) and the document is still missing` };
  }

  if (!canSendToday) return null;

  const dueAfter = ESCALATION.followUpDays[sent - 1];
  if (dueAfter != null && sinceLast != null && sinceLast >= dueAfter) {
    return { action: 'send', attempt: sent + 1 };
  }

  return null;
}
