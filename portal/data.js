// ─────────────────────────────────────────────────────────
//  SIX ARROWS CLIENT PORTAL — DATA LAYER v3
//  Each step has: owner, desc, completedDate
//  owner: 'sa' | 'client' | 'both'
// ─────────────────────────────────────────────────────────

// ── Shared SAB phase template (used by all clients) ─────────────
const DEFAULT_SAB_PHASES = [
      {
        id: 0,
        label: 'Design & Architecture',
        short: 'Design',
        goal: 'Translate your vision into actual, buildable plans',
        milestone: 'Plan Ready',
        milestoneDate: null,
        milestoneDesc: 'You now have complete, buildable drawings — a full architectural vision for your forever home.',
        complete: false,
        steps: [
          {
            id: 0, title: 'Site Analysis & Land Review',
            owner: 'sa',
            desc: 'Before a single line is drawn, we study your land. This ensures your home is designed to work with your specific lot — setbacks, slope, utilities, and all.',
            complete: false, completedDate: null,
            items: ['Topographical considerations reviewed','Setbacks and zoning confirmed','Utilities assessed','Slope & foundation implications evaluated']
          },
          {
            id: 1, title: 'Concept Floor Plan',
            owner: 'both',
            desc: 'This is where your home starts to take shape on paper. We work together to nail the layout — room flow, bedroom count, square footage — before investing in full drawings.',
            complete: false, completedDate: null,
            items: ['Bed/bath count confirmed','Interior flow approved','Architectural style selected','Preliminary square footage vs. budget reviewed','Submit design concepts to draftsman','Initial floor plan draft complete','Subsequent plan revisions','Final floor plan approved by client']
          },
          {
            id: 2, title: 'Full Architectural Plans',
            owner: 'sa',
            desc: 'With your floor plan locked, we develop the complete set of construction drawings — every page your builder and trades will reference throughout the entire build.',
            complete: false, completedDate: null,
            items: ['Exterior finishes page completed','Foundation plan','Framing plan','Roof plan','Elevations','Sections & details','Window/door schedules','Roofing specifications','Landscapes & hardscape (driveways & pathways)']
          },
          {
            id: 3, title: 'MEP Planning',
            owner: 'both',
            desc: 'MEP stands for Mechanical, Electrical, and Plumbing — the systems that make your home function. We map all of these out now so there are zero surprises inside the walls.',
            note: 'Begins once the floor plan footprint is established — typically during plan revisions.',
            complete: false, completedDate: null,
            subSections: [
              { label: 'HVAC', items: ['Unit locations determined','Type of HVAC equipment (gas, electric, split or all-in-one)','Returns & supplies mapped','Thermostat placement','HVAC zones confirmed','Additional HVAC notes'] },
              { label: 'Electrical', items: ['Outlet & switch layouts','Low-voltage systems (alarms, doorbells, etc.)','Lighting plan room by room'] },
              { label: 'Plumbing', items: ['Water heater type/locations selected','Hose bibb locations','Filtration/softener or additional water systems'] }
            ]
          }
        ]
      },
      {
        id: 1,
        label: 'Selections & Specifications',
        short: 'Selections',
        goal: 'Eliminate surprises — every decision made before construction',
        note: 'Begin after MEP planning decisions are made.',
        milestone: 'Design Done',
        milestoneDate: null,
        milestoneDesc: 'Every finish, fixture, and surface has been chosen. Zero open decisions stand between you and construction.',
        complete: false,
        steps: [
          {
            id: 4, title: 'Selections Kickoff',
            owner: 'both',
            desc: 'We walk you through the full selections process so you know exactly what decisions are coming, in what order, and by when. No surprises.',
            complete: false, completedDate: null,
            items: ['Timeline for decisions on each wave established']
          },
          {
            id: 5, title: 'Wave 1 — Construction Specifications',
            owner: 'both',
            desc: 'Wave 1 covers the structural items that affect framing, rough-in, and cost. These decisions happen first because they shape everything built around them.',
            complete: false, completedDate: null,
            items: ['Wave selections process introduced (Wave 1, 2 & 3)','Fireplace details (gas, electric, sizes)','Decking/porch details','Appliances selected','Garage doors selected','Budget building started — Design & Planning','Budget building started — Construction Costs','Budget building started — Mechanical Systems','Budget building started — Exterior Work','Budget building started — Utilities & Hookups']
          },
          {
            id: 6, title: 'Wave 2 & 3 — The Shell & The Jewelry',
            owner: 'client',
            desc: 'These are the decisions that define how your home looks and feels. Wave 2 is the big visible surfaces. Wave 3 is the finishing touches that give your home its character. These are yours to decide.',
            complete: false,
            subSections: [
              { label: 'Wave 2 — The Shell', items: ['Cabinets selected','Built-ins & specialty trim (beams, floating shelves, mantles)','Flooring selected','Tile selected'] },
              { label: 'Wave 3 — The Jewelry', items: ['Plumbing fixtures chosen','Lighting fixtures chosen','Countertops selected','Hardware selected','Paint or stain colors chosen','Interior doors & trim profiles selected'] },
              { label: 'Continue Budget Building', items: ['Interior Finishes budget category completed','Miscellaneous budget category completed','Management Fee confirmed'] }
            ]
          },
          {
            id: 7, title: 'Final Selection Sheet',
            owner: 'both',
            desc: 'Every single selection gets documented in one master sheet. This is the definitive record — if it\'s not on this sheet, it\'s not in your house. We review it together.',
            complete: false,
            items: ['All selections documented','No missing decisions']
          }
        ]
      },
      {
        id: 2,
        label: 'Budget, Timeline & Build-Ready',
        short: 'Build Ready',
        goal: 'A zero-surprise build plan with full transparency',
        milestone: 'Build Ready',
        milestoneDate: null,
        milestoneDesc: 'You have just completed one of the most thorough pre-construction processes in the industry. Construction can begin with full clarity.',
        complete: false,
        steps: [
          {
            id: 8, title: 'Trade Bidding Pack',
            owner: 'sa',
            desc: 'We send your complete plans, specs, and selections to every trade. This is how we get real numbers, not guesses — every dollar in your budget is backed by an actual bid.',
            complete: false,
            items: ['Full plans sent to trades','Specifications distributed','Selections shared','Scope sheets provided']
          },
          {
            id: 9, title: 'Final Budget Review',
            owner: 'both',
            desc: 'With all trade bids in hand, we present your final budget together. Every line item is reviewed so you understand exactly where every dollar is going before you sign anything.',
            complete: false,
            items: ['All trade bids received','Allowances updated','Budget presentation completed']
          },
          {
            id: 10, title: 'Build Timeline & Scheduling',
            owner: 'sa',
            desc: 'We build a master construction schedule — the sequence every trade follows from day one. You\'ll see when framing starts, when flooring goes in, and when you get your keys.',
            complete: false,
            items: ['Master build sequence created','Timeline shared via portal','Sub-contractor scheduling windows created']
          },
          {
            id: 11, title: 'Build-Ready Package',
            owner: 'both',
            desc: 'Everything compiled into one final package: plans, specs, selections, budget, and schedule. This is the document your build runs from. We review and approve it together.',
            complete: false,
            items: ['Final plans compiled','Final specs compiled','Final selections compiled','Final budget approved','Final schedule approved','Contracts prepared']
          },
          {
            id: 12, title: 'Build Ready — Kickoff',
            owner: 'both',
            desc: 'The last step before ground breaks. Loan documents are prepared and your construction start week is officially locked. You are ready to build.',
            complete: false,
            items: ['Loan documents prepared','Construction start week locked']
          },
          {
            id: 13, title: 'Share Your SAB™ Experience',
            owner: 'client', isFinal: true,
            desc: 'You\'ve just completed one of the most thorough pre-construction processes in the industry. Your story helps other families understand why planning properly makes all the difference.',
            complete: false,
            items: ['Review request acknowledged','Feedback shared with Six Arrows team']
          }
        ]
      }
    ];


