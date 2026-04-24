// netlify/functions/contractor-messages.js
// Contractor messaging — drafts, approvals, and the contractor-facing
// confirmation flow.
//
// Admin endpoints (require Bearer ADMIN_PASSWORD):
//   POST   ?action=draft                   body: { projectId, taskId, purpose? }
//          Creates a draft message + action_item for PM approval.
//   PATCH  ?id=xxx&action=approve          body: { body? }  (body optional edit)
//          Marks the draft sent, returns the message + confirm URL for copy-paste.
//          Also closes the associated action_item.
//   GET    ?projectId=xxx                  List messages for admin/debug.
//
// Public endpoints (no auth — token is the capability):
//   GET    ?token=xxx                      Read one message + task + client info
//                                          for the contractor's confirm page.
//   POST   ?token=xxx&action=respond       body: { response, proposed_start?, proposed_notes? }
//                                          Contractor records Confirm/Decline/Propose.

import { respond, corsHeaders } from './lib/supabase-client.js';
import { logEventSafe, closeActionItem } from './lib/events.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';
// DEPLOY_PRIME_URL = the URL the site is currently served at (preview URL
// for deploy-preview contexts, production URL for main). Prefer it so
// preview-built confirm links point to the same preview.
const SITE_URL = () => process.env.DEPLOY_PRIME_URL || process.env.URL || '';

function sbHeaders(prefer) {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    'Prefer': prefer || 'return=representation',
  };
}

async function sbFetch(path, options = {}) {
  const mergedHeaders = { ...sbHeaders(options.prefer), ...(options.headers || {}) };
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { ...options, headers: mergedHeaders });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function checkAdminAuth(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === ADMIN_PASSWORD();
}

