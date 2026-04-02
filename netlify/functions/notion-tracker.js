// netlify/functions/notion-tracker.js
// Reads a client's SAB Blueprint tracker page from Notion
// Returns step completion state matching the portal's data structure

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ── Step definitions matching the portal's sabPhases structure ────────────────
// These are the canonical item texts we look for in each step's checkboxes.
// The parser matches on substring — so "Topographical considerations" matches
// the full checkbox text regardless of extra client-specific notes added.
const STEP_DEFINITIONS = [
  // Phase 1 — Design & Architecture
  {
    phase: 0, step: 0,
    title: 'Site Analysis & Land Review',
    markers: ['Topographical considerations', 'Setbacks and zoning', 'Utilities assessed', 'Slope & foundation'],
  },
  {
    phase: 0, step: 1,
    title: 'Concept Floor Plan',
    markers: ['Bed/bath count confirmed', 'Interior flow approved', 'Architectural style selected', 'Initial floor plan draft', 'Final floor plan approved'],
  },
  {
    phase: 0, step: 2,
    title: 'Full Architectural Plans',
    markers: ['Foundation plan', 'Framing plan', 'Roof plan', 'Elevations', 'Window/door schedules'],
  },
  {
    phase: 0, step: 3,
    title: 'MEP Planning',
    markers: ['Unit locations determined', 'Returns & supplies mapped', 'Outlet & switch layouts', 'Water heater type'],
  },
  // Phase 2 — Selections & Specifications
  {
    phase: 1, step: 0,
    title: 'Selections Kickoff',
    markers: ['Timeline for decisions on each wave', 'Introduce The Wave'],
  },
  {
    phase: 1, step: 1,
    title: 'Wave 1 — Structure',
    markers: ['Fireplace details', 'Appliances', 'Garage doors selected', 'Begin building Budget'],
  },
  {
    phase: 1, step: 2,
    title: 'Wave 2 & 3 — Shell & Jewelry',
    markers: ['Cabinets selected', 'Flooring selected', 'Plumbing fixtures chosen', 'Countertops selected', 'Paint or stain colors'],
  },
  {
    phase: 1, step: 3,
    title: 'Final Selection Sheet',
    markers: ['All selections documented', 'No missing decisions'],
  },
  // Phase 3 — Budget, Timeline & Build-Ready
  {
    phase: 2, step: 0,
    title: 'Trade Bidding Pack Sent Out',
    markers: ['Full plans sent to trades', 'Specifications distributed', 'Scope sheets provided'],
  },
  {
    phase: 2, step: 1,
    title: 'Final Budget Review',
    markers: ['All trade bids received', 'Budget presentation'],
  },
  {
    phase: 2, step: 2,
    title: 'Build Timeline & Scheduling',
    markers: ['Master build sequence created', 'Timeline shared via Notion'],
  },
  {
    phase: 2, step: 3,
    title: 'Build-Ready Package',
    markers: ['Final plans compiled', 'Final budget approved', 'Contracts prepared'],
  },
  {
    phase: 2, step: 4,
    title: 'Build Ready — Kickoff',
    markers: ['Loan documents prepared', 'Construction start week locked'],
  },
  {
    phase: 2, step: 5,
    title: 'Share Your SAB™ Experience',
    markers: ['Review shared'],
  },
];

