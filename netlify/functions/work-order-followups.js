// netlify/functions/work-order-followups.js
//
// The track half of Tier 2: notice that a work order went out and nothing came
// back.
//
// This is the failure the whole project started from. A subcontractor commits
// verbally, or does not commit at all, and nobody notices until the day the
// crew was supposed to show up. A two day slip becomes a one week gap because
// the next trade was booked around the original date.
//
//   GET /              what is due today. Writes nothing, sends nothing.
//   GET /?apply=1      write the nudge drafts into the approval queue, and
//                      send Cole the escalations
//   GET /?days=30      how far back to consider links (default 30)
//
// Two different things happen here and they are treated differently on purpose.
//
// A NUDGE goes to a subcontractor, so it is drafted and waits for a person, per
// Cole: approve every nudge. This function never texts or emails a sub.
//
// An ESCALATION goes to Cole. It is not an outbound message to a sub, it is the
// system telling him a relationship needs a phone call, so it sends. Voice is
// escalation only and the decision to make that call is his: this hands him the
// facts, it does not dial anything.

import { supabase } from './lib/supabase-client.js';
import { sendGmail, gmailConfigured } from './lib/gmail.js';
import { FROM_EMAIL, businessDaysBetween, isBusinessDay } from './lib/compliance-email.js';
import { buildSms, buildEmailSubject, buildEmailBody, buildEscalationNote } from './lib/work-order-messages.js';
import { toE164 } from './lib/sms.js';

// Business days, like every other ladder in this system. A work order sent at
// 4pm on Friday has not been ignored by Saturday morning: nobody was going to
// answer it, and a nudge that arrives then teaches a sub that our messages are
// noise.
//
// One business day to the first nudge is Cole's 24 hours, counted the way a
// working week actually runs. Two nudges, then it stops being something a
// message will fix.
const LADDER = {
  firstNudgeAfter:  1,   // business days since the work order was sent
  secondNudgeAfter: 2,   // business days since the first nudge
  maxNudges:        2,
  escalateAfter:    4,   // business days of silence since the first send
};

const PORTAL_PATH = '/portal/work-order.html';

function siteBase(event) {
  return process.env.URL || `https://${event.headers?.host || 'sparkly-baklava-bb8c92.netlify.app'}`;
}

