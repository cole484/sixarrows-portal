// netlify/functions/notion-clients.js
// Reads the SAB Customers Tracker database
// Returns all client records with their metadata and Notion page IDs

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ── SAB Tracker page IDs (manually maintained until full automation) ──────────
// Maps client name (lowercase, normalized) to their SAB tracker Notion page ID
// These are read-only — the portal fetches checkboxes from these pages
const SAB_TRACKER_PAGE_IDS = {
  'kandaswamy family':  '2fb4737b-ea6f-80dc-9b3b-c4fac53c95ff',
  'nagornay':           '2d14737b-ea6f-8095-bd88-db56917e914f',
  'johnson':            '2d14737b-ea6f-8010-a5bf-dae373403326',
  'hoops':              '2df4737b-ea6f-8011-b095-f3e5ac22137c',
  'howard':             '2f84737b-ea6f-80b8-90dc-edb340717f47',
};

// ── Timeline database IDs per client ─────────────────────────────────────────
// Maps client name (lowercase, normalized) to their timeline Notion database ID
// Add each client's timeline DB ID here as you create them in Notion
const TIMELINE_DB_IDS = {
  // 'malone': '2424737b-ea6f-806a-b663-fb606aa00300', // example
  // Add your active clients here:
  // 'hoops': '...',
  // 'howard': '...',
};

// ── Notion helpers ────────────────────────────────────────────────────────────
async function notionPost(path, body, token) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Parse a client record from the SAB Customers Tracker ─────────────────────
function parseClientRecord(page) {
  const props = page.properties;

  function getText(prop) {
    if (!prop) return '';
    if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || '';
    if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || '';
    return '';
  }

  function getStatus(prop) {
    if (!prop) return null;
    return prop.status?.name || prop.select?.name || null;
  }

  function getDate(prop) {
    if (!prop || prop.type !== 'date') return null;
    return prop.date?.start || null;
  }

  function getUrl(prop) {
    if (!prop || prop.type !== 'url') return null;
    return prop.url || null;
  }

  const customerName = getText(props['Customer']);
  const normalizedName = customerName.toLowerCase().trim();

  // Look up Notion page IDs for this client
  const sabTrackerPageId = Object.entries(SAB_TRACKER_PAGE_IDS).find(
    ([key]) => normalizedName.includes(key) || key.includes(normalizedName.split(' ')[0])
  )?.[1] || null;

  const timelineDbId = Object.entries(TIMELINE_DB_IDS).find(
    ([key]) => normalizedName.includes(key) || key.includes(normalizedName.split(' ')[0])
  )?.[1] || null;

  // Map Notion phase to portal phase type
  const notionPhase = getStatus(props['Phase']);
  const statusType = ['Under Construction!'].includes(notionPhase)
    ? 'construction'
    : 'sab';

  return {
    notionPageId: page.id,
    customerName,
    normalizedName,
    phase: notionPhase,
    statusType,
    blueprintStatus: getStatus(props['Blueprint Status']),
    startDate: getDate(props['Start Date']),
    potentialBuildStart: getText(props['Potential Build Start Date']),
    nextActionStep: getText(props['Next Action Step']),
    nextActionDueDate: getDate(props['Next Action Due date']),
    budgetLink: getUrl(props['Budget Link']),
    notes: getText(props['Notes']),
    // Notion connections
    sabTrackerPageId,
    timelineDbId,
    lastEdited: page.last_edited_time,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) return respond(500, { error: 'NOTION_TOKEN not configured' });

  // SAB Customers Tracker database ID
  const SAB_CUSTOMERS_DB_ID = process.env.SAB_CUSTOMERS_DB_ID || '2224737b-ea6f-8026-97e1-c3c501ad55e2';

  try {
    const allResults = [];
    let cursor = undefined;

    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const data = await notionPost(`/databases/${SAB_CUSTOMERS_DB_ID}/query`, body, token);
      allResults.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const clients = allResults
      .map(parseClientRecord)
      .filter(c => c.customerName) // remove empty rows
      .sort((a, b) => a.customerName.localeCompare(b.customerName));

    return respond(200, {
      count: clients.length,
      clients,
      _meta: {
        databaseId: SAB_CUSTOMERS_DB_ID,
        fetchedAt: new Date().toISOString(),
      },
    });

  } catch (err) {
    console.error('notion-clients error:', err);
    return respond(500, { error: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}
