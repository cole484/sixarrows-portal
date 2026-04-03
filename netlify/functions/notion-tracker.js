// netlify/functions/notion-tracker.js
// Reads a client's SAB Blueprint tracker page from Notion
// Supports two modes:
//   ?pageId=xxx           — standard mode (new builds): pattern-match against STEP_DEFINITIONS
//   ?pageId=xxx&dynamic=1 — dynamic mode (remodels): return full parsed structure from Notion

const NOTION_API     = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ── Step definitions for new build pattern matching ──────────────────────────
const STEP_DEFINITIONS = [
  { phase:0, step:0, title:'Site Analysis & Land Review',
    markers:['Topographical considerations','Setbacks and zoning','Utilities assessed','Slope & foundation'] },
  { phase:0, step:1, title:'Concept Floor Plan',
    markers:['Bed/bath count confirmed','Interior flow approved','Architectural style selected','Initial floor plan draft','Final floor plan approved'] },
  { phase:0, step:2, title:'Full Architectural Plans',
    markers:['Foundation plan','Framing plan','Roof plan','Elevations','Window/door schedules'] },
  { phase:0, step:3, title:'MEP Planning',
    markers:['Unit locations determined','Returns & supplies mapped','Outlet & switch layouts','Water heater type'] },
  { phase:1, step:0, title:'Selections Kickoff',
    markers:['Timeline for decisions on each wave','Introduce The Wave'] },
  { phase:1, step:1, title:'Wave 1 — Structure',
    markers:['Fireplace details','Appliances','Garage doors selected','Begin building Budget'] },
  { phase:1, step:2, title:'Wave 2 & 3 — Shell & Jewelry',
    markers:['Cabinets selected','Flooring selected','Plumbing fixtures chosen','Countertops selected','Paint or stain colors'] },
  { phase:1, step:3, title:'Final Selection Sheet',
    markers:['All selections documented','No missing decisions'] },
  { phase:2, step:0, title:'Trade Bidding Pack Sent Out',
    markers:['Full plans sent to trades','Specifications distributed','Scope sheets provided'] },
  { phase:2, step:1, title:'Final Budget Review',
    markers:['All trade bids received','Budget presentation'] },
  { phase:2, step:2, title:'Build Timeline & Scheduling',
    markers:['Master build sequence created','Timeline shared via Notion'] },
  { phase:2, step:3, title:'Build-Ready Package',
    markers:['Final plans compiled','Final budget approved','Contracts prepared'] },
  { phase:2, step:4, title:'Build Ready — Kickoff',
    markers:['Loan documents prepared','Construction start week locked'] },
  // Note: step 5 (isFinal "Share Your SAB") excluded — does not block phase completion
];

