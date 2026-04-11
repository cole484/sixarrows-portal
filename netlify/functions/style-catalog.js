// netlify/functions/style-catalog.js
// ─────────────────────────────────────────────────────────────────────────────
//  Style Catalog — single source of truth for Selections v2 / Fox
//
//  Holds:
//    • The 8-question visual style quiz (big-picture style direction).
//      Material/finish prefs are captured by the swipe taste board instead.
//    • The six style profiles — keywords / palette / signature notes. These
//      are used by the front end to show style reveals and by Fox as
//      supplemental context.
//    • A curated products map (optional, grows over time). Admin can add
//      tiered picks per style per category. Empty by default.
//
//  Storage:
//    Reuses the existing `selections` Supabase table. We stash the catalog
//    under client_id '__style_catalog__' with two suffixes: 'quiz' and
//    'products'. If a suffix has never been saved, we fall back to the
//    hardcoded defaults below. This avoids adding a new Supabase table.
//
//  Endpoints:
//    GET  /style-catalog                        → full merged catalog
//    GET  /style-catalog?style=Modern+Farmhouse → one style slice (for Fox)
//    GET  /style-catalog?withPhotos=1           → resolves Drive folder URLs
//                                                 to image lists inline
//                                                 (one extra round trip to
//                                                 Google Drive per question)
//    POST /style-catalog                        → admin upsert (partial ok)
//      Body: { quiz?, products? }
//      Headers: Authorization: Bearer <ADMIN_PASSWORD>
//
//    DELETE /style-catalog?suffix=quiz          → admin reset to defaults
//      Headers: Authorization: Bearer <ADMIN_PASSWORD>
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type':                 'application/json',
};

const SB_URL  = () => process.env.SUPABASE_URL;
const SB_KEY  = () => process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';
const GS_KEY  = () => process.env.GOOGLE_API_KEY;

const CATALOG_CLIENT_ID = '__style_catalog__';
const ALLOWED_SUFFIXES  = new Set(['quiz', 'products']);

// ─────────────────────────────────────────────────────────────────────────────
//  The six style profiles (front end reads these for style-reveal screens
//  and Fox reads them for chat context). Pure data — no behavioral text.
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_PROFILES = {
  'Modern Farmhouse': {
    tagline: 'Warm, lived-in, collected over time.',
    palette: ['#F5F1EA', '#E8DFD1', '#2B2B2B', '#B08B5B', '#7B6A4E'],
    keywords: ['warm white', 'shaker', 'apron sink', 'wood beams', 'matte black', 'hex mosaic'],
    signature: 'Exposed beams, apron-front sink, two-tone shaker cabinets.',
  },
  'Transitional': {
    tagline: 'Timeless, polished, nothing shouting.',
    palette: ['#F2EFE9', '#D9D3C7', '#8B8578', '#C7A57A', '#3B3B3B'],
    keywords: ['warm neutral', 'brushed brass', 'quartz', 'subway tile', 'panel molding'],
    signature: 'Layered neutrals, paneled walls, clean shaker in pale grey.',
  },
  'Modern Traditional': {
    tagline: 'Architectural, rich, heritage made current.',
    palette: ['#2E3B2F', '#1E2F4A', '#6B2A2A', '#E8DBC0', '#B08A4A'],
    keywords: ['inset cabinets', 'unlacquered brass', 'honed marble', 'beaded frame', 'deep color'],
    signature: 'Deep-green inset cabinets, honed Calacatta, unlacquered brass.',
  },
  'Organic Modern': {
    tagline: 'Earthy, grounded, artisanal.',
    palette: ['#F1E8D9', '#D4B896', '#8C6A4E', '#6B7A3F', '#3E3C35'],
    keywords: ['white oak', 'zellige', 'plaster', 'arches', 'soft clay', 'unlacquered brass'],
    signature: 'Plaster range hood, zellige tile, curved vanities.',
  },
  'Clean Modern': {
    tagline: 'Architectural, quiet, precise.',
    palette: ['#FFFFFF', '#E8E8E6', '#5B5A57', '#1A1A1A', '#7A5F3F'],
    keywords: ['flat front', 'slab', 'waterfall', 'integrated', 'linear', 'hidden pulls'],
    signature: 'Slab backsplash, integrated appliances, oiled walnut accents.',
  },
  'Warm Luxury': {
    tagline: 'Layered, tactile, dramatic without being loud.',
    palette: ['#1F2E25', '#3B1F2B', '#1A1F3A', '#C9A566', '#EADFC6'],
    keywords: ['brushed gold', 'veined marble', 'walnut', 'fluted', 'jewel tones', 'book-matched'],
    signature: 'Book-matched Calacatta Viola, fluted walnut, brushed gold.',
  },
};

const STYLE_NAMES = Object.keys(STYLE_PROFILES);

// ─────────────────────────────────────────────────────────────────────────────
//  Default quiz — 8 questions. Each option's `styles` array is the profile(s)
//  the answer points toward; the tally across 8 questions picks the winner.
//  Material & finish preferences (countertops, hardware, backsplash, wood
//  tone) are now handled by the swipe taste board phase instead of quiz
//  questions — keeps the quiz fast and focused on big-picture style.
//
//  Q1–Q4 use existing ChatGPT-generated photos in Google Drive.
//  Q5–Q8 use OpenAI gpt-image-1 generated photos served as static assets.
//
//  folderUrl is the Drive folder (or static:slug) containing the 4 visual
//  option images for that question.
// ─────────────────────────────────────────────────────────────────────────────

// Drive folder IDs for each quiz question. Each folder contains exactly 4 images
// whose filenames — sorted alphabetically — line up with options A/B/C/D below.
// The admin panel can override folderUrl per question, but these defaults give
// a working photo-backed quiz out of the box.
const Q_FOLDERS = {
  // Q1–Q4: existing ChatGPT-generated photos in Drive
  kitchen_style:      'https://drive.google.com/drive/folders/1b6w9ewHk8978ryrc88z_W4oJPf8Wdh1P',
  primary_bathroom:   'https://drive.google.com/drive/folders/1jWscfEJ8xM0f6UuQPnh7WvBgUoLKa2kR',
  flooring:           'https://drive.google.com/drive/folders/1oMpz4XrYf9ETSQ0tJ_BpzKZKmGRYZ5My',
  exterior:           'https://drive.google.com/drive/folders/1bSbgYNUq3u1weXhZrEj_oMefa8NFLu7l',
  // Q5–Q8: OpenAI gpt-image-1 generated photos served as static assets
  // from portal/images/quiz/. resolveQuizPhotos() handles both Drive and static.
  cabinet_style:      'static:q7-cabinet-style',
  color_mood:         'static:q9-color-mood',
  lighting_signature: 'static:q11-lighting-signature',
  signature_move:     'static:q12-signature-move',
};

// Design board images served as static assets from portal/images/boards/.
// Uses 'static:slug' format — resolveBoardPhotos() handles both Drive and static.
// Styles without images yet have empty strings (generation still in progress).
const BOARD_FOLDERS = {
  'Modern Farmhouse':   'static:modern-farmhouse',
  'Transitional':       'static:transitional',
  'Modern Traditional': 'static:modern-traditional',
  'Organic Modern':     '',  // generation pending
  'Clean Modern':       '',  // generation pending
  'Warm Luxury':        '',  // generation pending
};

// Room ID → display name used in board filenames
const BOARD_ROOM_MAP = {
  kitchen:     'Kitchen',
  master_bath: 'Primary Bath',
  living_room: 'Living Room',
  exterior:    'Exterior',
};

const BOARD_TIERS = ['Essential', 'Elevated', 'Showpiece'];