// ── Default badges for all clients ──────────────────────────────────────────
const DEFAULT_BADGES = [
  { id: 'first_step',    label: 'First Step',    desc: 'Completed your first item',  icon: 'check',     earned: false },
  { id: 'phase1',        label: 'Plan Ready',    desc: 'Phase 1 complete',            icon: 'blueprint', earned: false },
  { id: 'phase2',        label: 'Design Locked', desc: 'Phase 2 complete',            icon: 'design',    earned: false },
  { id: 'halfway',       label: 'Halfway There', desc: '50% build readiness reached', icon: 'half',      earned: false },
  { id: 'phase3',        label: 'Build Ready',   desc: 'All phases complete',         icon: 'build',     earned: false },
  { id: 'groundbreaker', label: 'Groundbreaker', desc: 'Construction has begun',      icon: 'star',      earned: false },
];

const PROJECTS = {
  kandaswamy: {
    id: 'kandaswamy',
    email: 'kandaswamy@client.com',
    password: 'build2026',
    clientName: 'Kandaswamy Family',
    projectName: 'Elizabethtown Custom Home',
    location: 'Elizabethtown, KY',
    status: 'In SAB™',
    statusType: 'sab',
    sabProgress: 72,
    phaseLabel: 'Selections & Budget Alignment',
    nextDecision: 'Exterior materials final approval',
    nextDecisionDueDays: 4,
    groundbreakingDate: '',
    budgetTotal: 424265,
    budgetCommitted: 291880,
    budgetAllowance: 67350,
    budgetContingency: 35035,
    timelineStart: 'Feb 3, 2026',
    timelineTarget: 'Apr 19, 2026',
    selectionsCompleted: 48,
    selectionsTotal: 67,
    teamLead: 'Cole Borders',
    teamPhone: '(270) 555-0142',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Your project is moving well. Exterior material finalization and basement scope are the two remaining control points before we lock the budget and move to contract.',
    selectionsClientKey: 'kandaswamy_family',
    notionTrackerPageId: '2fb4737b-ea6f-80dc-9b3b-c4fac53c95ff',
    documents: [
      { id:'doc1', category:'plans',     name:'Architectural Plans — Rev 3',      url:'https://drive.google.com/file/d/FILEID/preview', type:'pdf',   date:'Feb 22, 2026', note:'Final approved set' },
      { id:'doc2', category:'plans',     name:'MEP Planning Sheet',               url:'https://drive.google.com/file/d/FILEID/preview', type:'pdf',   date:'Feb 28, 2026', note:'HVAC, electrical, plumbing layout' },
      { id:'doc3', category:'budget',    name:'Working Budget — Mar 22 Revision', url:'https://docs.google.com/spreadsheets/',          type:'sheet', date:'Mar 22, 2026', note:'Current working numbers' },
      { id:'doc4', category:'selections',name:'Final Selection Sheet',            url:'https://drive.google.com/file/d/FILEID/preview', type:'pdf',   date:'Mar 10, 2026', note:'Wave 1 complete' },
    ],
    links: {
      budget: 'https://docs.google.com/spreadsheets/',
      timeline: 'https://www.notion.so/',
      selections: '#',
      updates: 'updates.html'
    },

    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),

    badges: [
      { id: 'first_step',    label: 'First Step',    desc: 'Completed your first item',  icon: 'check',     earned: true  },
      { id: 'phase1',        label: 'Plan Ready',    desc: 'Phase 1 complete',            icon: 'blueprint', earned: true  },
      { id: 'phase2',        label: 'Design Locked', desc: 'Phase 2 complete',            icon: 'design',    earned: false },
      { id: 'halfway',       label: 'Halfway There', desc: '50% build readiness reached', icon: 'half',      earned: true  },
      { id: 'phase3',        label: 'Build Ready',   desc: 'All phases complete',         icon: 'build',     earned: false },
      { id: 'groundbreaker', label: 'Groundbreaker', desc: 'Construction has begun',      icon: 'star',      earned: false },
    ],
    decisions: [
      { title: 'Exterior siding material',    due: 'Mar 27', status: 'urgent', note: 'Needed to hold pricing and lead times.' },
      { title: 'Basement bedroom/bath scope', due: 'Mar 29', status: 'active', note: 'Affects framing, HVAC, and budget distribution.' },
      { title: 'Window package sign-off',     due: 'Apr 1',  status: 'queued', note: 'Needed before final quoting.' }
    ],
    timeline: [
      { date: 'Mar 21', title: 'Budget review completed',   note: 'Owner reviewed major category totals.',     done: true  },
      { date: 'Mar 25', title: 'Exterior materials due',    note: 'Need final selection to confirm numbers.',  done: false },
      { date: 'Apr 2',  title: 'Contract draft ready',      note: 'Pending final spec decisions.',             done: false },
      { date: 'Apr 19', title: 'Target construction start', note: 'Pending permit and contract execution.',    done: false }
    ],
    updates: [
      { date: 'Mar 22, 2026', title: 'Budget Revision Posted',  body: 'We updated the working budget to reflect current assumptions around exterior materials, basement scope, and contingency planning.' },
      { date: 'Mar 20, 2026', title: 'Plan Review Complete',     body: 'We completed another review pass of the plan and identified the remaining decisions needed to finalize scope.' },
      { date: 'Mar 14, 2026', title: 'Wave 2 Selections Locked', body: 'Cabinet, flooring, and tile selections are finalized. Wave 3 is now the active focus.' }
    ],
    budgetCategories: [
      { name:'Design & Planning',          total:0, spent:0, status:'locked',   subCategories:[
        { name:'Surveying & Permits', total:0, spent:0 },
        { name:'Interior Design',     total:0, spent:0 },
      ]},
      { name:'Construction Costs',         total:0, spent:0, status:'locked',   subCategories:[
        { name:'Foundation',                    total:0, spent:0 },
        { name:'Framing',                       total:0, spent:0 },
        { name:'Roofing',                       total:0, spent:0 },
        { name:'Windows & Doors',              total:0, spent:0 },
        { name:'Exterior Siding & Masonry',    total:0, spent:0 },
        { name:'Porches & Accents',            total:0, spent:0 },
        { name:'Exterior Painting',            total:0, spent:0 },
      ]},
      { name:'Mechanical Systems',         total:0, spent:0, status:'reviewing', subCategories:[
        { name:'Plumbing',    total:0, spent:0 },
        { name:'Electrical',  total:0, spent:0 },
        { name:'HVAC',        total:0, spent:0 },
        { name:'Insulation',  total:0, spent:0 },
      ]},
      { name:'Interior Finishes',          total:0, spent:0, status:'active',   subCategories:[
        { name:'Drywall',               total:0, spent:0 },
        { name:'Paint & Staining',      total:0, spent:0 },
        { name:'Tile & Masonry',        total:0, spent:0 },
        { name:'Flooring',              total:0, spent:0 },
        { name:'Cabinetry',             total:0, spent:0 },
        { name:'Countertops',           total:0, spent:0 },
        { name:'Interior Doors',        total:0, spent:0 },
        { name:'Trim Work & Moldings',  total:0, spent:0 },
        { name:'Fireplaces',            total:0, spent:0 },
        { name:'Electrical Fixtures',   total:0, spent:0 },
        { name:'Plumbing Fixtures',     total:0, spent:0 },
        { name:'Appliances',            total:0, spent:0 },
        { name:'Bathroom Fixtures',     total:0, spent:0 },
        { name:'Closet Systems',        total:0, spent:0 },
      ]},
      { name:'Exterior Work',              total:0, spent:0, status:'pending',  subCategories:[
        { name:'Dirt & Grading',          total:0, spent:0 },
        { name:'Rock & Concrete',         total:0, spent:0 },
        { name:'Final Grade & Landscaping', total:0, spent:0 },
      ]},
      { name:'Utilities & Hookups',        total:0, spent:0, status:'pending',  subCategories:[
        { name:'Water & Sewer Lines', total:0, spent:0 },
        { name:'Septic System',       total:0, spent:0 },
        { name:'Water Meter',         total:0, spent:0 },
        { name:'Utility Trenching',   total:0, spent:0 },
        { name:'Gas Connection',      total:0, spent:0 },
        { name:'Electrical Connection', total:0, spent:0 },
      ]},
      { name:'Miscellaneous',              total:0, spent:0, status:'pending',  subCategories:[
        { name:'Contingency Fund', total:0, spent:0 },
      ]},
      { name:'Other Costs & Management Fee', total:0, spent:0, status:'pending', subCategories:[
        { name:'Temp Utilities',                  total:0, spent:0 },
        { name:'Dumpsters & Toilet',              total:0, spent:0 },
        { name:'Site Clean Up & Builders Risk',   total:0, spent:0 },
        { name:'Six Arrows Management Fee',       total:0, spent:0 },
      ]},
    ]
  },

  woods: {
    id: 'woods',
    email: 'woods@client.com',
    password: 'court2026',
    clientName: 'Walter & Leslie Wood',
    projectName: 'Indoor Pickleball Court',
    location: 'Bowling Green, KY',
    status: 'Active Construction',
    statusType: 'construction',
    constructionPct: 58,
    sabProgress: 100,
    phaseLabel: 'Active Build — Week 18',
    nextDecision: 'Dedicated dehumidifier approval',
    nextDecisionDueDays: 2,
    groundbreakingDate: '2025-10-14',
    budgetTotal: 238400,
    budgetCommitted: 211160,
    budgetAllowance: 12240,
    budgetContingency: 15000,
    changeOrders: 0,
    changeOrderItems: [
      { date:'Jan 22, 2026', description:'Added dedicated dehumidification system', amount:4200 },
      { date:'Feb 14, 2026', description:'Upgraded court surface to premium finish',  amount:3800 },
    ],
    budgetCategories: [],  // Managed in Supabase — loaded at login
    timelineStart: 'Oct 14, 2025',
    timelineTarget: 'May 3, 2026',
    selectionsCompleted: 31,
    selectionsTotal: 34,
    teamLead: 'Cole Borders',
    teamPhone: '(270) 555-0142',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Structure is well underway. The critical focus is moisture control — finalizing humidity management before interior finishes begin.',
    selectionsClientKey: 'walter_leslie_wood',
    notionTrackerPageId: null,
    documents: [
      { id:'doc1', category:'plans',    name:'Structural Drawings — Court Build',  url:'https://drive.google.com/file/d/FILEID/preview', type:'pdf',   date:'Nov 1, 2025',  note:'Approved build set' },
      { id:'doc2', category:'budget',   name:'Final Budget — Approved',            url:'https://docs.google.com/spreadsheets/',          type:'sheet', date:'Nov 28, 2025', note:'Signed off' },
      { id:'doc3', category:'contracts',name:'Construction Contract',              url:'https://drive.google.com/file/d/FILEID/preview', type:'pdf',   date:'Nov 28, 2025', note:'Executed copy' },
      { id:'ph1',  category:'photos',   phase:'foundation', caption:'Foundation pour complete',     url:'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800', date:'Nov 5, 2025'  },
      { id:'ph2',  category:'photos',   phase:'framing',    caption:'Framing underway — east wall', url:'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', date:'Dec 2, 2025'  },
      { id:'ph3',  category:'photos',   phase:'framing',    caption:'Roof trusses set',             url:'https://images.unsplash.com/photo-1541123437800-1bb1317badc2?w=800', date:'Dec 18, 2025' },
      { id:'ph4',  category:'photos',   phase:'mechanical', caption:'HVAC rough-in complete',       url:'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=800', date:'Jan 14, 2026' },
      { id:'ph5',  category:'photos',   phase:'mechanical', caption:'Court surface prep begun',     url:'https://images.unsplash.com/photo-1587293852726-70cdb56c2866?w=800', date:'Feb 8, 2026'  },
    ],
    links: { budget: 'https://docs.google.com/spreadsheets/', timeline: 'https://www.notion.so/', selections: '#', updates: 'updates.html' },
    sabPhases: [
      { id: 0, label: 'Design & Architecture',          short: 'Design',      goal: '', milestone: 'Plan Ready',  milestoneDate: 'Nov 1, 2025',  milestoneDesc: 'Architectural plans approved.',          complete: true,  steps: [] },
      { id: 1, label: 'Selections & Specifications',    short: 'Selections',  goal: '', milestone: 'Design Done', milestoneDate: 'Nov 15, 2025', milestoneDesc: 'All selections locked in.',              complete: true,  steps: [] },
      { id: 2, label: 'Budget, Timeline & Build-Ready', short: 'Build Ready', goal: '', milestone: 'Build Ready', milestoneDate: 'Nov 28, 2025', milestoneDesc: 'Build-ready package complete.',          complete: true,  steps: [] }
    ],
    badges: [
      { id: 'first_step',    label: 'First Step',    icon: 'check',     earned: true },
      { id: 'phase1',        label: 'Plan Ready',    icon: 'blueprint', earned: true },
      { id: 'phase2',        label: 'Design Locked', icon: 'design',    earned: true },
      { id: 'halfway',       label: 'Halfway There', icon: 'half',      earned: true },
      { id: 'phase3',        label: 'Build Ready',   icon: 'build',     earned: true },
      { id: 'groundbreaker', label: 'Groundbreaker', icon: 'star',      earned: true },
    ],
    decisions: [
      { title: 'Dedicated dehumidifier approval', due: 'Mar 25', status: 'urgent', note: 'May be needed if HVAC alone cannot control RH.' },
      { title: 'Final wall finish confirmation',  due: 'Mar 31', status: 'active', note: 'Needed to close out materials ordering.' }
    ],
    timeline: [
      { date: 'Mar 18', title: 'Humidity issue reported', note: 'Building reading ~75% RH.',                    done: true  },
      { date: 'Mar 24', title: 'HVAC review',             note: 'Review airflow and dehumidification options.', done: false },
      { date: 'Apr 3',  title: 'Finish punch planning',   note: 'Closeout list and final trade touches.',       done: false },
      { date: 'May 3',  title: 'Target completion',       note: 'Project closeout and walkthrough.',           done: false }
    ],
    updates: [
      { date: 'Mar 19, 2026', title: 'Humidity Follow-Up',           body: 'Reviewing whether HVAC setup is running long enough to control moisture — dedicated dehumidifier may be needed.' },
      { date: 'Mar 14, 2026', title: 'Insulation and Airflow Review', body: 'Team reviewed building envelope conditions and began evaluating causes for the reported humidity level.' }
    ]
  },

  // ── Test Client (Mock) ────────────────────────────────────────────────────────
  testclient: {
    id: 'testclient',
    email: 'test@client.com',
    password: 'test2026',
    clientName: 'Test Client',
    projectName: 'Mock Custom Home',
    location: 'Bowling Green, KY',
    status: 'In SAB™ Process',
    statusType: 'sab',
    constructionPct: 0,
    sabProgress: 0,
    phaseLabel: 'Phase 1 — Design & Architecture',
    nextDecision: '',
    nextDecisionDueDays: 0,
    groundbreakingDate: '',
    budgetTotal: 0,
    budgetCommitted: 0,
    budgetAllowance: 0,
    budgetContingency: 0,
    changeOrders: 0,
    changeOrderItems: [],
    timelineStart: 'TBD',
    timelineTarget: 'TBD',
    teamLead: 'Cole Borders',
    teamPhone: '(270) 782-5388',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Welcome to your Six Arrows client portal. We are just getting started!',
    badges: JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    selectionsClientKey: 'testclient',
    notionTrackerPageId: '3324737b-ea6f-81d3-9c4f-d5fa8aebdeea',
    links: { budget: '#', timeline: '#' },
    decisions: [],
    updates: [],
    timeline: [],
    documents: [],
    budgetCategories: [],  // Managed in Supabase
    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
  },

  // ── Nagornay ─────────────────────────────────────────────────────────────────
  nagornay: {
    id: 'nagornay',
    email: 'nagornay@client.com',
    password: 'nagornay2026',
    clientName: 'Amber & Alex Nagornay',
    projectName: 'Custom Home',
    location: 'Bowling Green, KY',
    status: 'In SAB™ Process',
    statusType: 'sab',
    constructionPct: 0,
    sabProgress: 0,
    phaseLabel: 'Phase 1 — Design & Architecture',
    nextDecision: '',
    nextDecisionDueDays: 0,
    groundbreakingDate: '',
    budgetTotal: 0,
    budgetCommitted: 0,
    budgetAllowance: 0,
    budgetContingency: 0,
    changeOrders: 0,
    changeOrderItems: [],
    timelineStart: 'TBD',
    timelineTarget: 'TBD',
    teamLead: 'Cole Borders',
    teamPhone: '(270) 782-5388',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Welcome to your Six Arrows client portal.',
    badges: JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    selectionsClientKey: 'nagornay',
    notionTrackerPageId: '2d14737b-ea6f-8095-bd88-db56917e914f',
    links: { budget: '#', timeline: '#' },
    decisions: [],
    updates: [],
    timeline: [],
    documents: [],
    budgetCategories: [],  // Managed in Supabase
    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
  },

  // ── Johnson ───────────────────────────────────────────────────────────────────
  johnson: {
    id: 'johnson',
    email: 'johnson@client.com',
    password: 'johnson2026',
    clientName: 'James & Dana Johnson',
    projectName: 'Custom Home',
    location: 'Bowling Green, KY',
    status: 'In SAB™ Process',
    statusType: 'sab',
    constructionPct: 0,
    sabProgress: 0,
    phaseLabel: 'Phase 2 — Selections & Specifications',
    nextDecision: '',
    nextDecisionDueDays: 0,
    groundbreakingDate: '',
    budgetTotal: 0,
    budgetCommitted: 0,
    budgetAllowance: 0,
    budgetContingency: 0,
    changeOrders: 0,
    changeOrderItems: [],
    timelineStart: 'TBD',
    timelineTarget: 'TBD',
    teamLead: 'Cole Borders',
    teamPhone: '(270) 782-5388',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Welcome to your Six Arrows client portal.',
    badges: JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    selectionsClientKey: 'johnson',
    notionTrackerPageId: '2d14737b-ea6f-8010-a5bf-dae373403326',
    links: { budget: '#', timeline: '#' },
    decisions: [],
    updates: [],
    timeline: [],
    documents: [],
    budgetCategories: [],  // Managed in Supabase
    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
  },

  // ── Hoops ─────────────────────────────────────────────────────────────────────
  hoops: {
    id: 'hoops',
    email: 'hoops@client.com',
    password: 'hoops2026',
    clientName: 'Joseph & Lisa Hoops',
    projectName: 'Custom Home',
    location: 'Bowling Green, KY',
    status: 'In SAB™ Process',
    statusType: 'sab',
    constructionPct: 0,
    sabProgress: 0,
    phaseLabel: 'Phase 1 — Design & Architecture',
    nextDecision: '',
    nextDecisionDueDays: 0,
    groundbreakingDate: '',
    budgetTotal: 0,
    budgetCommitted: 0,
    budgetAllowance: 0,
    budgetContingency: 0,
    changeOrders: 0,
    changeOrderItems: [],
    timelineStart: 'TBD',
    timelineTarget: 'TBD',
    teamLead: 'Cole Borders',
    teamPhone: '(270) 782-5388',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Welcome to your Six Arrows client portal.',
    badges: JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    selectionsClientKey: 'hoops',
    notionTrackerPageId: '2df4737b-ea6f-8011-b095-f3e5ac22137c',
    links: { budget: '#', timeline: '#' },
    decisions: [],
    updates: [],
    timeline: [],
    documents: [],
    budgetCategories: [],  // Managed in Supabase
    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
  },

  // ── Howard ────────────────────────────────────────────────────────────────────
  howard: {
    id: 'howard',
    email: 'howard@client.com',
    password: 'howard2026',
    clientName: 'Derek & Amanda Howard',
    projectName: 'Custom Home',
    location: 'Bowling Green, KY',
    status: 'In SAB™ Process',
    statusType: 'sab',
    constructionPct: 0,
    sabProgress: 0,
    phaseLabel: 'Phase 1 — Design & Architecture',
    nextDecision: '',
    nextDecisionDueDays: 0,
    groundbreakingDate: '',
    budgetTotal: 0,
    budgetCommitted: 0,
    budgetAllowance: 0,
    budgetContingency: 0,
    changeOrders: 0,
    changeOrderItems: [],
    timelineStart: 'TBD',
    timelineTarget: 'TBD',
    teamLead: 'Cole Borders',
    teamPhone: '(270) 782-5388',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Welcome to your Six Arrows client portal.',
    badges: JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    selectionsClientKey: 'howard',
    notionTrackerPageId: '2f84737b-ea6f-80b8-90dc-edb340717f47',
    links: { budget: '#', timeline: '#' },
    decisions: [],
    updates: [],
    timeline: [],
    documents: [],
    budgetCategories: [],  // Managed in Supabase
    sabPhases: JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
  },
};

