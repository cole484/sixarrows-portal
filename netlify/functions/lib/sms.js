// netlify/functions/lib/sms.js
//
// Sends a text through Twilio, so a work order link reaches a subcontractor on
// the channel they actually read. Text is the primary channel for scheduling by
// Cole's rule: a sub reads a text within minutes and an email the next time
// they are at a computer, which on a job site is that evening.
//
// Required env:
//   TWILIO_ACCOUNT_SID    starts with AC
//   TWILIO_AUTH_TOKEN     from the Twilio console
//   TWILIO_FROM_NUMBER    the Six Arrows number, E.164, +1270...
// Strongly preferred:
//   TWILIO_MESSAGING_SERVICE_SID  starts with MG
//
// Send through the Messaging Service rather than the bare number when the
// service exists. It routes through the approved A2P campaign explicitly,
// which is what earns campaign throughput and sender pool behaviour, instead
// of leaving Twilio to infer the association from the number.
//
// Setup walkthrough, including the carrier registration that takes 10 to 15
// days: docs/twilio-setup.md.
//
// This module sends and reports. It does not decide: nothing here judges
// whether a message should go out, and every caller in this system routes that
// decision through a human first.

const API           = 'https://api.twilio.com/2010-04-01';
const MESSAGING_API = 'https://messaging.twilio.com/v1';

export function smsConfigured() {
  // A Messaging Service can send on its own, choosing a sender from its pool,
  // so either it or a from number is enough.
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
            (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER));
}

export function fromNumber() {
  return process.env.TWILIO_FROM_NUMBER || null;
}

export function messagingServiceSid() {
  return process.env.TWILIO_MESSAGING_SERVICE_SID || null;
}

// Turns what somebody typed into a Notion field into what Twilio needs.
//
// The numbers on the Subcontractors rows are written every way a person writes
// a phone number: "270-555-1234", "(270) 555-1234", "12705551234", one with a
// note after it. Twilio wants +12705551234 and rejects everything else with a
// 21211 that reads like the number is fake.
//
// Deliberately narrow. It adds a country code to a bare 10 digit US number and
// otherwise refuses, because guessing at a malformed number is how a work order
// goes to a stranger.
export function toE164(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\+\d{8,15}$/.test(s)) return s;               // already E.164

  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Quiet hours, in Central time, where every Six Arrows subcontractor is.
//
// A carrier rule and also basic manners. A work order that arrives at 5am is
// read at 5am, and the person reading it is asleep or driving. Returns null
// when it is fine to send, or a reason when it is not, so the caller can hold
// the message rather than discovering the rule by having a text blocked.
export function quietHoursHold(now = new Date()) {
  // Central is UTC-5 in summer and UTC-6 in winter. Using -6 year round means
  // the window is an hour conservative in summer, which errs toward not texting
  // somebody early, and that is the right direction to err.
  const central = new Date(now.getTime() - 6 * 3600_000);
  const hour = central.getUTCHours();
  if (hour < 8)  return `it is ${hour}:00 in Bowling Green, and nothing goes out before 8am.`;
  if (hour >= 18) return `it is ${hour}:00 in Bowling Green, and nothing goes out after 6pm.`;
  return null;
}

