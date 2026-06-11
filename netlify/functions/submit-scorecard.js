// netlify/functions/submit-scorecard.js
//
// POST endpoint that records the PM's scorecard for a completed task.
//
// Scoring model: 4 categories × 25 points = 100 total.
//   - Schedule Adherence (number 0–25)
//   - Site Cleanliness   (number 0–25)
//   - Budget Adherence   (number 0–25)
//   - Quality of Work    (number 0–25)
//   - Sub Score          (number 0–100, computed total)
//
// Plus three free-text fields:
//   - Score: Positives                (rich_text, shared with sub)
//   - Score: Improvements             (rich_text, shared with sub)
//   - Subcontractor performance notes (rich_text, internal only)
//
// Body (JSON):
//   {
//     taskId:             notion page id
//     scheduleAdherence:  number 0–25 | null
//     siteCleanliness:    number 0–25 | null
//     budgetAdherence:    number 0–25 | null
//     qualityOfWork:      number 0–25 | null
//     subScore:           number 0–100 | null   (optional — recomputed if all 4 categories present)
//     positives:          string (optional)
//     improvements:       string (optional)
//     internalNotes:      string (optional)
//   }
//
// Null/missing fields are skipped (not cleared) so the PM can submit partial
// updates without wiping a value they didn't intend to change.

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const CATEGORY_FIELDS = {
  scheduleAdherence: 'Schedule Adherence',
  siteCleanliness:   'Site Cleanliness',
  budgetAdherence:   'Budget Adherence',
  qualityOfWork:     'Quality of Work',
};

const TEXT_FIELDS = {
  positives:     'Score: Positives',
  improvements:  'Score: Improvements',
  internalNotes: 'Subcontractor performance notes',
};

function richText(text) {
  const t = (text || '').toString().trim();
  return {
    rich_text: t
      ? [{ type: 'text', text: { content: t.slice(0, 2000) } }]
      : [],
  };
}

function validInt(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NaN';
  if (n < min || n > max) return 'OOR';
  return n;
}

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

  // Validate each category score (0–25 integer).
  const categoryNumbers = {};
  for (const [key, fieldName] of Object.entries(CATEGORY_FIELDS)) {
    const v = validInt(payload[key], 0, 25);
    if (v === 'NaN' || v === 'OOR') {
      return reply(400, { error: `${fieldName} must be a number between 0 and 25.` });
    }
    if (v !== null) categoryNumbers[fieldName] = v;
  }

  // Build the properties patch.
  const properties = {};
  for (const [fieldName, num] of Object.entries(categoryNumbers)) {
    properties[fieldName] = { number: num };
  }

  // Sub Score: use payload value if provided, otherwise sum the 4 categories
  // if all four are present.
  let subScore = validInt(payload.subScore, 0, 100);
  if (subScore === 'NaN' || subScore === 'OOR') {
    return reply(400, { error: 'subScore must be a number between 0 and 100.' });
  }
  if (subScore === null && Object.keys(categoryNumbers).length === 4) {
    subScore = Object.values(categoryNumbers).reduce((a, b) => a + b, 0);
  }
  if (subScore !== null) properties['Sub Score'] = { number: subScore };

  // Text fields.
  for (const [key, fieldName] of Object.entries(TEXT_FIELDS)) {
    if (typeof payload[key] === 'string') {
      properties[fieldName] = richText(payload[key]);
    }
  }

  if (Object.keys(properties).length === 0) {
    return reply(400, { error: 'Nothing to update — send at least one score or note.' });
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
      success:     true,
      taskId:      payload.taskId,
      submittedAt: new Date().toISOString(),
      subScore,
      updatedFields: Object.keys(properties),
    });
  } catch (err) {
    console.error('submit-scorecard error:', err);
    return reply(500, { error: err.message });
  }
};
