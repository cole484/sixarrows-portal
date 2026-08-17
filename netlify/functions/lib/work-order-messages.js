// netlify/functions/lib/work-order-messages.js
//
// What a subcontractor actually receives when a work order goes out, and what
// they receive when they go quiet.
//
// Separate from the sending mechanics on purpose, the same as
// compliance-email.js: Cole approves wording, and wording he has to go hunting
// through an endpoint to find is wording nobody reviews.
//
// Deterministic. Every sentence is assembled from fields on the task, the
// project and the subcontractor row. Nothing is generated, so nothing can be
// invented about a scope, a date or a price.
//
// Voice is Lindsey's: direct, professional, no padding, no apologising for
// asking. These are people Six Arrows works with constantly and the message
// should read like one colleague texting another, not like a portal.
//
// No em dashes anywhere, including here.

const COMPANY = 'Six Arrows Construction';

// Two rules that come from the carriers rather than from taste, and are worth
// stating where the copy lives:
//
//   1. Every message identifies the business. A text from an unknown 270
//      number is deleted, and an unidentified one can fail carrier review.
//   2. The first message to a number carries opt-out wording. Twilio honours a
//      STOP reply by itself, so repeating it on every follow-up only spends
//      segments and reads as a mailshot.
const OPT_OUT = 'Reply STOP to opt out.';