// One text. Returns { sid, status, to, from } or throws with a message that
// says what to do about it, because every Twilio error code that matters here
// has a different fix and the raw code says none of them.
export async function sendSms({ to, body }) {
  if (!smsConfigured()) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are not all set. See docs/twilio-setup.md.');
  }

  const dest = toE164(to);
  if (!dest) throw new Error(`"${to}" is not a phone number this can send to. It needs 10 digits, or E.164 like +12705551234.`);

  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  // MessagingServiceSid and From are mutually exclusive on this endpoint, and
  // the service is the better answer when there is one: it names the approved
  // campaign rather than relying on Twilio to work out which campaign a number
  // belongs to.
  const service = messagingServiceSid();
  const form    = new URLSearchParams({ To: dest, Body: String(body || '') });
  if (service) form.set('MessagingServiceSid', service);
  else         form.set('From', fromNumber());

  const res = await fetch(`${API}/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`${explainTwilio(data.code, data.message)} (Twilio ${res.status}${data.code ? `, code ${data.code}` : ''})`);
  }

  return {
    sid: data.sid, status: data.status, to: dest,
    from: data.from || fromNumber(),
    via: service ? `messaging service ${service}` : 'the from number directly',
  };
}

// The four failures worth naming. Each one looks like a bug in the portal and
// none of them is.
export function explainTwilio(code, fallback) {
  switch (Number(code)) {
    case 30034:
      // Two causes, and they look identical from here. The second one is the
      // one that actually bit: campaign approval does not attach the number to
      // the Messaging Service, that is a separate step, and an empty sender
      // pool fails exactly like an unapproved campaign. Check the pool first,
      // because "still in review" is the comfortable answer and was wrong.
      return 'the number is not sending through an approved A2P campaign. Either the campaign is still in carrier review, or, more often once it has been approved, the number is not in the Messaging Service sender pool. work-order-send?diag=1 says which.';
    case 21610:
      return 'this subcontractor replied STOP to a message from this number at some point, so Twilio will not deliver to them. Only they can undo it, by texting START. Reach them another way.';
    case 21211:
      return 'Twilio does not recognise that as a valid mobile number. Check the phone on their Subcontractors row.';
    case 20003:
      return 'Twilio rejected the credentials. The auth token was probably rotated: paste the new one into Netlify and redeploy.';
    case 21606:
    case 21608:
      return 'the From number cannot send to this destination. Check TWILIO_FROM_NUMBER is the number you bought and that the account is upgraded past trial.';
    default:
      return fallback || 'Twilio refused the message.';
  }
}

// What the credentials can actually do, asked of Twilio rather than assumed
// from what somebody wrote in a setup doc. Used by the diagnostic so a
// misconfiguration is one call to find instead of a failed real send.
export async function smsDiagnostics() {
  const out = {
    accountSidSet: !!process.env.TWILIO_ACCOUNT_SID,
    authTokenSet:  !!process.env.TWILIO_AUTH_TOKEN,
    fromNumber:    fromNumber(),
    configured:    smsConfigured(),
    quietHours:    quietHoursHold(),
  };
  if (!out.configured) {
    out.fix = 'Set the three TWILIO_ env vars in Netlify and redeploy. docs/twilio-setup.md.';
    return out;
  }

  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const get  = async path => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };

  const acct = await get(`/Accounts/${sid}.json`);
  out.account = acct.ok
    ? { friendlyName: acct.data.friendly_name, status: acct.data.status, type: acct.data.type }
    : { error: explainTwilio(acct.data.code, acct.data.message) };

  // A trial account can only text numbers somebody verified by hand, which is
  // the one configuration that works perfectly in testing and reaches no
  // subcontractor at all.
  if (acct.ok && String(acct.data.type).toLowerCase() === 'trial') {
    out.warning = 'This is still a trial account. It can only text numbers verified in the Twilio console, so it will reach nobody real. Upgrade it.';
  }

  const nums = await get(`/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(fromNumber() || '')}`);
  const found = nums.ok ? (nums.data.incoming_phone_numbers || [])[0] : null;
  out.numberOnAccount = !!found;
  if (found) out.numberCapabilities = found.capabilities || null;
  else if (nums.ok) out.fix = `${fromNumber()} is not a number on this Twilio account. Check TWILIO_FROM_NUMBER.`;

  // The sender pool, which is the check this diagnostic was missing.
  //
  // An approved campaign does not attach a number to the Messaging Service.
  // That is a separate step, it is easy to believe it happened, and an empty
  // pool fails with the identical error to a campaign still in review. Somebody
  // had to find this by hand once. Not twice.
  const service = messagingServiceSid();
  out.messagingService = service;
  if (!service) {
    out.messagingServiceNote =
      'TWILIO_MESSAGING_SERVICE_SID is not set, so messages go out on the bare number and Twilio has to infer which campaign it belongs to. ' +
      'Setting it routes through the approved campaign explicitly, which is what earns campaign throughput.';
    out.sendingVia = 'the from number directly';
    return out;
  }

  out.sendingVia = `messaging service ${service}`;
  const pool = await getMessaging(`/Services/${service}/PhoneNumbers`, auth);
  if (!pool.ok) {
    out.senderPool = { error: explainTwilio(pool.data.code, pool.data.message) };
    return out;
  }
  const senders = (pool.data.phone_numbers || []).map(p => p.phone_number);
  out.senderPool = senders;
  out.fromNumberInPool = !fromNumber() || senders.includes(fromNumber());
  if (!senders.length) {
    out.fix = `The Messaging Service ${service} has an empty sender pool, so every send will fail with 30034 and read exactly like a campaign still in review. Attach ${fromNumber() || 'the number'} to the service in the Twilio console.`;
  } else if (!out.fromNumberInPool) {
    out.fix = `${fromNumber()} is not in the sender pool for ${service} (it holds ${senders.join(', ')}). Either attach it or point TWILIO_FROM_NUMBER at one that is in there.`;
  }

  return out;
}

// The Messaging API lives on a different host from the rest of Twilio, which is
// the sort of thing that turns a working call into a 404 for no visible reason.
async function getMessaging(path, auth) {
  const res  = await fetch(`${MESSAGING_API}${path}`, { headers: { Authorization: `Basic ${auth}` } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
