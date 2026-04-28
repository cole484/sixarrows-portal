// netlify/functions/lib/events.js
// Event log emitter + effect executor.
//
// Every state change in the system writes an `events` row. Automation
// rules (coming in Phase C) will read events and produce "effects" —
// intents like `create_action_item` — which applyEffects() materializes.
//
// For Phase A, rules aren't wired yet. logEvent() just appends to the
// log; tests / admin buttons can hand-create action items via
// createActionItem().

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

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

// ── Event emitter ──────────────────────────────────────────
// Appends one row to `events`. Best-effort — a failure here should
// not break the caller's primary mutation. Wrap call sites in
// try/catch or use the logEventSafe() variant.

export async function logEvent({ projectId, eventType, taskId = null, actor = 'system', payload = {} }) {
  if (!projectId || !eventType) throw new Error('logEvent requires projectId and eventType');
  const row = {
    project_id: projectId,
    event_type: eventType,
    task_id: taskId,
    actor,
    payload,
  };
  const result = await sbFetch('events', {
    method: 'POST',
    body: JSON.stringify(row),
    prefer: 'return=representation',
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function logEventSafe(args) {
  try { return await logEvent(args); }
  catch (err) { console.error('logEvent failed (non-fatal):', err.message, args); return null; }
}

// ── Action item helpers ────────────────────────────────────

export async function createActionItem({
  projectId, kind, title, body = null, priority = 'normal',
  taskId = null, relatedEntityType = null, relatedEntityId = null,
  dueAt = null, dedupeKey = null,
}) {
  if (!projectId || !kind || !title) throw new Error('createActionItem requires projectId, kind, title');
  const row = {
    project_id: projectId,
    kind, title, body, priority,
    task_id: taskId,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    due_at: dueAt,
    dedupe_key: dedupeKey,
    status: 'open',
  };
  // Upsert on dedupe_key so a rule that re-fires doesn't create duplicates.
  const result = await sbFetch('action_items?on_conflict=dedupe_key', {
    method: 'POST',
    body: JSON.stringify(row),
    prefer: 'return=representation,resolution=merge-duplicates',
  });
  return Array.isArray(result) ? result[0] : result;
}

export async function closeActionItem({ id, dedupeKey, completedBy = 'system' }) {
  const patch = { status: 'completed', completed_at: new Date().toISOString(), completed_by: completedBy };
  const filter = id ? `id=eq.${id}` : dedupeKey ? `dedupe_key=eq.${encodeURIComponent(dedupeKey)}` : null;
  if (!filter) throw new Error('closeActionItem requires id or dedupeKey');
  return await sbFetch(`action_items?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    prefer: 'return=minimal',
  });
}

// ── Effect executor (skeleton, for Phase C rules) ──────────
// Rules return typed effect descriptors; applyEffects() runs them.
// Keeping the shape here so Phase A callers can start emitting
// effects if they want, and Phase C just adds rule functions.

export async function applyEffects(effects = []) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'create_action_item':
        await createActionItem(effect);
        break;
      case 'close_action_item':
        await closeActionItem(effect);
        break;
      default:
        console.warn('Unknown effect type:', effect.type);
    }
  }
}