// ── Notion API helpers ───────────────────────────────────────────────────────
async function notionGet(path, token) {
  const res = await fetch(`${NOTION_API}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Fetch all blocks (with children) ────────────────────────────────────────
async function fetchAllBlocks(pageId, token) {
  const allBlocks = [];
  let cursor;
  do {
    const url = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionGet(url, token);
    allBlocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Fetch children for blocks that have them
  for (const block of allBlocks) {
    if (block.has_children) {
      try {
        const childData = await notionGet(`/blocks/${block.id}/children?page_size=100`, token);
        block._children = childData.results;
        // One more level for deeply nested items
        for (const child of block._children) {
          if (child.has_children) {
            try {
              const grandchildData = await notionGet(`/blocks/${child.id}/children?page_size=100`, token);
              child._children = grandchildData.results;
            } catch(e) { child._children = []; }
          }
        }
      } catch(e) { block._children = []; }
    }
  }
  return allBlocks;
}

// ── Flatten blocks into items ────────────────────────────────────────────────
function getText(block) {
  const type = block.type;
  if (!block[type]) return '';
  return (block[type].rich_text || []).map(t => t.plain_text).join('');
}

function flattenBlocks(blocks, depth = 0) {
  const items = [];
  for (const block of blocks) {
    if (block.type === 'to_do') {
      items.push({ type:'todo', text:getText(block), checked:block.to_do.checked, depth });
    } else if (['heading_1','heading_2','heading_3'].includes(block.type)) {
      items.push({ type:'heading', level: parseInt(block.type.slice(-1)), text:getText(block), depth });
    } else if (block.type === 'paragraph') {
      const t = getText(block).trim();
      if (t) items.push({ type:'paragraph', text:t, depth });
    } else if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      items.push({ type:'list', text:getText(block), depth });
    }
    // Recurse into children
    if (block._children?.length) {
      items.push(...flattenBlocks(block._children, depth + 1));
    }
  }
  return items;
}

// ── DYNAMIC MODE: parse Notion structure into phases/steps/items ─────────────
function parseDynamicStructure(allItems) {
  const phases = [];
  let currentPhase = null;
  let currentStep  = null;

  for (const item of allItems) {
    // H2 = new phase
    if (item.type === 'heading' && item.level === 2) {
      const match = item.text.match(/Phase\s+(\d+)\s*[—-]\s*(.+)/i);
      if (match) {
        currentPhase = {
          index:     phases.length,
          label:     item.text.replace(/^\s*Phase\s+\d+\s*[—-]\s*/i, '').trim(),
          goal:      '',
          milestone: '',
          milestoneDesc: '',
          steps:     [],
          complete:  false,
        };
        phases.push(currentPhase);
        currentStep = null;
      }
      continue;
    }

    // Italic paragraph after H2 = phase goal
    if (item.type === 'paragraph' && currentPhase && !currentPhase.steps.length && item.depth === 0) {
      currentPhase.goal = item.text.replace(/^\*|^\*\*|\*$|\*\*$/g, '').trim();
      continue;
    }

    // H3 = new step
    if (item.type === 'heading' && item.level === 3 && currentPhase) {
      const match = item.text.match(/Step\s+(\d+)\s*:\s*(.+)/i);
      if (match) {
        currentStep = {
          index:     currentPhase.steps.length,
          globalIdx: allItems.indexOf(item),
          title:     match[2].trim(),
          items:     [],   // { text, checked, depth }
          complete:  false,
          isFinal:   false,
        };
        currentPhase.steps.push(currentStep);
      }
      continue;
    }

    // Milestone line (🏅) — marks end of a phase section
    if (item.type === 'paragraph' && item.text.includes('🏅') && currentPhase) {
      const mMatch = item.text.match(/Milestone:\s*([^—]+)[—-]\s*\*(.+)\*/);
      if (mMatch) {
        currentPhase.milestone     = mMatch[1].trim();
        currentPhase.milestoneDesc = mMatch[2].trim();
      }
      continue;
    }

    // Checkbox items belong to current step
    if (item.type === 'todo' && currentStep) {
      currentStep.items.push({ text:item.text, checked:item.checked, depth:item.depth });
      continue;
    }
  }

  // Compute completion
  let totalItems = 0, checkedItems = 0;
  for (const ph of phases) {
    let phaseAllDone = ph.steps.length > 0;
    for (const st of ph.steps) {
      // Only count top-level items (depth 0 or 1) for completion
      // Sub-items (depth 2+) are notes, not required checkboxes
      const topItems = st.items.filter(it => it.depth <= 1);
      const allDone  = topItems.length > 0 && topItems.every(it => it.checked);
      st.complete    = allDone;
      totalItems    += topItems.length;
      checkedItems  += topItems.filter(it => it.checked).length;
      if (!allDone) phaseAllDone = false;
    }
    ph.complete = phaseAllDone;
  }

  const readiness = totalItems > 0 ? Math.round(checkedItems / totalItems * 100) : 0;
  return { phases, readiness, totalItems, checkedItems };
}

// ── STANDARD MODE: pattern-match against STEP_DEFINITIONS ───────────────────
function computeStepState(allItems) {
  const stepStates = {};
  for (const def of STEP_DEFINITIONS) {
    const key = `${def.phase}-${def.step}`;
    let totalMarkers = 0, checkedMarkers = 0;
    for (const marker of def.markers) {
      const matching = allItems.filter(
        item => item.type === 'todo' && item.text.toLowerCase().includes(marker.toLowerCase())
      );
      if (matching.length > 0) {
        totalMarkers++;
        if (matching.some(m => m.checked)) checkedMarkers++;
      }
    }
    const complete = totalMarkers > 0 ? checkedMarkers === totalMarkers : false;
    stepStates[key] = { complete, checkedCount:checkedMarkers, totalCount:totalMarkers,
      pct: totalMarkers > 0 ? Math.round(checkedMarkers/totalMarkers*100) : 0 };
  }
  return stepStates;
}

function computePhaseState(stepStates) {
  const phases = [
    { steps:[0,1,2,3], label:'Design & Architecture', milestoneDesc:'Complete buildable drawings ready for selections.' },
    { steps:[4,5,6,7], label:'Selections & Specifications', milestoneDesc:'All finishes and specifications chosen before construction.' },
    { steps:[8,9,10,11,12], label:'Budget, Timeline & Build-Ready', milestoneDesc:'Full budget approved, timeline set, ready to break ground.' },
  ];
  return phases.map((ph, pi) => {
    const stepKeys  = ph.steps.map(s => { const def = STEP_DEFINITIONS.find(d => d.phase===pi && d.step===ph.steps.indexOf(s)); return def ? `${def.phase}-${def.step}` : null; }).filter(Boolean);
    const allComplete = stepKeys.every(k => stepStates[k]?.complete);
    const anyStarted  = stepKeys.some(k => (stepStates[k]?.checkedCount||0) > 0);
    return { label:ph.label, milestoneDesc:ph.milestoneDesc, complete:allComplete, started:anyStarted,
      steps:stepKeys.map(k => ({ key:k, ...stepStates[k] })) };
  });
}

function computeReadiness(stepStates) {
  let total=0, checked=0;
  for (const s of Object.values(stepStates)) { total+=s.totalCount; checked+=s.checkedCount; }
  return total > 0 ? Math.round(checked/total*100) : 0;
}

// ── CORS ────────────────────────────────────────────────────────────────────
function corsHeaders() {
  return { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type', 'Content-Type':'application/json' };
}
function respond(status, body) {
  return { statusCode:status, headers:corsHeaders(), body:JSON.stringify(body) };
}

// ── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:corsHeaders(), body:'' };

  const token = process.env.NOTION_TOKEN;
  if (!token) return respond(500, { error:'NOTION_TOKEN not configured' });

  const pageId  = event.queryStringParameters?.pageId;
  const dynamic = event.queryStringParameters?.dynamic === '1';
  if (!pageId) return respond(400, { error:'pageId query parameter required' });

  try {
    const page       = await notionGet(`/pages/${pageId}`, token);
    const lastEdited = page.last_edited_time;
    const blocks     = await fetchAllBlocks(pageId, token);
    const allItems   = flattenBlocks(blocks);

    if (dynamic) {
      // ── Dynamic mode for remodels ──
      const { phases, readiness, totalItems, checkedItems } = parseDynamicStructure(allItems);
      return respond(200, {
        pageId, lastEdited, dynamic:true,
        readiness, totalItems, checkedItems,
        phases,
        _meta:{ blockCount:blocks.length, itemCount:allItems.length },
      });
    } else {
      // ── Standard mode for new builds ──
      const stepStates  = computeStepState(allItems);
      const phaseStates = computePhaseState(stepStates);
      const readiness   = computeReadiness(stepStates);
      return respond(200, {
        pageId, lastEdited, dynamic:false,
        readiness, phases:phaseStates, steps:stepStates,
        _meta:{ blockCount:blocks.length, itemCount:allItems.length },
      });
    }
  } catch(err) {
    console.error('notion-tracker error:', err);
    return respond(500, { error:err.message });
  }
};
