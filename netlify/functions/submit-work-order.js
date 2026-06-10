// netlify/functions/submit-work-order.js
//
// POST endpoint that records a subcontractor's commitment back to Notion.
// Called when a sub clicks "Submit Work Order" on the work-order page.
//
// PATCHes the timeline task with:
//   - Start          (date range, overwritten with sub's committed dates)
//   - Sub Commitment (rich_text, structured human-readable summary)
//   - Status         (set to "Scheduled")
//
// Body (JSON):
//   {
//     taskId:            notion page id
//     committedStart:    "YYYY-MM-DD"
//     committedEnd:      "YYYY-MM-DD"
//     workingDays:       number | null
//     paymentType:       "single" | "two" | "three"
//     paymentMilestones: [{ pct, milestone }, ...]
//     preStartBlockers:  string (optional)
//     notes:             string (optional)
//     signatureName:     string
//     contractValue:     number
//     holdbackPct:       number (0 if none)
//     trade:             string
//     projectName:       string
//     pmName:            string
//   }

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export const handler = async (event) => {
  const corsH = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type':                 'application/json',
  };
  const reply = (statusCode, body) =>
    ({ statusCode, headers: corsH, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsH, body: '' };
  if (event.httpMethod !== 'POST')    return reply(405, { error: 'POST required' });

  const token = process.env.NOTION_TOKEN;
  if (!token) return reply(500, { error: 'NOTION_TOKEN not set' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'Invalid JSON body' }); }

  // ── Validate ───────────────────────────────────────────────────────────
  const required = ['taskId', 'signatureName', 'committedStart', 'committedEnd', 'paymentType'];
  for (const k of required) {
    if (!payload[k] || (typeof payload[k] === 'string' && !payload[k].trim())) {
      return reply(400, { error: `${k} is required` });
    }
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(payload.committedStart) || !dateRe.test(payload.committedEnd)) {
    return reply(400, { error: 'committedStart and committedEnd must be YYYY-MM-DD' });
  }
  if (payload.committedEnd < payload.committedStart) {
    return reply(400, { error: 'committedEnd cannot be before committedStart' });
  }
  if (!['single', 'two', 'three'].includes(payload.paymentType)) {
    return reply(400, { error: 'paymentType must be single, two, or three' });
  }

  const commitmentText = buildCommitmentText(payload);

  // ── PATCH the Notion task ─────────────────────────────────────────────
  const updateBody = {
    properties: {
      // Overwrite Start with sub's committed window (Notion date range).
      'Start': {
        date: {
          start: payload.committedStart,
          end:   payload.committedEnd,
        },
      },
      // Human-readable commitment record. Truncated to Notion's 2000-char limit.
      'Sub Commitment': {
        rich_text: [{
          type: 'text',
          text: { content: commitmentText.slice(0, 2000) },
        }],
      },
      // Flip status — sub has confirmed, treat as Scheduled.
      'Status': {
        status: { name: 'Scheduled' },
      },
    },
  };

  try {
    const res = await fetch(`${NOTION_API}/pages/${payload.taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(updateBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Surface Notion's actual error so misconfig (missing column, status name
      // mismatch, etc.) is visible to the caller.
      return reply(502, {
        error: 'Notion update failed',
        notionStatus: res.status,
        notionError:  errText.slice(0, 800),
      });
    }

    return reply(200, {
      success:    true,
      taskId:     payload.taskId,
      submittedAt: new Date().toISOString(),
      commitmentPreview: commitmentText,
    });
  } catch (err) {
    console.error('submit-work-order error:', err);
    return reply(500, { error: err.message });
  }
};

// ── Build a human-readable commitment record for the Sub Commitment field ──
function buildCommitmentText(d) {
  const tsCT = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  });
  const startNice = fmtDate(d.committedStart);
  const endNice   = fmtDate(d.committedEnd);
  const days      = diffDays(d.committedStart, d.committedEnd);

  const lines = [];
  lines.push(`Signed: ${d.signatureName.trim()}`);
  lines.push(`Submitted: ${tsCT}`);
  lines.push('');
  if (d.trade)       lines.push(`Trade: ${d.trade}`);
  if (d.projectName) lines.push(`Project: ${d.projectName}`);
  lines.push('');
  lines.push(`Committed window: ${startNice} – ${endNice} (${days} day${days === 1 ? '' : 's'})`);
  if (d.workingDays) {
    lines.push(`Working days on site: ${d.workingDays}`);
  }
  lines.push('');
  if (typeof d.contractValue === 'number' && d.contractValue > 0) {
    lines.push(`Contract value: $${Number(d.contractValue).toLocaleString('en-US')}`);
  }
  lines.push('');
  lines.push(`Payment schedule: ${labelForPaymentType(d.paymentType)}`);
  if (Array.isArray(d.paymentMilestones)) {
    for (const m of d.paymentMilestones) {
      const pct = (m.pct != null ? `${m.pct}%` : '?').padStart(4);
      lines.push(`  ${pct}  ${m.milestone || '(unlabeled)'}`);
    }
  }
  if (d.holdbackPct > 0) {
    lines.push(`  ${d.holdbackPct}%  Holdback (released after final approval)`);
  }
  lines.push('');
  if (d.preStartBlockers && d.preStartBlockers.trim()) {
    lines.push(`Pre-start blockers/needs:`);
    lines.push(d.preStartBlockers.trim());
    lines.push('');
  }
  if (d.notes && d.notes.trim()) {
    lines.push(`Notes for ${d.pmName || 'PM'}:`);
    lines.push(d.notes.trim());
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fmtDate(yyyyMmDd) {
  try {
    const d = new Date(yyyyMmDd + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return yyyyMmDd; }
}

function diffDays(startStr, endStr) {
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr   + 'T00:00:00');
  return Math.round((e - s) / 86400000) + 1;
}

function labelForPaymentType(t) {
  return {
    single: 'Single payment on completion',
    two:    'Two payments',
    three:  'Three payments',
  }[t] || t;
}
