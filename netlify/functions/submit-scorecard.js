// netlify/functions/submit-scorecard.js
//
// POST endpoint that records the PM's scorecard for a completed task.
//
// Updates the timeline task with:
//   - Scope compliance              (select)
//   - Schedule adherence            (select)
//   - Cleanliness                   (select)
//   - Communication                 (select)
//   - Invoice vs estimate           (select)
//   - Subcontractor performance notes (rich_text)
//
// Body (JSON):
//   {
//     taskId:            notion page id
//     scopeCompliance:   "Excellent" | "Good" | "Fair" | "Poor" | "N/A" | null
//     scheduleAdherence: ...
//     cleanliness:       ...
//     communication:     ...
//     invoiceVsEstimate: ...
//     performanceNotes:  string (optional)
//   }
//
// Null/missing rating fields are skipped (not cleared) so the PM can submit
// partial updates without wiping a rating they didn't intend to change.

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const VALID_RATINGS = ['Excellent', 'Good', 'Fair', 'Poor', 'N/A'];

const RATING_FIELDS = {
  scopeCompliance:   'Scope compliance',
  scheduleAdherence: 'Schedule adherence',
  cleanliness:       'Cleanliness',
  communication:     'Communication',
  invoiceVsEstimate: 'Invoice vs estimate',
};

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

  if (!payload.taskId) return reply(400, { error: 'taskId is required' });

  // Validate each rating value.
  for (const [key, fieldName] of Object.entries(RATING_FIELDS)) {
    const v = payload[key];
    if (v != null && v !== '' && !VALID_RATINGS.includes(v)) {
      return reply(400, {
        error: `Invalid value for ${fieldName}: "${v}". Must be one of ${VALID_RATINGS.join(', ')}.`,
      });
    }
  }

  // Build the properties patch.
  const properties = {};
  for (const [key, fieldName] of Object.entries(RATING_FIELDS)) {
    const v = payload[key];
    if (v != null && v !== '') {
      properties[fieldName] = { select: { name: v } };
    }
  }
  if (typeof payload.performanceNotes === 'string') {
    // Allow clearing by sending empty string; otherwise truncate to Notion's
    // 2000-char rich_text block limit.
    const text = payload.performanceNotes.trim();
    properties['Subcontractor performance notes'] = {
      rich_text: text
        ? [{ type: 'text', text: { content: text.slice(0, 2000) } }]
        : [],
    };
  }

  if (Object.keys(properties).length === 0) {
    return reply(400, { error: 'Nothing to update — send at least one rating or notes.' });
  }

  try {
    const res = await fetch(`${NOTION_API}/pages/${payload.taskId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) {
      const errText = await res.text();
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
      updatedFields: Object.keys(properties),
    });
  } catch (err) {
    console.error('submit-scorecard error:', err);
    return reply(500, { error: err.message });
  }
};