// ── Notion API helpers ────────────────────────────────────────────────────────
async function notionGet(path, token) {
  const res = await fetch(`${NOTION_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Parse blocks into a flat list of {type, text, checked} ───────────────────
function flattenBlocks(blocks) {
  const items = [];
  for (const block of blocks) {
    if (block.type === 'to_do') {
      const text = block.to_do.rich_text.map(t => t.plain_text).join('');
      items.push({ type: 'todo', text, checked: block.to_do.checked });
    } else if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const key = block.type === 'bulleted_list_item' ? 'bulleted_list_item' : 'numbered_list_item';
      const text = block[key].rich_text.map(t => t.plain_text).join('');
      items.push({ type: 'list', text });
    } else if (['heading_1','heading_2','heading_3'].includes(block.type)) {
      const key = block.type;
      const text = block[key].rich_text.map(t => t.plain_text).join('');
      items.push({ type: 'heading', text });
    } else if (block.type === 'paragraph') {
      const text = block.paragraph.rich_text.map(t => t.plain_text).join('');
      if (text.trim()) items.push({ type: 'paragraph', text });
    }
    // Recurse into children if they exist (Notion API paginates these separately)
    if (block.has_children && block._children) {
      items.push(...flattenBlocks(block._children));
    }
  }
  return items;
}

// ── Fetch all blocks from a page (handles pagination) ────────────────────────
async function fetchAllBlocks(pageId, token) {
  const allBlocks = [];
  let cursor = undefined;

  do {
    const url = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionGet(url, token);
    allBlocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Fetch children for blocks that have them (to_do items with sub-items)
  for (const block of allBlocks) {
    if (block.has_children) {
      try {
        const childData = await notionGet(`/blocks/${block.id}/children?page_size=100`, token);
        block._children = childData.results;
      } catch (e) {
        // Non-critical — continue without children
        block._children = [];
      }
    }
  }

  return allBlocks;
}

// ── Determine step completion from flat block list ───────────────────────────
function computeStepState(allItems) {
  const stepStates = {};

  for (const def of STEP_DEFINITIONS) {
    const key = `${def.phase}-${def.step}`;
    let totalMarkers = 0;
    let checkedMarkers = 0;

    for (const marker of def.markers) {
      // Find matching todo items
      const matching = allItems.filter(
        item => item.type === 'todo' && item.text.toLowerCase().includes(marker.toLowerCase())
      );
      if (matching.length > 0) {
        totalMarkers++;
        if (matching.some(m => m.checked)) checkedMarkers++;
      }
    }

    // Step is complete if all found markers are checked (or no markers found = use heading logic)
    const complete = totalMarkers > 0
      ? checkedMarkers === totalMarkers
      : false;

    const pct = totalMarkers > 0
      ? Math.round((checkedMarkers / totalMarkers) * 100)
      : 0;

    stepStates[key] = {
      complete,
      checkedCount: checkedMarkers,
      totalCount: totalMarkers,
      pct,
    };
  }

  return stepStates;
}

// ── Compute phase completion ──────────────────────────────────────────────────
function computePhaseState(stepStates) {
  const phases = [
    { steps: [0,1,2,3], label: 'Design & Architecture', milestoneDesc: 'Complete buildable drawings ready for selections.' },
    { steps: [4,5,6,7], label: 'Selections & Specifications', milestoneDesc: 'All finishes and specifications chosen before construction.' },
    { steps: [8,9,10,11,12,13], label: 'Budget, Timeline & Build-Ready', milestoneDesc: 'Full budget approved, timeline set, ready to break ground.' },
  ];

  return phases.map((ph, pi) => {
    const stepKeys = ph.steps.map(s => {
      // Find the step definition for this phase/step index
      const def = STEP_DEFINITIONS.find(d => d.phase === pi && d.step === ph.steps.indexOf(s));
      return def ? `${def.phase}-${def.step}` : null;
    }).filter(Boolean);

    const allComplete = stepKeys.every(k => stepStates[k]?.complete);
    const anyStarted  = stepKeys.some(k => (stepStates[k]?.checkedCount || 0) > 0);

    return {
      label: ph.label,
      milestoneDesc: ph.milestoneDesc,
      complete: allComplete,
      started: anyStarted,
      steps: stepKeys.map(k => ({
        key: k,
        ...stepStates[k],
      })),
    };
  });
}

// ── Compute overall build readiness % ────────────────────────────────────────
function computeReadiness(stepStates) {
  let totalItems = 0;
  let checkedItems = 0;
  for (const state of Object.values(stepStates)) {
    totalItems  += state.totalCount;
    checkedItems += state.checkedCount;
  }
  return totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return respond(500, { error: 'NOTION_TOKEN not configured' });
  }

  const pageId = event.queryStringParameters?.pageId;
  if (!pageId) {
    return respond(400, { error: 'pageId query parameter required' });
  }

  try {
    // Fetch page metadata
    const page = await notionGet(`/pages/${pageId}`, token);
    const lastEdited = page.last_edited_time;

    // Fetch all blocks
    const blocks = await fetchAllBlocks(pageId, token);
    const allItems = flattenBlocks(blocks);

    // Compute states
    const stepStates  = computeStepState(allItems);
    const phaseStates = computePhaseState(stepStates);
    const readiness   = computeReadiness(stepStates);

    return respond(200, {
      pageId,
      lastEdited,
      readiness,
      phases: phaseStates,
      steps: stepStates,
      // Raw item count for debugging
      _meta: { blockCount: blocks.length, itemCount: allItems.length },
    });

  } catch (err) {
    console.error('notion-tracker error:', err);
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