async function getJson(url) {
  const res  = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };
  const reply = (code, body) => ({ statusCode: code, headers: corsH, body: JSON.stringify(body, null, 2) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };

  const q      = event.queryStringParameters || {};
  const isCron = event.httpMethod === 'POST' && String(event.body || '').includes('next_run');
  const apply  = isCron || q.apply === '1';
  const days   = Number(q.days) > 0 ? Number(q.days) : 30;
  const today  = new Date().toISOString().slice(0, 10);
  const base   = siteBase(event);

  const report = {
    generatedAt: new Date().toISOString(),
    applied: apply,
    // A ladder that holds is reported rather than silent, the same as the
    // compliance sweep. A quiet report has to mean nothing is outstanding, not
    // that today is Saturday.
    sendingDay: isBusinessDay(today),
    links: 0, nudges: [], escalations: [], waiting: [], done: [], errors: [],
  };

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const links = await supabase('work_order_links', {
      select: '*',
      filters: [{ col: 'created_at', op: 'gte', val: since }, { col: 'revoked', op: 'eq', val: 'false' }],
      order: 'created_at.desc', limit: 200,
    });
    report.links = links.length;
    if (!links.length) return reply(200, report);

    // One query for every event across every link, rather than one per link.
    // The same lesson the compliance sweep learned the hard way: a round trip
    // per row is what kills an endpoint that has seconds to answer in.
    const allEvents = await supabase('work_order_events', {
      select: '*',
      filters: [{ col: 'created_at', op: 'gte', val: since }],
      order: 'created_at.desc', limit: 2000,
    });
    const byToken = new Map();
    for (const e of allEvents) {
      if (!byToken.has(e.token)) byToken.set(e.token, []);
      byToken.get(e.token).push(e);
    }

    for (const link of links) {
      const events = byToken.get(link.token) || [];
      const url    = `${base}${PORTAL_PATH}?t=${link.token}`;
      const label  = { sub: link.sub_name, task: link.task_name, project: link.project_name, starts: link.starts_on };

      // Finished, one way or the other.
      const submitted = events.find(e => e.kind === 'submitted');
      if (submitted) { report.done.push({ ...label, submittedAt: submitted.created_at }); continue; }
      if (events.some(e => e.kind === 'cancelled')) continue;

      // Never sent. That is the approval queue's problem, not this one: a work
      // order nobody has approved is not a subcontractor being slow.
      const sends = events.filter(e => e.kind === 'sent').sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (!sends.length) continue;

      const firstSend = sends[0];
      const lastSend  = sends[sends.length - 1];
      const nudges    = sends.filter(e => e.purpose === 'nudge');
      const opened    = events.filter(e => e.kind === 'opened').sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

      const sinceFirst = businessDaysBetween(firstSend.created_at.slice(0, 10), today);
      const sinceLast  = businessDaysBetween(lastSend.created_at.slice(0, 10), today);

      // What the silence actually means. A sub who opened the work order and
      // did not commit is thinking about it, or hit something they could not
      // answer. A sub who never opened it may not have got it at all. Those are
      // different problems and only the tracking can tell them apart.
      const seen = opened
        ? `opened it ${opened.created_at.slice(0, 16).replace('T', ' ')} and has not committed`
        : 'has not opened it';

      // Out of runway. Two nudges, or four business days of silence, and this
      // stops being something another message will fix.
      if (nudges.length >= LADDER.maxNudges || (sinceFirst != null && sinceFirst >= LADDER.escalateAfter)) {
        const already = events.some(e => e.kind === 'escalated');
        if (already) {
          report.waiting.push({ ...label, state: 'escalated already, waiting on Cole', seen });
          continue;
        }

        const note = buildEscalationNote({
          workOrder: { taskName: link.task_name, trade: link.trade },
          schedule:  { startDate: link.starts_on },
          project:   { name: link.project_name },
          sub:       { name: link.sub_name, phone: link.to_phone },
          sends:     sends.map(s => ({ created_at: s.created_at, channel: s.channel, to_address: s.to_address })),
          link:      url,
        });

        report.escalations.push({ ...label, seen, sends: sends.length, note });
        if (!apply) continue;

        try {
          if (gmailConfigured()) {
            await sendGmail({
              to: FROM_EMAIL,
              subject: `No answer on the work order: ${link.sub_name}, ${link.task_name}`,
              body: `${note}\n\n${seen[0].toUpperCase()}${seen.slice(1)}.`,
            });
          }
          await supabase('work_order_events', { method: 'POST', body: {
            token: link.token, kind: 'escalated', purpose: 'escalation',
            to_address: FROM_EMAIL, message: note, actor: 'agent',
            meta: { sends: sends.length, opened: !!opened },
          } });
        } catch (err) {
          report.errors.push({ sub: link.sub_name, error: `escalation failed: ${err.message}` });
        }
        continue;
      }

      // Not due yet, or not a day to send on.
      const dueAfter = nudges.length === 0 ? LADDER.firstNudgeAfter : LADDER.secondNudgeAfter;
      if (sinceLast == null || sinceLast < dueAfter) {
        report.waiting.push({
          ...label, seen,
          state: `nudge ${nudges.length + 1} is due ${dueAfter - (sinceLast ?? 0)} business day(s) from now`,
        });
        continue;
      }
      if (!isBusinessDay(today)) {
        report.waiting.push({ ...label, seen, state: `nudge ${nudges.length + 1} is due, and nothing goes out on a weekend` });
        continue;
      }

      // Already drafted and sitting in the queue unapproved. Drafting it again
      // would stack two identical messages against one link, and whoever is
      // reading the queue would have no way to know they are the same nudge.
      const pending = events.find(e => e.kind === 'drafted' && e.purpose === 'nudge' &&
        !events.some(s => s.kind === 'sent' && s.purpose === 'nudge' && s.created_at > e.created_at));
      if (pending) {
        report.waiting.push({ ...label, seen, state: 'a nudge is already drafted and waiting for approval' });
        continue;
      }

      const wo = {
        workOrder: { taskName: link.task_name, trade: link.trade },
        schedule:  { startDate: link.starts_on },
        project:   { name: link.project_name },
        sub:       { name: link.sub_name, contactName: link.contact_name },
      };
      const smsBody = buildSms({ ...wo, link: url, purpose: 'nudge', attempt: nudges.length + 2 });
      const emlSubj = buildEmailSubject(wo);
      const emlBody = buildEmailBody({ ...wo, link: url, purpose: 'nudge' });

      const drafted = [];
      for (const [channel, to, subject, message] of [
        ['sms',   toE164(link.to_phone), null,     smsBody],
        ['email', link.to_email,         emlSubj,  emlBody],
      ]) {
        if (!to) continue;
        drafted.push({ channel, to, subject, message });
        if (!apply) continue;
        try {
          await supabase('work_order_events', { method: 'POST', body: {
            token: link.token, kind: 'drafted', channel, purpose: 'nudge',
            attempt: nudges.length + 2, to_address: to, subject, message, actor: 'agent',
          } });
        } catch (err) {
          report.errors.push({ sub: link.sub_name, error: `could not draft the ${channel} nudge: ${err.message}` });
        }
      }

      report.nudges.push({
        ...label, seen, nudge: nudges.length + 1,
        sentFirst: firstSend.created_at.slice(0, 10), businessDaysSilent: sinceFirst,
        drafted,
      });
    }

    report.summary =
      `${report.links} live link(s): ${report.done.length} committed, ${report.nudges.length} nudge(s) ` +
      `${apply ? 'drafted for approval' : 'would be drafted'}, ${report.escalations.length} escalation(s), ` +
      `${report.waiting.length} holding.`;
    if (!apply) report.dryRun = 'Nothing was written. Add apply=1 to put the nudges in the approval queue.';

    return reply(200, report);

  } catch (err) {
    console.error('work-order-followups error:', err);
    return reply(500, { error: err.message });
  }
};
