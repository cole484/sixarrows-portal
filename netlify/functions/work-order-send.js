// netlify/functions/work-order-send.js
//
// Tier 2, the send half: turn a task that passes the readiness gate into a work
// order a subcontractor can actually receive, and record enough that the track
// half has something to track.
//
// Before this, the work order page took a raw Notion page id in its URL. That
// meant there was no record of who a work order went to, no way to know whether
// anybody opened it, and no way to tell a sub who is thinking about it from one
// who never got it. A token fixes all three, and it is also Cole's rule: work
// orders are reachable by token link, and no subcontractor ever logs in.
//
//   GET  /?diag=1                  can this thing text at all. Sends nothing.
//   GET  /?diag=1&testTo=+1270...  one real text to that number, to prove it
//   GET  /?taskId=<id>             what would go out, and to whom. Mints
//                                  nothing, sends nothing. The default.
//   GET  /?taskId=<id>&prepare=1   mint the link and put the drafts in the
//                                  queue for approval
//   GET  /?taskId=<id>&prepare=1&renew=1
//                                  mint a fresh link even though one is live.
//                                  Revokes the old one.
//   GET  /?token=<t>               everything known about one link
//   GET  /?queue=1                 every link drafted and not yet resolved
//   POST { token, channel }        send it. Approval is a POST because a link
//                                  that sends when it is fetched is a link that
//                                  eventually sends by accident: a preview
//                                  fetch, a scanner, a browser prefetching. A
//                                  message to a subcontractor should require
//                                  somebody to have meant it.
//
// Nothing here decides that a work order should go out. It refuses tasks the
// gate has blocked, writes the drafts, and waits. Per Cole: a human approves
// every outbound until this is proven on real subs, and that includes the
// follow-ups.

import crypto from 'node:crypto';
import { supabase } from './lib/supabase-client.js';
import { sendSms, smsConfigured, smsDiagnostics, toE164, quietHoursHold } from './lib/sms.js';
import { sendGmail, gmailConfigured, senderAddress } from './lib/gmail.js';
import { buildSms, buildEmailSubject, buildEmailBody } from './lib/work-order-messages.js';

// How far ahead the gate is asked to look when checking one task. Wide enough
// that a task being prepared early still appears in its answer, narrow enough
// that the call stays quick.
const GATE_WINDOW_DAYS = 180;

const PORTAL_PATH = '/portal/work-order.html';

// Twelve characters of randomness. Not a secret in the cryptographic sense,
// but a subcontractor's work order is not a public document either, and this is
// far past guessing: a raw Notion page id in the URL was the thing being
// replaced, and that identified the task to anyone who saw the link.
function mintToken() {
  return crypto.randomBytes(9).toString('base64url');
}

function siteBase(event) {
  return process.env.URL || `https://${event.headers?.host || 'sparkly-baklava-bb8c92.netlify.app'}`;
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) throw new Error(`${url.split('/.netlify/functions/')[1] || url}: ${res.status} ${text.slice(0, 200)}`);
  if (!data)   throw new Error(`${url} did not return JSON`);
  return data;
}

// The readiness gate, asked about one task.
//
// Deliberately the real gate over HTTP rather than a second copy of its rules
// here. Two implementations of "is this ready" drift, and the day they disagree
// is the day a work order goes out for a task with no scope on it.
async function gateVerdict(base, taskId) {
  const gate = await getJson(`${base}/.netlify/functions/scheduling-gate?days=${GATE_WINDOW_DAYS}`);
  for (const project of gate.projects || []) {
    for (const task of project.tasks || []) {
      if (task.taskId === taskId) return { found: true, task, project: project.project };
    }
  }
  return { found: false, task: null };
}

// The newest link for a task that has not been revoked. Reused rather than
// minted again, so a second prepare on the same task does not leave two live
// links and no way to know which one the sub is looking at.
async function liveLink(taskId) {
  const rows = await supabase('work_order_links', {
    select: '*',
    filters: [{ col: 'task_id', op: 'eq', val: taskId }, { col: 'revoked', op: 'eq', val: 'false' }],
    order: 'created_at.desc', limit: 1,
  });
  return rows[0] || null;
}

