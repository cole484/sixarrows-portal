// ─────────────────────────────────────────────────────────
//  SIX ARROWS CLIENT PORTAL — DATA LAYER v3
//  Each step has: owner, desc, completedDate
//  owner: 'sa' | 'client' | 'both'
// ─────────────────────────────────────────────────────────

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

    sabPhases: [
      {
        id: 0,
        label: 'Design & Architecture',
        short: 'Design',
        goal: 'Translate your vision into actual, buildable plans',
        milestone: 'Plan Ready',
        milestoneDate: 'Feb 28, 2026',
        milestoneDesc: 'You now have complete, buildable drawings — a full architectural vision for your forever home.',
        complete: true,
        steps: [
          {
            id: 0, title: 'Site Analysis & Land Review',
            owner: 'sa',
            desc: 'Before a single line is drawn, we study your land. This ensures your home is designed to work with your specific lot — setbacks, slope, utilities, and all.',
            complete: true, completedDate: 'Feb 6, 2026',
            items: ['Topographical considerations reviewed','Setbacks and zoning confirmed','Utilities assessed','Slope & foundation implications evaluated']
          },
          {
            id: 1, title: 'Concept Floor Plan',
            owner: 'both',
            desc: 'This is where your home starts to take shape on paper. We work together to nail the layout — room flow, bedroom count, square footage — before investing in full drawings.',
            complete: true, completedDate: 'Feb 14, 2026',
            items: ['Bed/bath count confirmed','Interior flow approved','Architectural style selected','Preliminary square footage vs. budget reviewed','Submit design concepts to draftsman','Initial floor plan draft complete','Subsequent plan revisions','Final floor plan approved by client']
          },
          {
            id: 2, title: 'Full Architectural Plans',
            owner: 'sa',
            desc: 'With your floor plan locked, we develop the complete set of construction drawings — every page your builder and trades will reference throughout the entire build.',
            complete: true, completedDate: 'Feb 22, 2026',
            items: ['Exterior finishes page completed','Foundation plan','Framing plan','Roof plan','Elevations','Sections & details','Window/door schedules','Roofing specifications','Landscapes & hardscape (driveways & pathways)']
          },
          {
            id: 3, title: 'MEP Planning',
            owner: 'both',
            desc: 'MEP stands for Mechanical, Electrical, and Plumbing — the systems that make your home function. We map all of these out now so there are zero surprises inside the walls.',
            note: 'Begins once the floor plan footprint is established — typically during plan revisions.',
            complete: true, completedDate: 'Feb 28, 2026',
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
            complete: true, completedDate: 'Mar 3, 2026',
            items: ['Timeline for decisions on each wave established']
          },
          {
            id: 5, title: 'Wave 1 — Construction Specifications',
            owner: 'both',
            desc: 'Wave 1 covers the structural items that affect framing, rough-in, and cost. These decisions happen first because they shape everything built around them.',
            complete: true, completedDate: 'Mar 10, 2026',
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
    ],

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
    budgetCategories: [
      { name:'Design & Planning',          total:14200, spent:14200, status:'locked',   subCategories:[
        { name:'Surveying & Permits', total:8200,  spent:8200  },
        { name:'Interior Design',     total:6000,  spent:6000  },
      ]},
      { name:'Construction Costs',         total:98400, spent:72100, status:'reviewing', subCategories:[
        { name:'Foundation',                    total:18400, spent:18400 },
        { name:'Framing',                       total:28600, spent:28600 },
        { name:'Roofing',                       total:12200, spent:12200 },
        { name:'Windows & Doors',              total:14800, spent:8400  },
        { name:'Exterior Siding & Masonry',    total:11400, spent:4500  },
        { name:'Porches & Accents',            total:8200,  spent:0     },
        { name:'Exterior Painting',            total:4800,  spent:0     },
      ]},
      { name:'Mechanical Systems',         total:48000, spent:44800, status:'reviewing', subCategories:[
        { name:'Plumbing',    total:12000, spent:12000 },
        { name:'Electrical',  total:14000, spent:14000 },
        { name:'HVAC',        total:16000, spent:14800 },
        { name:'Insulation',  total:6000,  spent:4000  },
      ]},
      { name:'Interior Finishes',          total:38000, spent:12400, status:'active',   subCategories:[
        { name:'Drywall',               total:4200,  spent:4200  },
        { name:'Paint & Staining',      total:3800,  spent:0     },
        { name:'Tile & Masonry',        total:2400,  spent:0     },
        { name:'Flooring',              total:8200,  spent:8200  },
        { name:'Cabinetry',             total:0,     spent:0     },
        { name:'Countertops',           total:0,     spent:0     },
        { name:'Interior Doors',        total:2800,  spent:0     },
        { name:'Trim Work & Moldings',  total:3200,  spent:0     },
        { name:'Fireplaces',            total:0,     spent:0     },
        { name:'Electrical Fixtures',   total:4600,  spent:0     },
        { name:'Plumbing Fixtures',     total:3200,  spent:0     },
        { name:'Appliances',            total:0,     spent:0     },
        { name:'Bathroom Fixtures',     total:2400,  spent:0     },
        { name:'Closet Systems',        total:3200,  spent:0     },
      ]},
      { name:'Exterior Work',              total:18600, spent:18600, status:'locked',   subCategories:[
        { name:'Dirt & Grading',            total:7200,  spent:7200  },
        { name:'Rock & Concrete',           total:6800,  spent:6800  },
        { name:'Final Grade & Landscaping', total:4600,  spent:4600  },
      ]},
      { name:'Utilities & Hookups',        total:6200,  spent:6200,  status:'locked',   subCategories:[
        { name:'Water & Sewer Lines',   total:1800, spent:1800 },
        { name:'Septic System',         total:0,    spent:0    },
        { name:'Water Meter',           total:400,  spent:400  },
        { name:'Utility Trenching',     total:1200, spent:1200 },
        { name:'Gas Connection',        total:1400, spent:1400 },
        { name:'Electrical Connection', total:1400, spent:1400 },
      ]},
      { name:'Miscellaneous',              total:4000,  spent:1200,  status:'active',   subCategories:[
        { name:'Contingency Fund', total:4000, spent:1200 },
      ]},
      { name:'Other Costs & Management Fee', total:11000, spent:0,   status:'pending',  subCategories:[
        { name:'Temp Utilities',                total:1200, spent:0 },
        { name:'Dumpsters & Toilet',            total:1800, spent:0 },
        { name:'Site Clean Up & Builders Risk', total:2000, spent:0 },
        { name:'Six Arrows Management Fee',     total:6000, spent:0 },
      ]},
    ],
    timelineStart: 'Oct 14, 2025',
    timelineTarget: 'May 3, 2026',
    selectionsCompleted: 31,
    selectionsTotal: 34,
    teamLead: 'Cole Borders',
    teamPhone: '(270) 555-0142',
    teamEmail: 'cole@sixarrowsconstruction.com',
    quickSummary: 'Structure is well underway. The critical focus is moisture control — finalizing humidity management before interior finishes begin.',
    selectionsClientKey: 'walter_leslie_wood',
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
  }
};

// ─── Auth ────────────────────────────────────────────────
const AUTH = {
  login(email, password) {
    const match = Object.values(PROJECTS).find(
      p => p.email.toLowerCase() === email.toLowerCase().trim() && p.password === password
    );
    if (match) {
      localStorage.setItem('sa_session_v2', JSON.stringify({ id: match.id, ts: Date.now() }));
      return match;
    }
    return null;
  },
  logout() { localStorage.removeItem('sa_session_v2'); window.location.href = 'index.html'; },
  getSession() {
    try {
      const raw = localStorage.getItem('sa_session_v2');
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
  }
};

function currency(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n); }
function percent(a,b) { return b ? Math.round((a/b)*100) : 0; }
function getStepAllItems(step) { if (step.subSections) return step.subSections.flatMap(ss=>ss.items); return step.items||[]; }