// No em dashes anywhere is a rule about what Six Arrows sends, not about what
// Six Arrows types, and the difference matters here: every one of these
// sentences is assembled from Notion fields, and Notion is full of them. The
// first real draft came out as "Johnson — Build Timeline" in the subject line
// of a message to a subcontractor. So the rule is enforced on the way out
// rather than trusted to hold upstream.
function clean(s) {
  return String(s ?? '')
    .replace(/\s*[—–]\s*/g, ', ')     // em and en dash
    .replace(/[‘’]/g, "'")            // smart quotes, which mangle in SMS
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// "Johnson — Build Timeline" is what the Notion database is called. What the
// subcontractor should read is "Johnson". A project name in these messages is
// there to tell a sub which of our jobs this is, and our internal noun for the
// timeline is not that.
function projectLabel(name) {
  const s = clean(name);
  if (!s) return null;
  const cut = s.split(/,\s*(?:build\s+)?timeline\b/i)[0];
  return (cut || s).replace(/[,\s]+$/, '');
}

function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function longDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return null;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function firstName(full) {
  const s = String(full ?? '').trim().replace(/\s+/g, ' ');
  return s ? (s.split(' ')[0].replace(/[,;:]+$/, '') || null) : null;
}

function money(n) {
  return typeof n === 'number' && Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
}

// Where the job is, in as few words as carry meaning. A street address beats a
// project name to a sub who works for four builders: "106 Reynolds Ln" is a
// place they can drive to and "Johnson" is a name in our system.
function place({ project }) {
  return clean(project?.address) || projectLabel(project?.name) || null;
}

// ── The text ──────────────────────────────────────────────────────────────
//
// Kept to two segments. The link alone is most of one, so everything else has
// to earn its characters: what the work is, where, when it starts, and the
// link. The detail is on the page and in the email, and a sub who wants it
// taps through.
export function buildSms({ workOrder, schedule, project, link, attempt = 1, purpose = 'work_order' }) {
  const what  = clean(workOrder?.taskName || workOrder?.trade || 'work');
  const where = place({ project });
  const when  = shortDate(schedule?.startDate);

  if (purpose === 'nudge') {
    return [
      `${COMPANY}: following up on the work order for ${what}${where ? ` at ${where}` : ''}.`,
      `Let us know your dates when you get a chance:`,
      link,
    ].join(' ');
  }

  return [
    `${COMPANY}: work order for ${what}${where ? ` at ${where}` : ''}${when ? `, starting ${when}` : ''}.`,
    `Scope, dates and payment terms here:`,
    link,
    attempt === 1 ? OPT_OUT : null,
  ].filter(Boolean).join(' ');
}

// ── The email ─────────────────────────────────────────────────────────────
//
// The record. It says the same things the text says and then the things a text
// cannot carry: the price we believe is agreed, where it came from, and what we
// need back. A sub who prints one thing before starting a job prints this.
export function buildEmailSubject({ workOrder, schedule, project }) {
  const what = clean(workOrder?.taskName || workOrder?.trade || 'work');
  const when = shortDate(schedule?.startDate);
  const proj = projectLabel(project?.name);
  return clean(`Work order: ${what}${proj ? `, ${proj}` : ''}${when ? ` (starts ${when})` : ''}`);
}

export function buildEmailBody({ workOrder, schedule, project, sub, link, attempt = 1, purpose = 'work_order' }) {
  const first = firstName(sub?.contactName) || firstName(sub?.name);
  const what  = clean(workOrder?.taskName || workOrder?.trade || 'the work');
  const where = place({ project });
  const start = longDate(schedule?.startDate);
  const L = [];

  L.push(first ? `Hi ${first},` : 'Hi,');
  L.push('');

  if (purpose === 'nudge') {
    L.push(`Following up on the work order for ${what}${where ? ` at ${where}` : ''}. We have not heard back yet and we are holding the dates for you.`);
    L.push('');
    L.push('It takes a couple of minutes: your start and finish dates, and how you want to bill it.');
    L.push('');
    L.push(link);
    L.push('');
    L.push('If the dates do not work, say so and we will move them rather than guess.');
  } else {
    L.push(`Here is the work order for ${what}${where ? ` at ${where}` : ''}.`);
    L.push('');
    if (start) L.push(`We have it scheduled to start ${start}. That date is ours until you tell us yours: the window on the work order is what goes on the schedule, so put down what you can actually hold.`);
    else       L.push('The work order has the scope and the standard we are working to. Put down the window you can actually hold and that is what goes on the schedule.');
    L.push('');

    // Only a number the sub themselves gave us is stated as the price. An
    // estimator's figure quoted back to a subcontractor as though they agreed
    // to it is how a job starts with an argument.
    const value = money(workOrder?.contractValue);
    if (value && workOrder?.costSource === 'Bid Received') {
      L.push(`Price on it is ${value}, from the quote you sent us. If anything has changed since, tell us before you start rather than on the invoice.`);
      L.push('');
    } else if (value) {
      L.push(`There is a figure of ${value} on our end, but it is our estimate rather than a price from you. Confirm your number when you send the dates back.`);
      L.push('');
    }

    L.push('Two things we need from you on it:');
    L.push('');
    L.push('  1. The dates you can commit to.');
    L.push('  2. How you want to be paid: all at completion, or split across two or three points. Your call, and it is different for every vendor, so tell us how you do it.');
    L.push('');
    L.push(link);
    L.push('');
    L.push('Anything on the scope that is not right, or anything you need from us before you can start, put it in the notes on that page and we will sort it out.');
  }

  L.push('');
  L.push('Thanks,');
  L.push(project?.pmName || COMPANY);
  if (project?.pmName) L.push(COMPANY);
  if (project?.pmPhone) L.push(project.pmPhone);

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── The escalation, which goes to Cole rather than to the sub ─────────────
//
// Voice is escalation and accessibility only, and the escalation itself is a
// decision for a person. This is the message that tells Cole a sub has been
// silent through both channels and it is now a phone call, which is his rule:
// never place an AI voice call as first contact, and these are relationships he
// cannot easily replace.
export function buildEscalationNote({ workOrder, schedule, project, sub, sends, link }) {
  const what  = clean(workOrder?.taskName || workOrder?.trade || 'work');
  const start = schedule?.startDate;
  const L = [];

  L.push(`${sub?.name || 'This subcontractor'} has not come back on the work order for ${what}${projectLabel(project?.name) ? ` (${projectLabel(project.name)})` : ''}.`);
  L.push('');
  for (const s of sends || []) {
    L.push(`  ${String(s.created_at).slice(0, 10)}  ${s.channel === 'sms' ? 'text' : 'email'} to ${s.to_address}${s.kind === 'opened' ? '' : ''}`);
  }
  L.push('');
  if (start) L.push(`Work is scheduled to start ${longDate(start)}.`);
  L.push(`Their number is ${sub?.phone || 'not on their subcontractor row'}.`);
  L.push('');
  L.push('This is where it becomes a phone call. The link is still live if they want it:');
  L.push(link);

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