async function eventsFor(token) {
  return supabase('work_order_events', {
    select: '*',
    filters: [{ col: 'token', op: 'eq', val: token }],
    order: 'created_at.desc', limit: 50,
  });
}

async function record(row) {
  return supabase('work_order_events', { method: 'POST', body: row });
}

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type':                 'application/json',
  };
  const reply = (statusCode, body) => ({ statusCode, headers: corsH, body: JSON.stringify(body, null, 2) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };

  const q    = event.queryStringParameters || {};
  const base = siteBase(event);

  try {
    // ── Diagnostic ────────────────────────────────────────────────────────
    // Built early and on purpose. A stored credential that has never been used
    // against Twilio is a credential nobody knows is wrong, and the moment to
    // find out is now rather than with a subcontractor waiting.
    if (q.diag === '1') {
      const diag = {
        sms:   await smsDiagnostics(),
        email: { configured: gmailConfigured(), sender: gmailConfigured() ? senderAddress() : null },
        tables: {},
      };

      // The migration is run by hand in the Supabase SQL editor, so "have you
      // run it yet" is a real question with a real answer.
      for (const t of ['work_order_links', 'work_order_events']) {
        try {
          await supabase(t, { select: 'created_at', limit: 1 });
          diag.tables[t] = 'ready';
        } catch (err) {
          diag.tables[t] = `not readable: ${err.message}. Run supabase/add-work-order-sends.sql in the Supabase SQL editor.`;
        }
      }

      if (q.testTo) {
        const to = toE164(q.testTo);
        if (!to) {
          diag.test = { sent: false, error: `"${q.testTo}" is not a number this can send to.` };
        } else {
          try {
            const sent = await sendSms({
              to,
              body: 'Six Arrows Construction: test message from the scheduling agent. Nothing is scheduled, nothing needed. Reply STOP to opt out.',
            });
            diag.test = { sent: true, ...sent };
          } catch (err) {
            diag.test = { sent: false, error: err.message };
          }
        }
      } else {
        diag.test = 'Add &testTo=%2B12705551234 to send one real text and prove the credentials work.';
      }

      diag.ready = !!(diag.sms.configured && diag.email.configured &&
                      diag.tables.work_order_links === 'ready' && diag.tables.work_order_events === 'ready');
      return reply(200, diag);
    }

    // ── Approve and send ──────────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return reply(400, { error: 'body must be JSON' }); }

      const token   = String(body.token || '').trim();
      const channel = String(body.channel || '').trim().toLowerCase();
      const actor   = String(body.actor || 'cole').slice(0, 60);
      if (!token) return reply(400, { error: 'token required' });
      if (!['sms', 'email'].includes(channel)) return reply(400, { error: 'channel must be "sms" or "email"' });

      const links = await supabase('work_order_links', {
        select: '*', filters: [{ col: 'token', op: 'eq', val: token }], limit: 1,
      });
      const link = links[0];
      if (!link)         return reply(404, { error: 'no such work order link' });
      if (link.revoked)  return reply(409, { error: 'this link was revoked. Prepare a new one.' });

      const events = await eventsFor(token);

      // Already committed. Sending again asks somebody to do a thing they have
      // done, which is the fastest way to look like a system nobody is reading.
      if (events.some(e => e.kind === 'submitted')) {
        return reply(409, { error: 'this subcontractor already submitted their commitment. Nothing further should go out.' });
      }

      const draft = events.find(e => e.kind === 'drafted' && e.channel === channel);
      if (!draft) return reply(409, { error: `no ${channel} draft is waiting on this link. Prepare it first.` });

      const sentAlready = events.filter(e => e.kind === 'sent' && e.channel === channel);
      const attempt     = sentAlready.length + 1;

      if (channel === 'sms') {
        const hold = quietHoursHold();
        if (hold && q.anyway !== '1') {
          return reply(409, { error: `held: ${hold} Add ?anyway=1 to the POST url to send regardless.` });
        }
        if (!smsConfigured()) return reply(500, { error: 'Twilio is not configured. See docs/twilio-setup.md.' });
      }
      if (channel === 'email' && !gmailConfigured()) {
        return reply(500, { error: 'Gmail is not configured. See docs/gmail-setup.md.' });
      }

      const to = channel === 'sms' ? link.to_phone : link.to_email;
      if (!to) return reply(400, { error: `no ${channel === 'sms' ? 'phone number' : 'email address'} on ${link.sub_name}'s subcontractor row.` });

      try {
        const res = channel === 'sms'
          ? await sendSms({ to, body: draft.message })
          : await sendGmail({ to, subject: draft.subject, body: draft.message });

        await record({
          token, kind: 'sent', channel, attempt, purpose: draft.purpose || 'work_order',
          to_address: to, subject: draft.subject || null, message: draft.message,
          provider_sid: res.sid || res.id || null, actor,
        });
        return reply(200, { sent: true, channel, to, attempt, sid: res.sid || res.id || null });
      } catch (err) {
        await record({
          token, kind: 'send_failed', channel, attempt, purpose: draft.purpose || 'work_order',
          to_address: to, message: draft.message, error: err.message, actor,
        });
        return reply(502, { sent: false, channel, to, error: err.message });
      }
    }

    // ── One link, and everything that has happened to it ──────────────────
    if (q.token) {
      const links = await supabase('work_order_links', {
        select: '*', filters: [{ col: 'token', op: 'eq', val: q.token }], limit: 1,
      });
      if (!links[0]) return reply(404, { error: 'no such work order link' });
      const events = await eventsFor(q.token);
      return reply(200, {
        link: links[0],
        url: `${base}${PORTAL_PATH}?t=${q.token}`,
        state: events[0]?.kind || 'minted',
        events,
      });
    }

    // ── The queue: drafted, not yet sent ──────────────────────────────────
    if (q.queue === '1') {
      const drafts = await supabase('work_order_events', {
        select: '*', filters: [{ col: 'kind', op: 'eq', val: 'drafted' }],
        order: 'created_at.desc', limit: 200,
      });

      // Resolved means sent, submitted or cancelled. A draft whose link has any
      // of those is history, not a job waiting for somebody.
      const tokens = [...new Set(drafts.map(d => d.token))];
      const waiting = [];
      for (const token of tokens) {
        const events = await eventsFor(token);
        const done = events.find(e => ['submitted', 'cancelled'].includes(e.kind));
        if (done) continue;
        const links = await supabase('work_order_links', {
          select: '*', filters: [{ col: 'token', op: 'eq', val: token }], limit: 1,
        });
        if (!links[0] || links[0].revoked) continue;

        for (const channel of ['sms', 'email']) {
          const draft = events.find(e => e.kind === 'drafted' && e.channel === channel);
          if (!draft) continue;
          if (events.some(e => e.kind === 'sent' && e.channel === channel)) continue;
          waiting.push({
            token, channel,
            sub: links[0].sub_name, contact: links[0].contact_name,
            project: links[0].project_name, task: links[0].task_name,
            starts: links[0].starts_on,
            to: channel === 'sms' ? links[0].to_phone : links[0].to_email,
            purpose: draft.purpose, subject: draft.subject, message: draft.message,
            draftedAt: draft.created_at,
            url: `${base}${PORTAL_PATH}?t=${token}`,
          });
        }
      }

      return reply(200, {
        waiting: waiting.length,
        hold: quietHoursHold(),
        approve: 'POST to this endpoint with { "token": "...", "channel": "sms" }',
        drafts: waiting,
      });
    }

    // ── Prepare ───────────────────────────────────────────────────────────
    const taskId = (q.taskId || '').trim();
    if (!taskId) {
      return reply(400, {
        error: 'taskId required',
        usage: { diagnostic: '?diag=1', preview: '?taskId=<notion page id>', prepare: '?taskId=<id>&prepare=1', queue: '?queue=1' },
      });
    }

    const [wo, verdict] = await Promise.all([
      getJson(`${base}/.netlify/functions/notion-work-order?taskId=${encodeURIComponent(taskId)}`),
      gateVerdict(base, taskId).catch(err => ({ found: false, error: err.message })),
    ]);

    const sub = wo.sub || {};
    const out = {
      task: wo.workOrder?.taskName,
      project: wo.project?.name,
      trade: wo.workOrder?.trade,
      starts: wo.schedule?.startDate,
      sub: sub.name || null,
      contact: sub.contactName || null,
      phone: sub.phone || null,
      phoneUsable: !!toE164(sub.phone),
      email: sub.email || null,
      gate: verdict.found
        ? { ready: verdict.task.ready, blockers: verdict.task.blockers, flags: (verdict.task.flags || []).map(f => f.kind) }
        : { ready: null, note: verdict.error || `this task is not in the gate's ${GATE_WINDOW_DAYS} day window, so its readiness was not checked.` },
    };

    // The gate is the authority on whether this should go out at all. A task it
    // has blocked has something missing that the subcontractor would have to
    // ask about, and a work order that prompts a phone call to explain it is
    // worse than no work order.
    if (verdict.found && !verdict.task.ready && q.force !== '1') {
      return reply(409, {
        ...out,
        refused: 'the readiness gate has this task blocked, so nothing was minted and nothing drafted.',
        fix: 'Clear the blockers above, or pass force=1 if you have handled them another way.',
      });
    }

    if (!sub.id) return reply(409, { ...out, refused: 'no subcontractor is assigned to this task.' });

    let link = await liveLink(taskId);
    if (link && q.renew === '1') {
      await supabase('work_order_links', {
        method: 'PATCH', filters: [{ col: 'token', op: 'eq', val: link.token }], body: { revoked: true },
      });
      await record({ token: link.token, kind: 'cancelled', actor: 'agent', error: 'replaced by a fresh link' });
      link = null;
    }

    const token = link?.token || mintToken();
    const url   = `${base}${PORTAL_PATH}?t=${token}`;

    const purpose = q.purpose === 'nudge' ? 'nudge' : 'work_order';
    const smsBody = buildSms({ ...wo, link: url, purpose, attempt: 1 });
    const emlSubj = buildEmailSubject(wo);
    const emlBody = buildEmailBody({ ...wo, link: url, purpose, attempt: 1 });

    out.token   = token;
    out.url     = url;
    out.drafts  = {
      sms:   { to: sub.phone || null, chars: smsBody.length, segments: Math.ceil(smsBody.length / 153), message: smsBody },
      email: { to: sub.email || null, subject: emlSubj, message: emlBody },
    };

    if (q.prepare !== '1') {
      out.dryRun = 'Nothing was minted and nothing was drafted. Add prepare=1 to put these in the approval queue.';
      return reply(200, out);
    }

    if (!link) {
      await supabase('work_order_links', { method: 'POST', body: {
        token, task_id: taskId,
        project_name: wo.project?.name || null,
        trade: wo.workOrder?.trade || null,
        task_name: wo.workOrder?.taskName || null,
        starts_on: wo.schedule?.startDate || null,
        sub_id: sub.id || null, sub_name: sub.name || null, contact_name: sub.contactName || null,
        to_phone: toE164(sub.phone), to_email: sub.email || null,
      } });
    }

    // Both drafts, always, even when one channel cannot deliver today. Twilio's
    // carrier registration takes 10 to 15 days and the email half works now, so
    // a work order is never held up waiting on paperwork at a phone company.
    const drafted = [];
    for (const [channel, payload] of [
      ['sms',   { message: smsBody, to: toE164(sub.phone) }],
      ['email', { message: emlBody, subject: emlSubj, to: sub.email }],
    ]) {
      if (!payload.to) continue;
      const existing = (await eventsFor(token)).find(e => e.kind === 'drafted' && e.channel === channel && e.purpose === purpose);
      if (existing) { drafted.push({ channel, already: true }); continue; }
      await record({
        token, kind: 'drafted', channel, purpose, attempt: 1,
        to_address: payload.to, subject: payload.subject || null, message: payload.message, actor: 'agent',
      });
      drafted.push({ channel, to: payload.to });
    }

    out.prepared = drafted;
    out.approve  = 'POST to this endpoint with { "token": "' + token + '", "channel": "sms" } to send it.';
    if (!smsConfigured()) out.smsNote = 'Twilio is not configured yet, so only the email can be sent today.';
    return reply(200, out);

  } catch (err) {
    console.error('work-order-send error:', err);
    return reply(500, { error: err.message });
  }
};