function randomToken() {
  // 32 hex chars (128 bits) — plenty for a capability URL
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fmtDate(d) {
  if (!d) return 'TBD';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function buildMessageBody({ contractor_name, task_name, client_name, address, planned_start, duration_days, confirm_url }) {
  const name = contractor_name || 'there';
  const dur = duration_days && duration_days > 0 ? `${duration_days} day${duration_days === 1 ? '' : 's'}` : 'TBD';
  const where = [client_name, address].filter(Boolean).join(' — ');
  return (
`Hi ${name},

You're on the schedule for:
${task_name}
${where ? where + '\n' : ''}Start: ${fmtDate(planned_start)} (${dur})

Please tap to confirm, decline, or propose an alternate start date:
${confirm_url}

Thanks — Six Arrows Construction`
  );
}

// ── Draft handler (admin) ─────────────────────────────────
async function handleDraft(body) {
  const { projectId, taskId, purpose = 'initial_schedule' } = body;
  if (!projectId || !taskId) return respond(400, { error: 'projectId and taskId required' });

  // Load task + client + (optional) subcontractor
  const [task, client] = await Promise.all([
    sbFetch(`project_schedule?id=eq.${taskId}&project_id=eq.${encodeURIComponent(projectId)}&select=*`).then(r => r?.[0]),
    sbFetch(`clients?id=eq.${encodeURIComponent(projectId)}&select=*`).then(r => r?.[0]),
  ]);
  if (!task) return respond(404, { error: 'Task not found' });
  if (!client) return respond(404, { error: 'Client not found' });

  let sub = null;
  if (task.subcontractor_id) {
    sub = await sbFetch(`subcontractors?id=eq.${task.subcontractor_id}&select=*`).then(r => r?.[0]);
  }

  const contactName  = sub?.name  || task.assigned_contractor || null;
  const contactPhone = sub?.phone || null;
  const contactEmail = sub?.email || null;

  const confirmToken = randomToken();
  const base = SITE_URL() || 'https://example.invalid';
  const confirmUrl = `${base.replace(/\/$/, '')}/confirm.html?token=${confirmToken}`;

  const bodyText = buildMessageBody({
    contractor_name: contactName,
    task_name: task.task_name,
    client_name: client.client_name || client.clientName,
    address: client.address,
    planned_start: task.planned_start,
    duration_days: task.duration_days,
    confirm_url: confirmUrl,
  });

  const row = {
    project_id: projectId,
    task_id: taskId,
    subcontractor_id: task.subcontractor_id || null,
    contact_name: contactName,
    contact_phone: contactPhone,
    contact_email: contactEmail,
    direction: 'outbound',
    channel: 'copy_paste', // B1 default; B2 will flip to 'sms'
    purpose,
    status: 'pending_approval',
    body: bodyText,
    confirm_token: confirmToken,
  };
  const inserted = await sbFetch('contractor_messages', {
    method: 'POST',
    body: JSON.stringify(row),
  });
  const message = Array.isArray(inserted) ? inserted[0] : inserted;

  // Create the PM's action_item so it appears in Today
  const actionRow = {
    project_id: projectId,
    kind: 'approve_contractor_text',
    priority: 'yellow',
    title: `Review text to ${contactName || 'contractor'} — ${task.task_name}`,
    body: `Task scheduled for ${fmtDate(task.planned_start)}. Review and approve the draft message.`,
    task_id: taskId,
    related_entity_type: 'contractor_message',
    related_entity_id: message.id,
    dedupe_key: `contractor_approve:${message.id}`,
    status: 'open',
  };
  await sbFetch('action_items?on_conflict=dedupe_key', {
    method: 'POST',
    body: JSON.stringify(actionRow),
    prefer: 'return=representation,resolution=merge-duplicates',
  });

  await logEventSafe({
    projectId, taskId, actor: 'pm',
    eventType: 'contractor.message_drafted',
    payload: { message_id: message.id, contact_name: contactName, purpose },
  });

  return respond(201, { message, confirm_url: confirmUrl });
}

// ── Approve handler (admin) ───────────────────────────────
async function handleApprove(id, body) {
  if (!id) return respond(400, { error: 'id required' });

  const patch = { status: 'sent', sent_at: new Date().toISOString() };
  if (body && typeof body.body === 'string' && body.body.trim()) patch.body = body.body.trim();

  const updated = await sbFetch(`contractor_messages?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then(r => Array.isArray(r) ? r[0] : r);

  if (!updated) return respond(404, { error: 'Message not found' });

  // Close the related action_item (dedupe_key pattern)
  await closeActionItem({ dedupeKey: `contractor_approve:${id}`, completedBy: 'pm' }).catch(() => {});

  await logEventSafe({
    projectId: updated.project_id, taskId: updated.task_id, actor: 'pm',
    eventType: 'contractor.message_sent',
    payload: { message_id: id, channel: updated.channel },
  });

  const base = SITE_URL() || 'https://example.invalid';
  const confirmUrl = `${base.replace(/\/$/, '')}/confirm.html?token=${updated.confirm_token}`;
  return respond(200, { message: updated, confirm_url: confirmUrl });
}

// ── Public: read message by token ─────────────────────────
async function handleGetByToken(token) {
  if (!token) return respond(400, { error: 'token required' });

  const message = await sbFetch(
    `contractor_messages?confirm_token=eq.${encodeURIComponent(token)}&select=*`
  ).then(r => r?.[0]);
  if (!message) return respond(404, { error: 'Message not found' });

  const [task, client] = await Promise.all([
    sbFetch(`project_schedule?id=eq.${message.task_id}&select=id,task_name,phase,trade,planned_start,planned_finish,duration_days,contractor_scope,definition_of_done`).then(r => r?.[0]),
    sbFetch(`clients?id=eq.${encodeURIComponent(message.project_id)}&select=client_name,address`).then(r => r?.[0]),
  ]);

  return respond(200, { message, task, client });
}

// ── Public: contractor response ───────────────────────────
async function handleRespond(token, body) {
  if (!token) return respond(400, { error: 'token required' });
  const { response, proposed_start, proposed_notes } = body || {};
  if (!['confirmed', 'declined', 'alternate_proposed'].includes(response)) {
    return respond(400, { error: 'response must be confirmed | declined | alternate_proposed' });
  }
  if (response === 'alternate_proposed' && !proposed_start) {
    return respond(400, { error: 'proposed_start required for alternate_proposed' });
  }

  const existing = await sbFetch(
    `contractor_messages?confirm_token=eq.${encodeURIComponent(token)}&select=*`
  ).then(r => r?.[0]);
  if (!existing) return respond(404, { error: 'Message not found' });

  const patch = {
    status: 'responded',
    response,
    responded_at: new Date().toISOString(),
  };
  if (response === 'alternate_proposed') {
    patch.proposed_start = proposed_start;
    patch.proposed_notes = proposed_notes || null;
  }

  await sbFetch(`contractor_messages?id=eq.${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    prefer: 'return=minimal',
  });

  // Side effects per response
  const projectId = existing.project_id;
  const taskId = existing.task_id;
  const actor = `contractor:${existing.subcontractor_id || 'unknown'}`;

  if (response === 'confirmed') {
    await sbFetch(`project_schedule?id=eq.${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ contractor_confirmed: true }),
      prefer: 'return=minimal',
    }).catch(() => {});
    await logEventSafe({
      projectId, taskId, actor,
      eventType: 'contractor.confirmed',
      payload: { message_id: existing.id, contact_name: existing.contact_name },
    });
  } else if (response === 'declined') {
    await logEventSafe({
      projectId, taskId, actor,
      eventType: 'contractor.declined',
      payload: { message_id: existing.id, contact_name: existing.contact_name },
    });
    // PM needs to react — create an action item
    await sbFetch('action_items?on_conflict=dedupe_key', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        kind: 'reschedule_response',
        priority: 'red',
        title: `${existing.contact_name || 'Contractor'} declined — needs reassignment`,
        body: 'Contractor declined the assignment. Reassign or find a new sub.',
        task_id: taskId,
        related_entity_type: 'contractor_message',
        related_entity_id: existing.id,
        dedupe_key: `contractor_declined:${existing.id}`,
      }),
      prefer: 'return=minimal,resolution=merge-duplicates',
    }).catch(() => {});
  } else {
    await logEventSafe({
      projectId, taskId, actor,
      eventType: 'contractor.proposed_alternate',
      payload: { message_id: existing.id, proposed_start, proposed_notes },
    });
    await sbFetch('action_items?on_conflict=dedupe_key', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        kind: 'reschedule_response',
        priority: 'yellow',
        title: `${existing.contact_name || 'Contractor'} proposed ${fmtDate(proposed_start)}`,
        body: proposed_notes || 'Contractor proposed an alternate start date. Review and accept or counter.',
        task_id: taskId,
        related_entity_type: 'contractor_message',
        related_entity_id: existing.id,
        dedupe_key: `contractor_alt:${existing.id}`,
      }),
      prefer: 'return=minimal,resolution=merge-duplicates',
    }).catch(() => {});
  }

  return respond(200, { ok: true, response });
}

// ── Handler ───────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };

  try {
    const params = event.queryStringParameters || {};
    const action = params.action;
    const token = params.token;
    const id = params.id;
    const body = event.body ? JSON.parse(event.body) : {};

    // Public (token-based) routes
    if (token && event.httpMethod === 'GET') {
      return await handleGetByToken(token);
    }
    if (token && event.httpMethod === 'POST' && action === 'respond') {
      return await handleRespond(token, body);
    }

    // Admin routes
    if (!checkAdminAuth(event)) return respond(401, { error: 'Unauthorized' });

    if (event.httpMethod === 'POST' && action === 'draft') {
      return await handleDraft(body);
    }
    if (event.httpMethod === 'PATCH' && action === 'approve') {
      return await handleApprove(id, body);
    }
    if (event.httpMethod === 'GET' && params.projectId) {
      const msgs = await sbFetch(
        `contractor_messages?project_id=eq.${encodeURIComponent(params.projectId)}&order=created_at.desc`
      );
      return respond(200, { messages: msgs || [] });
    }

    return respond(400, { error: 'Unknown route. See function header for usage.' });
  } catch (err) {
    console.error('contractor-messages error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};
