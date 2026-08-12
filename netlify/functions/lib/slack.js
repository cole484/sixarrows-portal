// netlify/functions/lib/slack.js
//
// Minimal Slack sender for agent notifications. No SDK, just chat.postMessage.
//
// Required env:
//   SLACK_BOT_TOKEN       xoxb-... from a Slack app with chat:write.
//                         Add im:write as well to DM a person.
// Optional env:
//   SLACK_DIGEST_TARGET   where notifications go. Defaults to Cole's DM.
//
// A target is either a user id (U...) or a channel id (C...). chat.postMessage
// treats both the same, so moving the digest from a DM to #scheduling later is
// a change to this one env var, not a code change. Per-owner routing (DM the
// person named in the task's Decision Owner) plugs in at resolveTarget when
// that is wanted; today every notification goes to the single default.

const SLACK_API = 'https://slack.com/api';

// Cole. Overridden by SLACK_DIGEST_TARGET.
const DEFAULT_TARGET = 'U0AG36VPDBL';

// Slack accepts 40k characters in `text`, but long messages render badly and
// get truncated in notifications. Split well below that, on line boundaries.
const CHUNK_CHARS = 2800;

export function slackConfigured() {
  return !!process.env.SLACK_BOT_TOKEN;
}

export function resolveTarget() {
  return process.env.SLACK_DIGEST_TARGET || DEFAULT_TARGET;
}

// Split on newlines so a message never breaks mid-line. A single line longer
// than the limit is passed through rather than cut, since truncating a task
// name mid-word is worse than one slightly long message.
function chunk(text, max = CHUNK_CHARS) {
  const out = [];
  let buf = '';
  for (const line of String(text).split('\n')) {
    if (buf && buf.length + line.length + 1 > max) {
      out.push(buf);
      buf = line;
    } else {
      buf = buf ? `${buf}\n${line}` : line;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [''];
}

async function postMessage(body) {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type':  'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // Slack returns HTTP 200 with ok:false for real errors, so the status code
  // alone is not enough to tell whether anything was delivered.
  if (!data.ok) throw new Error(`Slack ${body.channel}: ${data.error || `http ${res.status}`}`);
  return data;
}

// Sends `text` to the resolved target, threading any overflow under the first
// message so a long digest stays one item in the sidebar.
export async function sendSlack(text, opts = {}) {
  if (!slackConfigured()) throw new Error('SLACK_BOT_TOKEN not set');

  const channel = opts.target || resolveTarget();
  const parts   = chunk(text);

  const first = await postMessage({
    channel,
    text: parts[0],
    unfurl_links: false,
    unfurl_media: false,
  });

  for (const part of parts.slice(1)) {
    await postMessage({
      channel,
      text: part,
      thread_ts: first.ts,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  return { channel, ts: first.ts, messages: parts.length };
}
