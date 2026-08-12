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
export const ESCALATION = {
  followUpDays:   [3, 7],   // days after the initial request
  maxEmails:      3,        // initial + 2 follow-ups, ever, per sub per doc
  escalateAfter:  10,       // days after initial with no document
  escalateWithin: 2,        // or this many days before start, whichever is first
};

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

export function buildSubject({ coiState, needsW9, taskName }) {
  // Per Cole: an expired certificate gets the bare subject, no task suffix.
  // It is the case a sub recognizes instantly and the extra clause adds
  // nothing.
  if (coiState === 'expired' && !needsW9) return 'Updated insurance certificate needed';

  // "Updated" is wrong when there was never one to update.
  const what = (coiState !== 'ok' && needsW9) ? 'Insurance certificate and W9 needed'
             : needsW9                        ? 'W9 needed'
             : coiState === 'expired'         ? 'Updated insurance certificate needed'
             :                                  'Insurance certificate needed';

  return taskName ? `${what} before ${taskName.toLowerCase()}` : what;
}

// attempt: 1 = initial request, 2+ = follow-up. The follow-ups get shorter and
// more direct rather than repeating the whole message.
export function buildBody({
  contactName, subName, projectName, projectAddress,
  taskName, startDate, coiState, coiExpiry, needsW9, attempt = 1,
}) {
  const needs      = needsClause({ coiState, coiExpiry, needsW9 }, attempt > 1);
  if (!needs.length) return null;              // nothing to ask for

  const greeting   = contactName ? `Hi ${contactName},` : 'Hi,';
  const startNice  = fmtDate(startDate);
  const where      = [projectName && `the ${projectName} project`, projectAddress]
                       .filter(Boolean).join(' at ');
  const L          = [];

  L.push(greeting);
  L.push('');

  if (attempt === 1) {
    const lead = where ? `Before we get started on ${where}, ` : 'Before this work starts, ';
    // Deliberately does not add "we do not have one on record" for the missing
    // case: the opener already says we need it on file, and saying it twice
    // reads like a form letter.
    L.push(`${lead}we need ${joinList(needs)} on file.`);
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

    if (taskName && startNice) {
      L.push(`${taskName} is scheduled to start ${startNice}, so we need this back before then.`);
    } else if (startNice) {
      L.push(`Work is scheduled to start ${startNice}, so we need this back before then.`);
    }
    L.push('');
    L.push(coiState !== 'ok'
      ? 'Let me know if you need anything from us to get it issued.'
      : 'Let me know if you need anything from us.');
  } else {
    // Follow-up. Assume they read the first one; do not re-explain.
    L.push(`Following up on ${joinList(needs)}. We still do not have ${needs.length > 1 ? 'them' : 'it'}.`);
    L.push('');
    if (taskName && startNice) {
      L.push(`${taskName} starts ${startNice}. We cannot have anyone on site without current insurance on file, so this is holding up the schedule.`);
    } else {
      L.push('We cannot have anyone on site without current insurance on file, so this is holding up the schedule.');
    }
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
export function nextAction({ history = [], startDate, today = new Date().toISOString().slice(0, 10) }) {
  const sent = history.length;

  if (sent >= ESCALATION.maxEmails) {
    return { action: 'escalate', reason: `already sent ${sent} requests with no document` };
  }

  const daysTo = startDate
    ? Math.round((new Date(startDate.slice(0, 10) + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86_400_000)
    : null;

  if (!sent) return { action: 'send', attempt: 1 };

  const firstSent  = history[history.length - 1].sent_at.slice(0, 10);
  const lastSent   = history[0].sent_at.slice(0, 10);
  const sinceFirst = Math.round((new Date(today + 'T00:00:00Z') - new Date(firstSent + 'T00:00:00Z')) / 86_400_000);
  const sinceLast  = Math.round((new Date(today + 'T00:00:00Z') - new Date(lastSent  + 'T00:00:00Z')) / 86_400_000);

  // Stop emailing and hand it to a person once we are out of runway, whether
  // that is elapsed time or the start date arriving.
  if (sinceFirst >= ESCALATION.escalateAfter) {
    return { action: 'escalate', reason: `${sinceFirst} days since the first request` };
  }
  if (daysTo != null && daysTo <= ESCALATION.escalateWithin) {
    return { action: 'escalate', reason: `work starts in ${daysTo} day(s) and the document is still missing` };
  }

  const dueAfter = ESCALATION.followUpDays[sent - 1];
  if (dueAfter != null && sinceLast >= dueAfter) {
    return { action: 'send', attempt: sent + 1 };
  }

  return null;
}