const DEFAULT_QUIZ = [
  // ── Streamlined 8-question quiz ───────────────────────────────────────────
  // Covers big-picture style direction. Material & finish preferences (countertops,
  // hardware, backsplash, wood tone) are now extracted by the swipe taste board.
  {
    id: 'q1_kitchen',
    prompt: 'Which kitchen feels most like yours?',
    note: 'Pick the one you could step into tomorrow.',
    folderUrl: Q_FOLDERS.kitchen_style,
    options: [
      { letter: 'A', label: 'Clean Modern — crisp lines, flat fronts, minimal hardware',   styles: ['Clean Modern'] },
      { letter: 'B', label: 'Modern Farmhouse — warm whites, shaker, a big apron sink',    styles: ['Modern Farmhouse'] },
      { letter: 'C', label: 'Organic Modern — white oak, plaster, natural textures',       styles: ['Organic Modern'] },
      { letter: 'D', label: 'Transitional — layered neutrals, brushed brass, panel detail', styles: ['Transitional'] },
    ],
  },
  {
    id: 'q2_primary_bath',
    prompt: 'Which primary bathroom feels like your morning?',
    folderUrl: Q_FOLDERS.primary_bathroom,
    options: [
      { letter: 'A', label: 'Clean Modern — large format tile, quiet palette, precision',   styles: ['Clean Modern'] },
      { letter: 'B', label: 'Modern Farmhouse — soft whites, shaker vanity, classic fixtures', styles: ['Modern Farmhouse', 'Transitional'] },
      { letter: 'C', label: 'Organic Warm — natural stone, oak vanity, soft curves',        styles: ['Organic Modern'] },
      { letter: 'D', label: 'Warm Luxury — veined marble, brushed gold, dramatic tile',     styles: ['Warm Luxury', 'Modern Traditional'] },
    ],
  },
  {
    id: 'q3_floors',
    prompt: 'Which floor do you picture underfoot?',
    folderUrl: Q_FOLDERS.flooring,
    options: [
      { letter: 'A', label: 'Dark rich hardwood — walnut, mahogany, heritage feel',         styles: ['Modern Traditional', 'Warm Luxury'] },
      { letter: 'B', label: 'Large-format tile — seamless, architectural, clean',           styles: ['Clean Modern'] },
      { letter: 'C', label: 'Medium-tone aged wood — warm character, lived-in',             styles: ['Modern Farmhouse', 'Transitional'] },
      { letter: 'D', label: 'Wide-plank white oak — soft, modern, natural',                 styles: ['Modern Farmhouse', 'Organic Modern', 'Transitional'] },
    ],
  },
  {
    id: 'q4_exterior',
    prompt: 'Which exterior makes you say "that\u2019s the one"?',
    folderUrl: Q_FOLDERS.exterior,
    options: [
      { letter: 'A', label: 'Clean Modern — flat roof, long horizontal lines, dark cladding', styles: ['Clean Modern'] },
      { letter: 'B', label: 'Modern Farmhouse — board-and-batten, gables, black windows',     styles: ['Modern Farmhouse'] },
      { letter: 'C', label: 'Traditional — brick or limestone, symmetry, classical trim',     styles: ['Modern Traditional'] },
      { letter: 'D', label: 'Warm organic — stucco or natural stone, soft curves, wood tones', styles: ['Organic Modern', 'Warm Luxury'] },
    ],
  },
  {
    id: 'q5_cabinets',
    prompt: 'Which cabinet style speaks to you?',
    note: 'Think about what you want to see every morning.',
    folderUrl: Q_FOLDERS.cabinet_style,
    options: [
      { letter: 'A', label: 'Flat-front white oak — clean, minimal, no hardware',              styles: ['Clean Modern', 'Organic Modern'] },
      { letter: 'B', label: 'Fluted walnut — rich, textured, warm luxury feel',                styles: ['Warm Luxury'] },
      { letter: 'C', label: 'Inset beaded deep green — traditional detail, heritage character', styles: ['Modern Traditional'] },
      { letter: 'D', label: 'Shaker white — classic, clean, timeless',                         styles: ['Modern Farmhouse', 'Transitional'] },
    ],
  },
  {
    id: 'q6_color_mood',
    prompt: 'What color mood do you want to live in?',
    note: 'Close your eyes — which room do you walk into?',
    folderUrl: Q_FOLDERS.color_mood,
    options: [
      { letter: 'A', label: 'Bright and airy — sun-filled whites and creams',                  styles: ['Modern Farmhouse', 'Transitional'] },
      { letter: 'B', label: 'Crisp neutral — quiet greys and soft whites',                     styles: ['Clean Modern', 'Transitional'] },
      { letter: 'C', label: 'Moody and rich — deep greens, navy, warm lamplight',              styles: ['Modern Traditional', 'Warm Luxury'] },
      { letter: 'D', label: 'Warm and earthy — clay, terracotta, natural tones',               styles: ['Organic Modern'] },
    ],
  },
  {
    id: 'q7_lighting',
    prompt: 'Which light fixture would you hang over your island?',
    note: 'Lighting is jewelry for the room.',
    folderUrl: Q_FOLDERS.lighting_signature,
    options: [
      { letter: 'A', label: 'Barn lantern — matte black, glass panels, farmhouse charm',       styles: ['Modern Farmhouse'] },
      { letter: 'B', label: 'Brushed brass globe — simple, warm, quietly elegant',             styles: ['Transitional', 'Clean Modern'] },
      { letter: 'C', label: 'Picture-light sconce — library vibes, old-world warmth',          styles: ['Modern Traditional'] },
      { letter: 'D', label: 'Sculptural chandelier — dramatic, artful, a conversation piece',  styles: ['Warm Luxury'] },
    ],
  },
  {
    id: 'q8_signature',
    prompt: 'Which design move makes your heart skip?',
    note: 'This is the detail that makes a house yours.',
    folderUrl: Q_FOLDERS.signature_move,
    options: [
      { letter: 'A', label: 'Built-in paneled library — deep shelves, brass lights, rich color', styles: ['Modern Traditional'] },
      { letter: 'B', label: 'Curved plaster arch — soft, sculptural, earthy',                    styles: ['Organic Modern'] },
      { letter: 'C', label: 'Exposed ceiling beams — open, warm, rustic character',              styles: ['Modern Farmhouse'] },
      { letter: 'D', label: 'Waterfall island — seamless stone, architectural drama',            styles: ['Clean Modern', 'Warm Luxury'] },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Default curated products. Fox uses these as a starting point for product
//  recommendations. Admin can override / extend via POST.
//
//  Shape:
//    products['Modern Farmhouse'].countertops = [
//      { tier: 'Essential', name: '...', note: '...' },
//      { tier: 'Elevated',  name: '...', note: '...' },
//      { tier: 'Showpiece', name: '...', note: '...' },
//    ]
//
//  NO dollar amounts — pricing scales with house budget and square footage.
//  Tiers are: Essential / Elevated / Showpiece.
// ─────────────────────────────────────────────────────────────────────────────

const SELECTION_CATEGORIES = [
  'fireplace', 'appliances', 'exterior_finishes', 'specialty_trim',
  'flooring', 'tile', 'plumbing', 'lighting',
  'countertops', 'hardware', 'paint', 'doors',
];

// Helper to build a three-tier product entry
function _p(essential, elevated, showpiece) {
  return [
    { tier: 'Essential', ...essential },
    { tier: 'Elevated',  ...elevated },
    { tier: 'Showpiece', ...showpiece },
  ];
}

const DEFAULT_PRODUCTS = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  MODERN FARMHOUSE
  // ═══════════════════════════════════════════════════════════════════════════
  'Modern Farmhouse': {
    countertops: _p(
      { name: 'White quartz (Caesarstone Pure White or similar)', note: 'Clean, durable, low-maintenance — the everyday workhorse.' },
      { name: 'Honed Carrara marble', note: 'Soft veining, warm whites — patinas beautifully over time.' },
      { name: 'Leathered quartzite (Taj Mahal or Sea Pearl)', note: 'Natural movement with the durability of granite — truly special.' },
    ),
    flooring: _p(
      { name: 'Engineered white oak 5″ plank (wire-brushed)', note: 'Warm, wide, stable — classic farmhouse underfoot.' },
      { name: 'Solid white oak 7″ wide plank (custom stain)', note: 'Deeper grain character, site-finished for a seamless look.' },
      { name: 'Reclaimed heart pine or antique white oak', note: 'Genuinely old wood with a century of patina — irreplaceable.' },
    ),
    tile: _p(
      { name: 'White 3×6 subway tile (glossy or matte)', note: 'Never out of style — clean lines, bright kitchen wall.' },
      { name: 'Handmade 3×6 crackle-glaze subway', note: 'Same format, more depth — each tile is slightly different.' },
      { name: 'Zellige tile (hand-cut Moroccan)', note: 'Artisanal imperfections give unmatched warmth and texture.' },
    ),
    hardware: _p(
      { name: 'Matte black cup pulls + knobs (Amerock or similar)', note: 'Solid, clean, the modern farmhouse standard.' },
      { name: 'Oil-rubbed bronze bin pulls (Rejuvenation)', note: 'Warmer patina that deepens with use.' },
      { name: 'Hand-forged iron pulls (custom blacksmith)', note: 'One of a kind — every pull has slight hand-worked variation.' },
    ),
    plumbing: _p(
      { name: 'Fireclay apron-front sink + pull-down faucet (Kraus or similar)', note: 'Classic farmhouse form at a strong value.' },
      { name: 'Rohl Shaws fireclay sink + Perrin & Rowe bridge faucet', note: 'English heritage, gorgeous proportions.' },
      { name: 'Custom copper apron sink + unlacquered brass faucet (Waterworks)', note: 'Living finish that develops unique patina — the real thing.' },
    ),
    lighting: _p(
      { name: 'Black barn-style pendants × 3 (Kichler or similar)', note: 'Simple, iconic, great over an island.' },
      { name: 'Schoolhouse pendants + matching sconces (Schoolhouse Electric)', note: 'Cohesive vintage-modern layer.' },
      { name: 'Custom blown-glass lanterns (Urban Electric or similar)', note: 'Statement pieces — hand-blown, one-of-a-kind glow.' },
    ),
    appliances: _p(
      { name: 'GE Profile or KitchenAid suite (stainless)', note: 'Reliable, good-looking, widely available.' },
      { name: 'Café Appliances suite (matte white or matte black)', note: 'Customizable hardware, farmhouse-friendly finishes.' },
      { name: 'La Cornue or AGA range + panel-ready Sub-Zero', note: 'Heirloom-level cooking — the centerpiece of the kitchen.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore White Dove (OC-17) walls + Wrought Iron trim', note: 'Warm white + deep contrast — the go-to combo.' },
      { name: 'Farrow & Ball All White + Down Pipe', note: 'Richer pigment, more depth in the finish.' },
      { name: 'Portola lime wash (custom color match)', note: 'Hand-applied texture with built-in depth — no two walls alike.' },
    ),
    fireplace: _p(
      { name: 'Painted shiplap surround + simple mantel', note: 'Clean, paintable, classic farmhouse.' },
      { name: 'Reclaimed wood beam mantel + stacked stone surround', note: 'More texture and weight — a real focal point.' },
      { name: 'Full limestone surround with hand-carved mantel', note: 'Architectural statement — old-world craft.' },
    ),
    exterior_finishes: _p(
      { name: 'James Hardie board-and-batten (Arctic White) + black windows', note: 'Iconic modern farmhouse look, low maintenance.' },
      { name: 'Natural cedar board-and-batten + standing-seam metal roof accent', note: 'Real wood warmth with architectural metal detail.' },
      { name: 'Custom-milled vertical siding + copper gutters + stone base', note: 'Layered materials — the kind of exterior people photograph.' },
    ),
    specialty_trim: _p(
      { name: 'MDF shaker-profile wainscoting (painted)', note: 'Adds character on a budget — classic panel look.' },
      { name: 'Tongue-and-groove ceiling + built-in mudroom bench', note: 'Architectural layers that make the house feel finished.' },
      { name: 'Full coffered ceilings + custom built-in cabinetry', note: 'Millwork that defines the room — museum-level.' },
    ),
    doors: _p(
      { name: 'Solid-core 2-panel shaker (painted white)', note: 'Clean lines, good weight — a solid upgrade from hollow-core.' },
      { name: 'True divided-lite interior doors (glass panels)', note: 'Let light flow between rooms — classic charm.' },
      { name: 'Custom arched entry door + antique-reproduction interior doors', note: 'Every door a statement — the house tells a story at every threshold.' },
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRANSITIONAL
  // ═══════════════════════════════════════════════════════════════════════════
  'Transitional': {
    countertops: _p(
      { name: 'Quartz (Cambria Torquay or Silestone Calacatta Gold)', note: 'Subtle marble look without the maintenance.' },
      { name: 'Honed quartzite (White Macaubas)', note: 'Natural stone with a polished, understated feel.' },
      { name: 'Book-matched Calacatta Oro marble', note: 'Dramatic veining, perfectly mirrored — a true luxury counter.' },
    ),
    flooring: _p(
      { name: 'Engineered oak 5″ plank in warm medium stain', note: 'Versatile, warm, pairs with everything.' },
      { name: 'Solid white oak 7″ plank (custom matte finish)', note: 'Wider, richer — a noticeably elevated floor.' },
      { name: 'European white oak parquet (herringbone pattern)', note: 'Old-world pattern, modern finish — unforgettable floors.' },
    ),
    tile: _p(
      { name: 'Marble-look porcelain subway tile', note: 'Clean lines with a hint of stone character.' },
      { name: 'Honed marble subway with brass Schluter trim', note: 'Real marble, polished detail at the edges.' },
      { name: 'Waterjet marble mosaic (arabesque or herringbone)', note: 'Intricate pattern work — each piece precision-cut.' },
    ),
    hardware: _p(
      { name: 'Brushed brass knobs + pulls (Top Knobs or similar)', note: 'Warm, polished, fits the transitional sweet spot.' },
      { name: 'Satin brass pulls (Armac Martin or Emtek)', note: 'Heavier weight, tighter tolerances — you feel the quality.' },
      { name: 'Unlacquered brass (Waterworks or custom)', note: 'Living finish that develops rich patina with use.' },
    ),
    plumbing: _p(
      { name: 'Undermount single-bowl stainless + Moen Align faucet', note: 'Clean, functional, contemporary classic.' },
      { name: 'Kohler Whitehaven apron sink + Purist faucet (brushed brass)', note: 'Elevated farmhouse lines with refined hardware.' },
      { name: 'Waterstone traditional faucet + Shaw fireclay farmhouse sink', note: 'Hand-finished brass, heirloom-grade ceramics.' },
    ),
    lighting: _p(
      { name: 'Brushed brass globe pendants × 2 (West Elm or CB2)', note: 'Simple, warm, modern — great island lighting.' },
      { name: 'Visual Comfort brass linear chandelier', note: 'Polished lines, even light spread — designer standard.' },
      { name: 'Custom linear suspension (Apparatus or Roll & Hill)', note: 'Art-level lighting — sculptural and functional.' },
    ),
    appliances: _p(
      { name: 'KitchenAid or Bosch stainless suite', note: 'Reliable, clean design, great value.' },
      { name: 'Fisher & Paykel or Thermador Professional', note: 'Pro-grade performance in a refined package.' },
      { name: 'Wolf range + Sub-Zero columns (panel-ready)', note: 'Best-in-class — disappears into cabinetry or commands attention.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore Revere Pewter + Simply White trim', note: 'Warm greige — the transitional neutral standard.' },
      { name: 'Farrow & Ball Skimming Stone + Strong White', note: 'More nuance and depth — beautiful in changing light.' },
      { name: 'Venetian plaster (Stucco Italiano or Limestrong)', note: 'Seamless, luminous walls — a finish, not just a color.' },
    ),
    fireplace: _p(
      { name: 'Marble tile surround + painted MDF mantel', note: 'Clean, classic, easy to style.' },
      { name: 'Full-height paneled surround with honed marble hearth', note: 'Architectural framing — makes the mantel a statement.' },
      { name: 'Floor-to-ceiling fluted stone surround (custom)', note: 'Monolithic stone — a fireplace you build a room around.' },
    ),
    exterior_finishes: _p(
      { name: 'Fiber cement lap siding (warm grey) + black clad windows', note: 'Clean lines, low maintenance, classic feel.' },
      { name: 'Brick + painted wood trim + standing-seam metal entry roof', note: 'Layered materials with traditional bones.' },
      { name: 'Natural limestone base + painted cedar + copper accents', note: 'Timeless material mix — gets better with age.' },
    ),
    specialty_trim: _p(
      { name: 'Chair rail + panel molding in dining/entry', note: 'Classic wall detail — instant architectural weight.' },
      { name: 'Full wall paneling + crown molding package', note: 'Every room has structure and rhythm.' },
      { name: 'Custom millwork library + paneled ceiling + arched doorways', note: 'Bespoke trim that turns a house into an estate.' },
    ),
    doors: _p(
      { name: 'Solid-core 1-panel shaker (painted)', note: 'Simple, modern, substantial feel.' },
      { name: '5-panel mission doors + satin brass hinges', note: 'More detail, warm hardware — refined touch.' },
      { name: 'Custom solid-wood doors with concealed hinges', note: 'Flush lines, invisible hardware — cabinetry-level craft.' },
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  MODERN TRADITIONAL
  // ═══════════════════════════════════════════════════════════════════════════
  'Modern Traditional': {
    countertops: _p(
      { name: 'Honed quartz (Caesarstone Calacatta Nuvo)', note: 'Marble look, zero upkeep — practical luxury.' },
      { name: 'Honed Calacatta marble', note: 'Rich veining, warm tone — the real thing, beautifully imperfect.' },
      { name: 'Book-matched Calacatta Viola marble', note: 'Dramatic purple-grey veining — a signature stone.' },
    ),
    flooring: _p(
      { name: 'Engineered walnut 5″ plank', note: 'Rich dark tone, stable and consistent.' },
      { name: 'Solid walnut 7″ wide plank (site-finished)', note: 'Deeper color variation, hand-finished warmth.' },
      { name: 'Antique reclaimed walnut or mahogany parquet', note: 'Genuine old wood — every board has a story.' },
    ),
    tile: _p(
      { name: 'Marble-look porcelain in herringbone layout', note: 'Classic pattern, stone feel, durable.' },
      { name: 'Honed Calacatta hexagon mosaic', note: 'Timeless, elegant — the traditional bath standard.' },
      { name: 'Custom waterjet marble medallion + border', note: 'Precision-cut artistry — like a stone carpet.' },
    ),
    hardware: _p(
      { name: 'Oil-rubbed bronze knobs + bin pulls (Baldwin)', note: 'Traditional, warm, heritage feel.' },
      { name: 'Unlacquered brass cup pulls (Rejuvenation)', note: 'Warm patina that deepens beautifully.' },
      { name: 'Hand-cast bronze hardware (Rocky Mountain or E.R. Butler)', note: 'Investment hardware — each piece is individually cast.' },
    ),
    plumbing: _p(
      { name: 'Undermount farmhouse sink + widespread faucet (Delta Cassidy)', note: 'Traditional styling at a solid value.' },
      { name: 'Rohl fireclay sink + Perrin & Rowe faucet (unlacquered brass)', note: 'English heritage, gorgeous proportions.' },
      { name: 'Waterworks faucet + custom stone basin', note: 'Museum-level bathroom fittings — the finest available.' },
    ),
    lighting: _p(
      { name: 'Classic lantern pendants in aged brass (Quoizel or similar)', note: 'Traditional form, warm finish.' },
      { name: 'Visual Comfort Darlana or CHD library sconces', note: 'The designer standard for traditional homes.' },
      { name: 'Vaughan or Circa Lighting custom chandeliers', note: 'English heritage lighting — every fixture is an antique in the making.' },
    ),
    appliances: _p(
      { name: 'KitchenAid or GE Profile (stainless or black stainless)', note: 'Reliable, clean, blends into any kitchen.' },
      { name: 'Thermador or BlueStar range + panel-ready fridge', note: 'Pro performance with options to hide behind cabinet panels.' },
      { name: 'La Cornue CornuFé range + fully integrated Sub-Zero/Wolf', note: 'Furniture-grade appliances — the kitchen as showroom.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore Hale Navy accent + White Dove walls', note: 'Classic contrast — deep and inviting.' },
      { name: 'Farrow & Ball Studio Green + Pointing trim', note: 'Rich heritage green — moody, warm, alive.' },
      { name: 'Custom color-matched lime wash + lacquered accent walls', note: 'Dimensional walls — high-gloss lacquer reflects like a mirror.' },
    ),
    fireplace: _p(
      { name: 'Painted paneled surround + stone hearth', note: 'Clean traditional lines, easy to customize.' },
      { name: 'Full limestone surround with dentil molding', note: 'Architectural stone detail — classical and warm.' },
      { name: 'Hand-carved marble mantel (antique or reproduction)', note: 'A genuine art piece — the kind collectors seek out.' },
    ),
    exterior_finishes: _p(
      { name: 'Brick veneer + painted wood trim + asphalt shingle', note: 'Classic traditional look, proven durability.' },
      { name: 'Full brick + limestone window surrounds + slate roof accent', note: 'Layered stone and masonry — substantial and dignified.' },
      { name: 'Hand-laid natural stone + copper roof + custom iron railings', note: 'Old-world craft — the house looks like it\'s always been there.' },
    ),
    specialty_trim: _p(
      { name: 'Crown molding + baseboard package (6″+)', note: 'Proportional trim — makes standard rooms feel grand.' },
      { name: 'Coffered ceiling + paneled wainscoting + picture rails', note: 'Full architectural trim package — every surface detailed.' },
      { name: 'Custom plaster ceiling medallions + hand-carved moldings', note: 'Artisan plasterwork — European estate level.' },
    ),
    doors: _p(
      { name: 'Solid-core 6-panel (painted)', note: 'Traditional profile, good weight.' },
      { name: 'True divided-lite french doors + raised-panel interior', note: 'Classical proportions, glass light flow.' },
      { name: 'Custom mahogany entry door + arched transom + pocket doors', note: 'Every doorway is an architectural moment.' },
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ORGANIC MODERN
  // ═══════════════════════════════════════════════════════════════════════════
  'Organic Modern': {
    countertops: _p(
      { name: 'Quartz in warm white (Silestone Calacatta Gold or similar)', note: 'Clean surface with soft warmth.' },
      { name: 'Honed soapstone', note: 'Matte, tactile, naturally antibacterial — develops character.' },
      { name: 'Live-edge walnut slab island + quartzite perimeter', note: 'Natural edge, organic form — the island is a sculpture.' },
    ),
    flooring: _p(
      { name: 'Engineered white oak 6″ plank (natural matte finish)', note: 'Light, modern, beautifully simple.' },
      { name: 'Wide-plank white oak 8″+ (European grade, matte oil)', note: 'More natural variation, butter-soft finish.' },
      { name: 'Hand-scraped white oak or teak (custom oil finish)', note: 'Artisan texture underfoot — every board unique.' },
    ),
    tile: _p(
      { name: 'Handmade-look ceramic in warm white', note: 'Subtle variation, organic feel, easy to source.' },
      { name: 'Zellige tile (hand-cut, natural white or sage)', note: 'Moroccan artisan tile — undulating surface catches light.' },
      { name: 'Cle Tile zellige + custom terracotta floor tile', note: 'Full artisan tile program — walls and floors tell a story.' },
    ),
    hardware: _p(
      { name: 'Leather pulls + matte brass knobs (CB2 or similar)', note: 'Soft, tactile, organic — a fresh alternative to metal.' },
      { name: 'Unlacquered brass knurled pulls (Buster + Punch)', note: 'Industrial meets organic — develops beautiful patina.' },
      { name: 'Custom hand-thrown ceramic knobs + bronze pulls', note: 'Artisan-made — every piece slightly different.' },
    ),
    plumbing: _p(
      { name: 'Undermount stainless + pull-down faucet (satin brass)', note: 'Warm metal, clean form, reliable function.' },
      { name: 'Concrete vessel sink + wall-mount faucet (unlacquered brass)', note: 'Sculptural basin, minimal footprint.' },
      { name: 'Hand-carved stone basin + Vola or Fantini wall-mount faucet', note: 'Each basin is unique — river-stone or marble, hand-finished.' },
    ),
    lighting: _p(
      { name: 'Woven rattan or linen drum pendants (DERA or similar)', note: 'Soft light, natural material, organic warmth.' },
      { name: 'Ceramic pendant cluster (Heather Levine or Apparatus)', note: 'Handmade clay forms — art that lights a room.' },
      { name: 'Custom plaster dome pendants + artisan sconces', note: 'Sculptural plaster — seamless, glowing, monolithic.' },
    ),
    appliances: _p(
      { name: 'Bosch or Fisher & Paykel (panel-ready where possible)', note: 'Disappears into cabinetry — the organic kitchen is about materials, not logos.' },
      { name: 'Fisher & Paykel integrated columns + induction cooktop', note: 'Sleek, invisible, lets the kitchen materials breathe.' },
      { name: 'Gaggenau fully integrated + Bora downdraft (no hood)', note: 'No visual appliance clutter — the kitchen looks like furniture.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore White Sand + Natural Linen trim', note: 'Warm, quiet, grounding — lets materials lead.' },
      { name: 'Farrow & Ball Jitney or Setting Plaster', note: 'Earthy, clay-warm — beautiful in natural light.' },
      { name: 'Lime wash plaster walls (Portola or Roman Clay)', note: 'Hand-applied plaster — depth and movement in every wall.' },
    ),
    fireplace: _p(
      { name: 'Smooth plaster surround (rounded edges)', note: 'Sculptural, minimal — organic modern\'s signature fireplace.' },
      { name: 'Hand-plastered arch surround + stone hearth', note: 'Curved form, natural stone base — a warm focal point.' },
      { name: 'Full plaster hood fireplace (floor to ceiling) + custom grate', note: 'Monolithic plaster — the room orbits around it.' },
    ),
    exterior_finishes: _p(
      { name: 'Smooth stucco (warm white) + natural wood accent', note: 'Clean, warm, Mediterranean-inflected.' },
      { name: 'Lime-wash stucco + cedar accent wall + ipe deck', note: 'Textured walls, real wood — ages beautifully.' },
      { name: 'Rammed earth accent wall + weathering steel + natural stone', note: 'Raw, elemental materials — the house feels grown from the land.' },
    ),
    specialty_trim: _p(
      { name: 'Rounded plaster arch doorways (drywall build-out)', note: 'Soft arches transform standard openings.' },
      { name: 'Full arched openings + floating oak shelves + niches', note: 'Sculptural plaster transitions, integrated storage.' },
      { name: 'Tadelakt plaster wet room + custom curved millwork', note: 'Waterproof lime plaster + organic cabinetry — spa-level craft.' },
    ),
    doors: _p(
      { name: 'Flush solid-core slab doors (warm white)', note: 'Minimal, clean — lets the walls and materials speak.' },
      { name: 'White oak slab doors with concealed hinges', note: 'Warm wood, invisible hardware — furniture-grade.' },
      { name: 'Custom arched white oak doors + pivot entry door', note: 'Sculptural doorways — every transition is intentional.' },
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CLEAN MODERN
  // ═══════════════════════════════════════════════════════════════════════════
  'Clean Modern': {
    countertops: _p(
      { name: 'White quartz (Caesarstone Statuario Nuvo)', note: 'Crisp, consistent — the modern kitchen standard.' },
      { name: 'Dekton ultra-compact surface (Kelya or Sirius)', note: 'Virtually indestructible, razor-thin edge profile.' },
      { name: 'Neolith sintered stone slab (waterfall island)', note: 'Seamless waterfall edges — a monolithic stone statement.' },
    ),
    flooring: _p(
      { name: 'Large-format porcelain tile (24×24 or 24×48)', note: 'Minimal grout lines, clean plane — architectural floor.' },
      { name: 'Engineered European oak in matte grey-wash', note: 'Warm enough to balance all the crisp surfaces.' },
      { name: 'Polished concrete or terrazzo (poured in place)', note: 'Seamless, industrial-modern — no seams, no grout, all texture.' },
    ),
    tile: _p(
      { name: 'Large-format porcelain wall tile (marble look)', note: 'Minimal joints, maximum visual impact.' },
      { name: 'Full slab porcelain backsplash (book-matched)', note: 'No grout lines — the wall reads as one stone.' },
      { name: 'Back-painted glass or natural stone slab (floor to ceiling)', note: 'Reflective or natural — either way, seamless and sculptural.' },
    ),
    hardware: _p(
      { name: 'Integrated finger pulls (routed into cabinet edge)', note: 'No visible hardware — the ultimate clean line.' },
      { name: 'Brushed stainless edge pulls (Sugatsune or Hafele)', note: 'Minimal profile, precision-machined feel.' },
      { name: 'Custom milled aluminum channel pulls (anodized)', note: 'Bespoke — designed specifically for each cabinet run.' },
    ),
    plumbing: _p(
      { name: 'Undermount single-bowl stainless + Grohe Essence faucet', note: 'Clean geometry, flush-mount — quietly excellent.' },
      { name: 'Integrated stainless workstation sink + Dornbracht faucet', note: 'Built-in cutting boards, colanders — the sink is a tool.' },
      { name: 'Custom integrated Corian sink + Vola wall-mount faucet', note: 'Sink and counter are one seamless surface — no edges, no joints.' },
    ),
    lighting: _p(
      { name: 'Recessed LED cans + under-cabinet LED strips', note: 'Invisible source, clean light — architecture does the work.' },
      { name: 'Linear LED pendant (Flos or Vibia)', note: 'One sculptural line of light over the island.' },
      { name: 'Custom cove lighting system + Occhio or Nemo fixtures', note: 'Integrated light architecture — the ceiling glows, no fixtures visible.' },
    ),
    appliances: _p(
      { name: 'Bosch 800 series (panel-ready)', note: 'Fully hidden behind cabinet panels — clean lines.' },
      { name: 'Miele panel-ready + induction cooktop', note: 'German engineering, invisible integration.' },
      { name: 'Gaggenau 400 series + Bora downdraft (hoodless)', note: 'No hood, no handles, no logos — appliances as architecture.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore Chantilly Lace + Super White trim', note: 'Crisp, bright, lets architecture lead.' },
      { name: 'Benjamin Moore Gray Owl + matte lacquer accent wall', note: 'Warm grey + a reflective moment — refined modern palette.' },
      { name: 'Microcement walls (Ideal Work or Topciment)', note: 'Seamless, industrial, tactile — no paint, no wallpaper, all texture.' },
    ),
    fireplace: _p(
      { name: 'Full-height porcelain slab surround', note: 'One material, floor to ceiling — clean and dramatic.' },
      { name: 'Blackened steel box surround + concrete hearth', note: 'Industrial materials, precise geometry.' },
      { name: 'Suspended steel + glass fireplace (custom)', note: 'A floating fire — architectural sculpture.' },
    ),
    exterior_finishes: _p(
      { name: 'Fiber cement panels (dark charcoal) + aluminum-clad windows', note: 'Flat planes, dark palette — modern from the street.' },
      { name: 'Zinc or Corten steel cladding + ipe rain screen', note: 'Weathering metals that change with time — alive.' },
      { name: 'Board-formed concrete + blackened steel + hidden gutters', note: 'Monolithic — the house reads as one cast form.' },
    ),
    specialty_trim: _p(
      { name: 'Flush baseboards + shadow-gap reveal (no crown molding)', note: 'Clean modern DNA — trim disappears, walls float.' },
      { name: 'Full flush-detail package + integrated LED reveals', note: 'Light in the walls — shadows and glow define the rooms.' },
      { name: 'Custom pivot walls + motorized panels + hidden rooms', note: 'Architecture as furniture — walls move, rooms transform.' },
    ),
    doors: _p(
      { name: 'Flush solid-core slab (painted to match walls)', note: 'Invisible doors — the wall plane is unbroken.' },
      { name: 'Floor-to-ceiling flush doors with concealed hinges', note: 'Full-height, frameless — monumental simplicity.' },
      { name: 'Custom pivot doors (10ft+ height) + motorized pocket doors', note: 'Doors as architecture — they rotate, disappear, transform the plan.' },
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  WARM LUXURY
  // ═══════════════════════════════════════════════════════════════════════════
  'Warm Luxury': {
    countertops: _p(
      { name: 'Polished quartz (Caesarstone Empira Black)', note: 'Deep, rich, durable — luxury look, practical surface.' },
      { name: 'Honed Calacatta Viola marble', note: 'Purple-grey veining on warm white — dramatic and rare.' },
      { name: 'Book-matched exotic marble (Paonazzo or Arabescato Orobico)', note: 'Mirrored slabs — a geological artwork as your countertop.' },
    ),
    flooring: _p(
      { name: 'Engineered walnut 6″ plank (warm matte finish)', note: 'Rich, dark, grounding — sets a warm luxury tone.' },
      { name: 'Wide-plank European walnut (brushed, oiled)', note: 'Deeper grain character, softer underfoot.' },
      { name: 'Parquet de Versailles or custom inlay pattern', note: 'French palace-level floors — geometry and wood as art.' },
    ),
    tile: _p(
      { name: 'Polished marble look porcelain (large format)', note: 'Dramatic veining, durable, budget-friendly.' },
      { name: 'Honed marble mosaics (chevron or arabesque)', note: 'Intricate real-stone patterns — handset luxury.' },
      { name: 'Book-matched marble slab walls + mosaic floor (bathroom)', note: 'Full stone immersion — walls and floors tell one story.' },
    ),
    hardware: _p(
      { name: 'Brushed gold pulls + knobs (Amerock Golden Champagne)', note: 'Warm gold, clean lines — accessible luxury.' },
      { name: 'Satin brass fluted pulls (Armac Martin or Emtek)', note: 'Textured surface catches light — tactile and elegant.' },
      { name: 'Hand-cast solid bronze hardware (E.R. Butler or Nanz)', note: 'Weight and warmth in your hand — the finest hardware made.' },
    ),
    plumbing: _p(
      { name: 'Undermount double-bowl + Brizo Litze faucet (brushed gold)', note: 'Modern form, warm finish — elevated everyday.' },
      { name: 'Rohl fireclay sink + Perrin & Rowe bridge (satin brass)', note: 'Heritage form, luxe finish — timeless combination.' },
      { name: 'Waterworks freestanding tub + wall-mount faucet + rain shower', note: 'Sculpture-grade fixtures — the bathroom is a destination.' },
    ),
    lighting: _p(
      { name: 'Crystal + brass pendants (Restoration Hardware or similar)', note: 'Sparkle + warmth — glamorous without trying.' },
      { name: 'Visual Comfort Aerin or Kelly Wearstler collection', note: 'Designer pedigree, sculptural form — a name over your island.' },
      { name: 'Custom Murano glass chandelier + bespoke sconce program', note: 'Hand-blown Italian glass — each fixture is a work of art.' },
    ),
    appliances: _p(
      { name: 'Thermador Professional suite', note: 'Pro-grade, great aesthetics, serious cooking power.' },
      { name: 'Wolf range + Sub-Zero fridge + Cove dishwasher', note: 'The luxury trifecta — restaurant power, residential beauty.' },
      { name: 'La Cornue Château range + Miele steam oven + wine columns', note: 'Bespoke French range + full culinary arsenal — the ultimate kitchen.' },
    ),
    paint: _p(
      { name: 'Benjamin Moore Kendall Charcoal + White Dove', note: 'Rich contrast — moody walls, crisp trim.' },
      { name: 'Farrow & Ball Hague Blue or Salamander + warm trim', note: 'Deep jewel tones — dramatic, enveloping rooms.' },
      { name: 'High-gloss lacquer walls + Venetian plaster ceiling', note: 'Mirror-finish walls reflect light and art — gallery-level treatment.' },
    ),
    fireplace: _p(
      { name: 'Marble surround + fluted detail', note: 'Classic luxury — stone and texture.' },
      { name: 'Book-matched marble surround (floor to ceiling)', note: 'Dramatic stone statement — the room\'s centerpiece.' },
      { name: 'Antique reclaimed marble mantel + custom bronze surround', note: 'Genuine antique stone — centuries of provenance.' },
    ),
    exterior_finishes: _p(
      { name: 'Painted brick + black clad windows + stone entry', note: 'Classic luxury from the curb — refined and dignified.' },
      { name: 'Natural stone veneer + copper gutters + slate roof', note: 'Layered, aging materials — gets more beautiful with time.' },
      { name: 'Full cut stone facade + custom iron balconettes + clay tile roof', note: 'European estate presence — the house commands its street.' },
    ),
    specialty_trim: _p(
      { name: 'Paneled wainscoting + picture rail (dining + entry)', note: 'Traditional framing — sets the luxury baseline.' },
      { name: 'Full wall paneling + coffered ceiling + arched openings', note: 'Every room architecturally complete — museum-level trim.' },
      { name: 'Custom fluted millwork + lacquered built-ins + plaster details', note: 'Bespoke trim program — hand-fluted columns, specialty plaster, the works.' },
    ),
    doors: _p(
      { name: 'Solid-core raised-panel doors (painted)', note: 'Traditional weight and profile — a solid starting point.' },
      { name: 'Walnut-stained interior doors + glass-panel french doors', note: 'Rich wood, elegant proportions, natural light.' },
      { name: 'Custom solid walnut doors + bronze hinges + pivot entry', note: 'Every door is furniture — bronze, walnut, and weight.' },
    ),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Supabase helpers
// ─────────────────────────────────────────────────────────────────────────────

function sbHeaders() {
  return {
    'apikey':        SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type':  'application/json',
  };
}

async function loadOverrides() {
  const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${CATALOG_CLIENT_ID}&select=suffix,data`;
  try {
    const res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) {
      console.warn('style-catalog loadOverrides: non-OK', res.status);
      return {};
    }
    const rows = await res.json();
    const out = {};
    (rows || []).forEach(r => { if (ALLOWED_SUFFIXES.has(r.suffix)) out[r.suffix] = r.data; });
    return out;
  } catch (err) {
    console.error('style-catalog loadOverrides error:', err.message);
    return {};
  }
}

async function saveSuffix(suffix, data) {
  if (!ALLOWED_SUFFIXES.has(suffix)) throw new Error(`Bad suffix: ${suffix}`);
  const url = `${SB_URL()}/rest/v1/selections?on_conflict=client_id%2Csuffix`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      'Prefer': 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify({
      client_id:  CATALOG_CLIENT_ID,
      suffix,
      data,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${suffix}: ${res.status} ${await res.text()}`);
}

async function deleteSuffix(suffix) {
  if (!ALLOWED_SUFFIXES.has(suffix)) throw new Error(`Bad suffix: ${suffix}`);
  const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${CATALOG_CLIENT_ID}&suffix=eq.${suffix}`;
  const res = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase delete ${suffix}: ${res.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Google Drive photo resolution (optional, triggered by ?withPhotos=1)
// ─────────────────────────────────────────────────────────────────────────────

function extractFolderId(urlOrId) {
  if (!urlOrId) return null;
  const m = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(urlOrId.trim())) return urlOrId.trim();
  return null;
}

async function listFolderImages(folderId, apiKey) {
  const query  = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  const fields = 'files(id,name,mimeType,createdTime)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${apiKey}&fields=${encodeURIComponent(fields)}&orderBy=name&pageSize=20`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    let msg = `Drive API ${res.status}`;
    try { msg = JSON.parse(txt).error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.files || []).map(f => ({
    id:       f.id,
    name:     f.name,
    thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
  }));
}

// Static quiz image manifest. Keys match the static:slug in Q_FOLDERS.
// Filenames are sorted alphabetically to match A/B/C/D option order.
const STATIC_QUIZ_IMAGES = {
  'q7-cabinet-style': [
    'Flat-front white oak.png',
    'Fluted walnut.png',
    'Inset beaded deep green.png',
    'Shaker white.png',
  ],
  'q9-color-mood': [
    'Bright and airy.png',
    'Crisp neutral.png',
    'Moody and rich.png',
    'Warm and earthy.png',
  ],
  'q11-lighting-signature': [
    'Barn lantern pendant.png',
    'Brushed brass globe.png',
    'Picture-light sconce.png',
    'Sculptural chandelier.png',
  ],
  'q12-signature-move': [
    'Built-in paneled library.png',
    'Curved plaster arch.png',
    'Exposed ceiling beams.png',
    'Waterfall island.png',
  ],
};

function resolveStaticQuizPhotos(slug) {
  const files = STATIC_QUIZ_IMAGES[slug];
  if (!files) return [];
  return files.map((name, i) => ({
    id: `${slug}-${i}`,
    name,
    thumbUrl: `/images/quiz/${slug}/${encodeURIComponent(name)}`,
  }));
}

async function resolveQuizPhotos(quiz) {
  const apiKey = GS_KEY();

  return Promise.all(quiz.map(async (q) => {
    // Static images (served from portal/images/quiz/)
    if (q.folderUrl && q.folderUrl.startsWith('static:')) {
      const slug = q.folderUrl.replace('static:', '');
      return { ...q, photos: resolveStaticQuizPhotos(slug) };
    }

    // Drive-hosted images
    if (!apiKey) return { ...q, photos: [], photosError: 'GOOGLE_API_KEY not configured' };
    const folderId = extractFolderId(q.folderUrl);
    if (!folderId) return { ...q, photos: [], photosError: 'Invalid folder URL' };
    try {
      const photos = await listFolderImages(folderId, apiKey);
      return { ...q, photos };
    } catch (err) {
      return { ...q, photos: [], photosError: err.message };
    }
  }));
}

// Parse a board image filename like "Kitchen — Essential.png" into { roomId, tierId }.
function parseBoardFilename(name) {
  const match = name.match(/^(.+?)\s*[—–-]\s*(.+?)\.(?:png|jpg|jpeg|webp)$/i);
  if (!match) return null;
  const roomName = match[1].trim();
  const tierName = match[2].trim();

  const roomId = Object.entries(BOARD_ROOM_MAP).find(
    ([, n]) => n.toLowerCase() === roomName.toLowerCase()
  )?.[0];
  if (!roomId) return null;

  const tierId = tierName.toLowerCase();
  if (!BOARD_TIERS.map(t => t.toLowerCase()).includes(tierId)) return null;

  return { roomId, tierId };
}

// Static board image manifest. Built from the generated output.
// Each style slug maps to an array of filenames present in portal/images/boards/<slug>/.
const STATIC_BOARD_IMAGES = {
  'modern-farmhouse': [
    'Exterior — Elevated.png', 'Exterior — Essential.png', 'Exterior — Showpiece.png',
    'Kitchen — Elevated.png', 'Kitchen — Essential.png', 'Kitchen — Showpiece.png',
    'Living Room — Elevated.png', 'Living Room — Essential.png', 'Living Room — Showpiece.png',
    'Primary Bath — Elevated.png', 'Primary Bath — Essential.png', 'Primary Bath — Showpiece.png',
  ],
  'transitional': [
    'Exterior — Elevated.png', 'Exterior — Essential.png', 'Exterior — Showpiece.png',
    'Kitchen — Elevated.png', 'Kitchen — Essential.png', 'Kitchen — Showpiece.png',
    'Living Room — Elevated.png', 'Living Room — Essential.png', 'Living Room — Showpiece.png',
    'Primary Bath — Elevated.png', 'Primary Bath — Essential.png', 'Primary Bath — Showpiece.png',
  ],
  'modern-traditional': [
    'Kitchen — Elevated.png', 'Kitchen — Essential.png', 'Kitchen — Showpiece.png',
    'Living Room — Essential.png',
    'Primary Bath — Elevated.png', 'Primary Bath — Essential.png', 'Primary Bath — Showpiece.png',
  ],
};

function resolveStaticBoardPhotos(slug) {
  const files = STATIC_BOARD_IMAGES[slug];
  if (!files) return {};
  const byRoom = {};
  for (const name of files) {
    const parsed = parseBoardFilename(name);
    if (!parsed) continue;
    if (!byRoom[parsed.roomId]) byRoom[parsed.roomId] = {};
    byRoom[parsed.roomId][parsed.tierId] = `/images/boards/${slug}/${encodeURIComponent(name)}`;
  }
  return byRoom;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Swipe taste-board images — 30 curated design photos for Pinterest-style
//  swiping. Each has boolean tags used to compute the client's taste profile.
//  Served statically from portal/images/swipe/.
// ─────────────────────────────────────────────────────────────────────────────
const SWIPE_IMAGES = [
  // ── Materials (8) ──
  { id: 'swipe_01', label: 'Honed Carrara marble countertop',         imageUrl: '/images/swipe/swipe-01.png', tags: { naturalStone: true, quietSurface: true, brightAiry: true, lowContrast: true } },
  { id: 'swipe_02', label: 'Rich walnut wood grain',                  imageUrl: '/images/swipe/swipe-02.png', tags: { naturalWood: true, warmEarthy: true, lowContrast: true } },
  { id: 'swipe_03', label: 'Sage green zellige tile',                 imageUrl: '/images/swipe/swipe-03.png', tags: { handmadeTexture: true, warmEarthy: true, busyPattern: true } },
  { id: 'swipe_04', label: 'White quartz countertop',                 imageUrl: '/images/swipe/swipe-04.png', tags: { polishedSurface: true, quietSurface: true, brightAiry: true, crispNeutral: true } },
  { id: 'swipe_05', label: 'Soapstone countertop',                    imageUrl: '/images/swipe/swipe-05.png', tags: { naturalStone: true, moodyDark: true, quietSurface: true } },
  { id: 'swipe_06', label: 'Reclaimed wood ceiling beam',             imageUrl: '/images/swipe/swipe-06.png', tags: { naturalWood: true, handmadeTexture: true, warmEarthy: true } },
  { id: 'swipe_07', label: 'Book-matched marble slab',                imageUrl: '/images/swipe/swipe-07.png', tags: { naturalStone: true, busyPattern: true, highContrast: true } },
  { id: 'swipe_08', label: 'Hand-applied plaster wall',               imageUrl: '/images/swipe/swipe-08.png', tags: { handmadeTexture: true, quietSurface: true, warmEarthy: true, lowContrast: true } },

  // ── Metals & Hardware (6) ──
  { id: 'swipe_09', label: 'Unlacquered brass cup pulls',             imageUrl: '/images/swipe/swipe-09.png', tags: { warmMetal: true, quietSurface: true, brightAiry: true } },
  { id: 'swipe_10', label: 'Brushed nickel faucet',                   imageUrl: '/images/swipe/swipe-10.png', tags: { coolMetal: true, polishedSurface: true, crispNeutral: true } },
  { id: 'swipe_11', label: 'Matte black iron pendant',                imageUrl: '/images/swipe/swipe-11.png', tags: { blackMetal: true, highContrast: true } },
  { id: 'swipe_12', label: 'Polished chrome fixtures',                imageUrl: '/images/swipe/swipe-12.png', tags: { coolMetal: true, polishedSurface: true, crispNeutral: true } },
  { id: 'swipe_13', label: 'Oil-rubbed bronze hardware',              imageUrl: '/images/swipe/swipe-13.png', tags: { warmMetal: true, naturalWood: true, warmEarthy: true } },
  { id: 'swipe_14', label: 'Brushed gold rain shower head',           imageUrl: '/images/swipe/swipe-14.png', tags: { warmMetal: true, polishedSurface: true } },

  // ── Color Palettes / Room Moods (6) ──
  { id: 'swipe_15', label: 'Bright white kitchen',                    imageUrl: '/images/swipe/swipe-15.png', tags: { brightAiry: true, lowContrast: true, quietSurface: true } },
  { id: 'swipe_16', label: 'Deep green library',                      imageUrl: '/images/swipe/swipe-16.png', tags: { moodyDark: true, warmMetal: true, highContrast: true } },
  { id: 'swipe_17', label: 'Warm earthy living room',                 imageUrl: '/images/swipe/swipe-17.png', tags: { warmEarthy: true, naturalWood: true, lowContrast: true, handmadeTexture: true } },
  { id: 'swipe_18', label: 'Cool grey bathroom',                      imageUrl: '/images/swipe/swipe-18.png', tags: { crispNeutral: true, polishedSurface: true, lowContrast: true, quietSurface: true } },
  { id: 'swipe_19', label: 'Navy blue dining room',                   imageUrl: '/images/swipe/swipe-19.png', tags: { moodyDark: true, highContrast: true } },
  { id: 'swipe_20', label: 'Cream and warm wood kitchen',             imageUrl: '/images/swipe/swipe-20.png', tags: { brightAiry: true, warmEarthy: true, naturalWood: true, lowContrast: true } },

  // ── Patterns & Details (5) ──
  { id: 'swipe_21', label: 'Herringbone marble floor',                imageUrl: '/images/swipe/swipe-21.png', tags: { naturalStone: true, busyPattern: true, highContrast: true } },
  { id: 'swipe_22', label: 'White subway tile',                       imageUrl: '/images/swipe/swipe-22.png', tags: { quietSurface: true, brightAiry: true, lowContrast: true } },
  { id: 'swipe_23', label: 'Bold encaustic cement tile',              imageUrl: '/images/swipe/swipe-23.png', tags: { busyPattern: true, highContrast: true, handmadeTexture: true } },
  { id: 'swipe_24', label: 'Full-slab stone backsplash',              imageUrl: '/images/swipe/swipe-24.png', tags: { naturalStone: true, quietSurface: true, lowContrast: true } },
  { id: 'swipe_25', label: 'Waterjet marble mosaic',                  imageUrl: '/images/swipe/swipe-25.png', tags: { naturalStone: true, busyPattern: true, highContrast: true, polishedSurface: true } },

  // ── Architectural Details (5) ──
  { id: 'swipe_26', label: 'Sculptural plaster range hood',           imageUrl: '/images/swipe/swipe-26.png', tags: { handmadeTexture: true, quietSurface: true, warmEarthy: true } },
  { id: 'swipe_27', label: 'Coffered ceiling',                        imageUrl: '/images/swipe/swipe-27.png', tags: { highContrast: true, polishedSurface: true } },
  { id: 'swipe_28', label: 'Fluted stone fireplace',                  imageUrl: '/images/swipe/swipe-28.png', tags: { naturalStone: true, quietSurface: true, highContrast: true } },
  { id: 'swipe_29', label: 'Brass globe pendant cluster',             imageUrl: '/images/swipe/swipe-29.png', tags: { warmMetal: true, warmEarthy: true, lowContrast: true } },
  { id: 'swipe_30', label: 'Modern linear LED pendant',               imageUrl: '/images/swipe/swipe-30.png', tags: { coolMetal: true, crispNeutral: true, quietSurface: true, lowContrast: true } },
];

// Resolve board images for all styles.
// Returns: { 'Modern Farmhouse': { kitchen: { essential: url, ... }, ... }, ... }
// Supports both static files (static:slug) and Drive folders.
async function resolveBoardPhotos() {
  const apiKey = GS_KEY();
  const result = {};

  await Promise.all(STYLE_NAMES.map(async (style) => {
    const folderUrl = BOARD_FOLDERS[style];
    if (!folderUrl) return; // not available yet

    // Static images (served from portal/images/boards/)
    if (folderUrl.startsWith('static:')) {
      const slug = folderUrl.replace('static:', '');
      const byRoom = resolveStaticBoardPhotos(slug);
      if (Object.keys(byRoom).length) result[style] = byRoom;
      return;
    }

    // Drive-hosted images
    if (!apiKey) return;
    const folderId = extractFolderId(folderUrl);
    if (!folderId) return;

    try {
      const photos = await listFolderImages(folderId, apiKey);
      const byRoom = {};
      for (const photo of photos) {
        const parsed = parseBoardFilename(photo.name);
        if (!parsed) continue;
        if (!byRoom[parsed.roomId]) byRoom[parsed.roomId] = {};
        byRoom[parsed.roomId][parsed.tierId] = photo.thumbUrl;
      }
      if (Object.keys(byRoom).length) result[style] = byRoom;
    } catch (err) {
      console.warn(`Board photos for ${style}: ${err.message}`);
    }
  }));
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Merge defaults + overrides
// ─────────────────────────────────────────────────────────────────────────────

function mergeCatalog(overrides) {
  const quiz     = Array.isArray(overrides.quiz) && overrides.quiz.length ? overrides.quiz : DEFAULT_QUIZ;
  const products = (overrides.products && typeof overrides.products === 'object')
    ? mergeProducts(DEFAULT_PRODUCTS, overrides.products)
    : DEFAULT_PRODUCTS;
  return { quiz, styles: STYLE_PROFILES, styleNames: STYLE_NAMES, products, swipeImages: SWIPE_IMAGES };
}

function mergeProducts(defaults, override) {
  const out = {};
  for (const style of STYLE_NAMES) {
    out[style] = { ...(defaults[style] || {}), ...(override[style] || {}) };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Handler
// ─────────────────────────────────────────────────────────────────────────────

function json(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function checkAdmin(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === ADMIN_PASSWORD();
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (!SB_URL() || !SB_KEY()) {
    return json(503, { error: 'Catalog not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing)' });
  }

  const params = event.queryStringParameters || {};

  // ── GET ─────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const overrides = await loadOverrides();
      let catalog = mergeCatalog(overrides);

      if (params.withPhotos === '1') {
        const [quizWithPhotos, boardImages] = await Promise.all([
          resolveQuizPhotos(catalog.quiz),
          resolveBoardPhotos(),
        ]);
        catalog = { ...catalog, quiz: quizWithPhotos, boardImages };
      }

      if (params.style) {
        const style = decodeURIComponent(params.style);
        if (!STYLE_PROFILES[style]) return json(404, { error: `Unknown style: ${style}` });
        return json(200, {
          style,
          profile:  STYLE_PROFILES[style],
          products: catalog.products[style] || {},
        });
      }

      return json(200, catalog);
    } catch (err) {
      console.error('style-catalog GET error:', err);
      return json(500, { error: err.message });
    }
  }

  // ── POST (admin) ────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    if (!checkAdmin(event)) return json(401, { error: 'Unauthorized' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return json(400, { error: 'Invalid JSON body' }); }

    const writes = [];
    if (body.quiz !== undefined) {
      if (!Array.isArray(body.quiz)) return json(400, { error: 'quiz must be an array' });
      writes.push(saveSuffix('quiz', body.quiz));
    }
    if (body.products !== undefined) {
      if (typeof body.products !== 'object' || Array.isArray(body.products)) {
        return json(400, { error: 'products must be an object keyed by style' });
      }
      writes.push(saveSuffix('products', body.products));
    }

    if (!writes.length) return json(400, { error: 'Provide at least one of: quiz, products' });

    try {
      await Promise.all(writes);
      const overrides = await loadOverrides();
      return json(200, { success: true, catalog: mergeCatalog(overrides) });
    } catch (err) {
      console.error('style-catalog POST error:', err);
      return json(500, { error: err.message });
    }
  }

  // ── DELETE (admin reset) ────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    if (!checkAdmin(event)) return json(401, { error: 'Unauthorized' });
    const suffix = params.suffix;
    if (!ALLOWED_SUFFIXES.has(suffix)) {
      return json(400, { error: `suffix must be one of: ${[...ALLOWED_SUFFIXES].join(', ')}` });
    }
    try {
      await deleteSuffix(suffix);
      return json(200, { success: true, reset: suffix });
    } catch (err) {
      return json(500, { error: err.message });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