// ─── Auth ────────────────────────────────────────────────
const AUTH = {
  // loginAsync: calls Supabase via Netlify Function, caches full client in localStorage
  async loginAsync(email, password) {
    // Try Supabase first
    try {
      const res = await fetch('/.netlify/functions/client-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const { clientId } = await res.json();
        // Store minimal session immediately using local PROJECTS as base
        // This ensures dashboard loads correctly before full Supabase data arrives
        const localMatch = PROJECTS[clientId];
        if (localMatch) {
          localStorage.setItem('sa_session_v3', JSON.stringify({ id: localMatch.id, ts: Date.now(), data: localMatch }));
        }
        // Fetch full client record from Supabase
        const dataRes = await fetch(`/.netlify/functions/client-auth?clientId=${clientId}`);
        if (dataRes.ok) {
          const clientData = await dataRes.json();
          const p = AUTH._normalize(clientData);
          // Upgrade session with full Supabase data
          localStorage.setItem('sa_session_v3', JSON.stringify({ id: p.id, ts: Date.now(), data: p }));
          return p;
        }
        // If full fetch failed, return local match
        return localMatch || null;
      }
    } catch(e) {
      console.log('Supabase login unavailable, falling back to local:', e.message);
    }
    // Fallback: local PROJECTS lookup
    const match = Object.values(PROJECTS).find(
      p => p.email.toLowerCase() === email.toLowerCase().trim() && p.password === password
    );
    if (match) {
      localStorage.setItem('sa_session_v3', JSON.stringify({ id: match.id, ts: Date.now(), data: match }));
      localStorage.setItem('sa_session_v2', JSON.stringify({ id: match.id, ts: Date.now() }));
      return match;
    }
    return null;
  },
  // Normalize Supabase snake_case to portal camelCase
  _normalize(d) {
    return {
      id:                   d.id,
      email:                d.email,
      password:             d.password,
      clientName:           d.client_name,
      projectName:          d.project_name,
      location:             d.location,
      status:               d.status_type === 'construction' ? 'Under Construction' : 'In SAB™ Process',
      statusType:           d.status_type,
      phaseLabel:           d.phase_label,
      constructionPct:      d.construction_pct || 0,
      sabProgress:          0,
      groundbreakingDate:   d.groundbreaking_date || '',
      budgetTotal:          d.budget_total || 0,
      budgetCommitted:      d.budget_committed || 0,
      budgetAllowance:      d.budget_allowance || 0,
      budgetContingency:    d.budget_contingency || 0,
      changeOrders:         d.change_orders || 0,
      timelineStart:        d.timeline_start || 'TBD',
      timelineTarget:       d.timeline_target || 'TBD',
      teamLead:             d.team_lead || 'Cole Borders',
      teamPhone:            d.team_phone || '(270) 782-5388',
      teamEmail:            d.team_email || 'cole@sixarrowsconstruction.com',
      quickSummary:         d.quick_summary || '',
      nextDecision:         d.next_decision || '',
      nextDecisionDueDays:  d.next_decision_due_days || 0,
      selectionsClientKey:  d.selections_client_key || d.id,
      notionTrackerPageId:  d.notion_tracker_page_id || null,
      notionTimelineDbId:   d.notion_timeline_db_id || null,
      links: {
        // budget_link comes from Supabase clients table
        budget: d.budget_link || (() => {
          try {
            const override = JSON.parse(localStorage.getItem(`sa_admin_${d.id}_projectOverride`) || 'null');
            return override?.budgetLink || '#';
          } catch(e) { return '#'; }
        })(),
        timeline: '#',
      },
      decisions:            (d.decisions || []).map(dec => ({ title: dec.title, due: dec.due, status: dec.status, note: dec.note })),
      updates:              (d.updates || []).map(u => ({ date: u.date, title: u.title, body: u.body })),
      timeline:             (d.timeline || []).map(m => ({ date: m.date, title: m.title, note: m.note, done: m.done })),
      documents:            (d.documents || []).map(doc => ({ id: doc.id, name: doc.name, category: doc.category, url: doc.url, type: doc.type, date: doc.date, note: doc.note })),
      budgetCategories:     (d.budgetCategories || []).map(cat => ({
        name:          cat.name,
        total:         cat.total || 0,
        spent:         cat.spent || 0,
        status:        cat.status || 'pending',
        // sub_categories comes from Supabase (array of {name, total, spent})
        subCategories: (cat.sub_categories || cat.subCategories || []).map(sub => ({
          name:  sub.name,
          total: sub.total || 0,
          spent: sub.spent || 0,
        })),
      })),
      changeOrderItems:     (d.changeOrderItems || []).map(co => ({ date: co.date, description: co.description, amount: co.amount })),
      sabPhases:            JSON.parse(JSON.stringify(DEFAULT_SAB_PHASES)),
      badges:               JSON.parse(JSON.stringify(DEFAULT_BADGES)),
    };
  },
  logout() {
    localStorage.removeItem('sa_session_v3');
    localStorage.removeItem('sa_session_v2');
    window.location.href = 'index.html';
  },
  getSession() {
    try {
      // Try v3 (Supabase-backed) session first
      let raw = localStorage.getItem('sa_session_v3');
      if (raw) {
        const s = JSON.parse(raw);
        // Expire after 10 hours OR if ts=0 (forced invalidation by admin)
        if (s.ts === 0 || Date.now() - s.ts > 10 * 60 * 60 * 1000) {
          localStorage.removeItem('sa_session_v3');
        } else if (s.data) {
          return s.data;
        }
      }
      // Fall back to v2 (data.js) session
      raw = localStorage.getItem('sa_session_v2');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() - s.ts > 10 * 60 * 60 * 1000) { localStorage.removeItem('sa_session_v2'); return null; }
      return PROJECTS[s.id] || null;
    } catch { return null; }
  },
  requireAuth() {
    const p = this.getSession();
    if (!p) { window.location.href = 'index.html'; return null; }
    return p;
  },
  // Refresh session data from Supabase (call after updates to reflect changes)
  async refreshSession(clientId) {
    try {
      const res = await fetch(`/.netlify/functions/client-auth?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        const p = AUTH._normalize(data);
        localStorage.setItem('sa_session_v3', JSON.stringify({ id: p.id, ts: Date.now(), data: p }));
        return p;
      }
    } catch(e) {}
    return null;
  }
};

function currency(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n); }
function percent(a,b) { return b ? Math.round((a/b)*100) : 0; }
function getStepAllItems(step) { if (step.subSections) return step.subSections.flatMap(ss=>ss.items); return step.items||[]; }
