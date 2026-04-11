// scripts/flux/prompts/quiz.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Quiz Q7–Q12 prompt library for FLUX batch generation.
//
//  These six questions extend the existing Q1–Q6 quiz to give Fox enough
//  fingerprint data to design a full room. Each question has 4 options
//  whose filename lines up alphabetically with the A/B/C/D order the
//  Fox quiz UI expects (photos[0]→A, photos[1]→B, etc).
//
//  All prompts share a base "SHOT" preamble so the 24 images feel like
//  they came from the same photo shoot — same camera, same light, same
//  editorial tone. That consistency is what makes the quiz feel curated
//  rather than stock.
//
//  To add / tweak a question: duplicate an entry, swap folder + options,
//  re-run `node scripts/flux/generate.mjs quiz --only <id> --force`.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared style preamble ────────────────────────────────────────────────────
// Applied to every quiz image. Locks the "look" of the shoot.
//
// IMPORTANT: do NOT add "shallow depth of field" here — FLUX will interpret
// that as "soft background" and blur half the frame. We want deep focus,
// everything tack-sharp, for editorial product-reference shots.
//
// FLUX tends to place cabinet hardware wherever looks balanced in the
// render rather than where a real installer would put it; the preamble
// explicitly calls for accurate hardware placement and every cabinet
// scene repeats the instruction because FLUX needs the reminder.
const SHOT = [
  'professional interior design magazine photograph',
  'Architectural Digest editorial style',
  'soft natural daylight from a nearby window',
  'warm cream and neutral palette',
  'hyperrealistic, tack-sharp focus throughout, deep depth of field',
  'shot on medium format camera',
  'realistic materials and natural textures with subtle imperfections',
  'accurate hardware placement matching how professional installers mount it',
  'clean editorial framing, no people, no text, no watermarks',
  'cinematic color grading, photoreal, not CGI',
].join(', ');

// Wrap a scene description in the shared shot preamble.
const P = (scene) => `${SHOT}, ${scene}`;

// Helper: turn an array of {letter, filename, scene} into JOBS entries
// with a consistent id prefix and folder.
function buildQuestion(id, folder, options) {
  return options.map(opt => ({
    id:      `${id}:${opt.letter}`,
    relPath: `${folder}/${opt.filename}`,
    prompt:  P(opt.scene),
    aspectRatio: '4:3',
  }));
}

// ── Q7 · Cabinet Style ───────────────────────────────────────────────────────
// Folder: "Q7 — Cabinet Style"
// Alphabetical filenames → A, B, C, D:
//   Flat-front white oak.png
//   Fluted walnut.png
//   Inset beaded deep green.png
//   Shaker white.png
const Q7 = buildQuestion('q7_cabinets', 'Q7 — Cabinet Style', [
  {
    letter: 'A',
    filename: 'Flat-front white oak.png',
    scene:
      'editorial cabinet detail photograph showing a section of a modern ' +
      'kitchen, two upper drawer fronts and two base cabinet doors visible, ' +
      'flat-front rift-sawn white oak cabinets with no visible hardware and ' +
      'finger-pull edges, the wood grain lines running horizontally left to ' +
      'right across each door and drawer face (grain perpendicular to the ' +
      'vertical cabinet edges), wide plank grain pattern with natural color ' +
      'variation, a honed quartzite countertop spanning the top of the ' +
      'frame, a hint of cream plaster wall above, no appliances visible, ' +
      'minimal architectural clean modern style, soft morning light raking ' +
      'across the horizontal wood grain',
  },
  {
    letter: 'B',
    filename: 'Fluted walnut.png',
    scene:
      'tightly cropped macro detail photograph of a walnut island base ' +
      'filling the entire frame, vertical fluted walnut cabinet fronts with ' +
      'brushed gold hardware, warm rich natural wood tones with visible ' +
      'grain and subtle imperfections, matte walnut finish not glossy, ' +
      'a sliver of book-matched marble countertop visible at the top edge, ' +
      'no appliances visible, warm luxury style, soft directional lighting ' +
      'emphasizing the fluting shadows',
  },
  {
    letter: 'C',
    filename: 'Inset beaded deep green.png',
    scene:
      'editorial cabinet detail photograph showing a section of a kitchen, ' +
      'a row of base cabinets and one upper cabinet visible (not a wall of ' +
      'all cabinets), inset beaded-frame cabinet doors and drawer fronts ' +
      'painted a deep forest green, unlacquered brass cup pulls mounted ' +
      'centered at the top edge of each drawer front and unlacquered brass ' +
      'knobs mounted at the upper corner of each base cabinet door closest ' +
      'to the countertop, a honed Calacatta marble countertop spanning the ' +
      'top of the frame, a small styled detail on the counter like a wooden ' +
      'cutting board or ceramic crock, cream plaster wall visible above the ' +
      'cabinets showing these cabinets are one section of a larger kitchen, ' +
      'no fridge visible, modern traditional heritage style with ' +
      'architectural detail, soft diffused window light',
  },
  {
    letter: 'D',
    filename: 'Shaker white.png',
    scene:
      'editorial cabinet detail photograph showing a section of a kitchen, ' +
      'a row of white shaker base cabinets with two door fronts and one ' +
      'drawer visible, crisp painted white woodwork, matte black cup pulls ' +
      'mounted centered at the top edge of the drawer front and matte ' +
      'black knobs mounted at the upper corner of each base cabinet door ' +
      'closest to the countertop, a white quartz countertop spanning the ' +
      'top of the frame, a simple white subway tile backsplash visible ' +
      'above the counter, a small styled detail on the counter like a ' +
      'wooden cutting board, no appliances visible, modern farmhouse style, ' +
      'clean natural daylight',
  },
]);

// ── Q8 · Backsplash Feel ─────────────────────────────────────────────────────
// Folder: "Q8 — Backsplash Feel"
// Alphabetical:
//   Handmade zellige.png
//   Marble mosaic.png
//   Slab stone.png
//   Subway tile.png
const Q8 = buildQuestion('q8_backsplash', 'Q8 — Backsplash Feel', [
  {
    letter: 'A',
    filename: 'Handmade zellige.png',
    scene:
      'close-up view of a kitchen backsplash of handmade zellige tiles ' +
      'in a warm creamy white with subtle color variation and uneven ' +
      'glazed surfaces, showing the irregular handcrafted edges, ' +
      'unlacquered brass wall sconce at upper edge, organic modern style, ' +
      'soft natural light revealing the tile texture',
  },
  {
    letter: 'B',
    filename: 'Marble mosaic.png',
    scene:
      'close-up view of a kitchen backsplash of honed Calacatta marble ' +
      'mosaic in a basketweave pattern with soft grey veining, set in ' +
      'narrow grey grout, a brushed gold pot filler faintly visible at ' +
      'the edge, modern traditional style with heritage detail, soft ' +
      'window light',
  },
  {
    letter: 'C',
    filename: 'Slab stone.png',
    scene:
      'close-up view of a clean modern kitchen backsplash, ' +
      'a single continuous slab of honed quartzite with dramatic natural ' +
      'grey and taupe movement, no grout lines, running floor to ceiling ' +
      'behind a flush range, architectural clean modern style, ' +
      'soft diffused daylight',
  },
  {
    letter: 'D',
    filename: 'Subway tile.png',
    scene:
      'close-up view of a kitchen backsplash of classic 3x12 white subway ' +
      'tile in a stacked bond pattern with crisp light grey grout, ' +
      'a white shaker cabinet and matte black hardware visible at the edges, ' +
      'transitional modern farmhouse style, bright morning daylight',
  },
]);

// ── Q9 · Color Mood ──────────────────────────────────────────────────────────
// Folder: "Q9 — Color Mood"
// Alphabetical:
//   Bright and airy.png
//   Crisp neutral.png
//   Moody and rich.png
//   Warm and earthy.png
const Q9 = buildQuestion('q9_color_mood', 'Q9 — Color Mood', [
  {
    letter: 'A',
    filename: 'Bright and airy.png',
    scene:
      'wide interior shot of a bright airy living room corner, ' +
      'warm white walls, soft cream upholstery, light oak floors, ' +
      'white linen drapery, a sun-drenched window throwing long shafts of ' +
      'morning light across the room, transitional modern farmhouse style, ' +
      'fresh clean uplifting mood',
  },
  {
    letter: 'B',
    filename: 'Crisp neutral.png',
    scene:
      'wide interior shot of a crisp neutral living room corner, ' +
      'soft white walls, pale grey upholstery, light wide-plank oak floors, ' +
      'minimal architectural trim, clean modern style, even diffused ' +
      'overcast daylight, quiet precise mood',
  },
  {
    letter: 'C',
    filename: 'Moody and rich.png',
    scene:
      'wide interior shot of a moody richly-colored living room corner, ' +
      'deep forest green painted walls with a darker wainscot, oxblood ' +
      'leather armchair, brass picture lights over a built-in bookcase, ' +
      'dark walnut herringbone floors, warm low lamplight in early evening, ' +
      'modern traditional heritage mood',
  },
  {
    letter: 'D',
    filename: 'Warm and earthy.png',
    scene:
      'wide interior shot of a warm earthy living room corner, ' +
      'plaster walls in a soft clay tone, rift-sawn white oak built-ins, ' +
      'a curved arch doorway, natural linen upholstery, aged terracotta ' +
      'accents, organic modern style, soft golden afternoon light, ' +
      'grounded tactile artisanal mood',
  },
]);

// ── Q10 · Wood Tone ──────────────────────────────────────────────────────────
// Folder: "Q10 — Wood Tone"
// Alphabetical:
//   Dark espresso walnut.png
//   Light white oak.png
//   Medium natural oak.png
//   Warm walnut honey.png
const Q10 = buildQuestion('q10_wood_tone', 'Q10 — Wood Tone', [
  {
    letter: 'A',
    filename: 'Dark espresso walnut.png',
    scene:
      'close-up angled view of a section of dark espresso walnut wide-plank ' +
      'flooring, rich nearly-black tones with subtle chocolate grain, ' +
      'a corner of a cream upholstered chair resting on the floor, warm ' +
      'low evening light casting soft shadows, modern traditional style',
  },
  {
    letter: 'B',
    filename: 'Light white oak.png',
    scene:
      'close-up angled view of a section of wide-plank white oak flooring ' +
      'in a soft warm light finish, visible subtle grain, wire-brushed ' +
      'texture, a corner of a linen upholstered chair on the floor, bright ' +
      'morning daylight, modern farmhouse organic modern style',
  },
  {
    letter: 'C',
    filename: 'Medium natural oak.png',
    scene:
      'close-up angled view of a section of wide-plank natural oak flooring ' +
      'in a warm medium honey tone, visible grain and subtle character knots, ' +
      'a corner of an upholstered chair on the floor, soft afternoon daylight, ' +
      'transitional modern style',
  },
  {
    letter: 'D',
    filename: 'Warm walnut honey.png',
    scene:
      'close-up angled view of a section of rich warm walnut herringbone ' +
      'flooring with honey-amber tones and visible figured grain, a corner ' +
      'of a leather armchair on the floor, warm directional lamplight, ' +
      'warm luxury modern traditional style',
  },
]);

// ── Q11 · Lighting Signature ─────────────────────────────────────────────────
// Folder: "Q11 — Lighting Signature"
// Alphabetical:
//   Barn lantern pendant.png
//   Brushed brass globe.png
//   Picture-light sconce.png
//   Sculptural chandelier.png
const Q11 = buildQuestion('q11_lighting', 'Q11 — Lighting Signature', [
  {
    letter: 'A',
    filename: 'Barn lantern pendant.png',
    scene:
      'hero shot of a matte black barn-style lantern pendant light hanging ' +
      'over a kitchen island, clear glass panels and visible bulb, warm ' +
      'white oak beam ceiling above, modern farmhouse style, soft ' +
      'natural daylight mixed with warm lamp glow',
  },
  {
    letter: 'B',
    filename: 'Brushed brass globe.png',
    scene:
      'hero shot of a simple brushed brass globe pendant light, opal glass ' +
      'shade, warm glow, hanging in a transitional kitchen with a pale grey ' +
      'painted ceiling and soft neutral walls in the background, clean ' +
      'editorial framing, soft daylight',
  },
  {
    letter: 'C',
    filename: 'Picture-light sconce.png',
    scene:
      'hero shot of an unlacquered brass articulated picture-light sconce ' +
      'mounted above a framed vintage botanical print on a deep green ' +
      'painted wall, library built-ins faintly visible in the background, ' +
      'modern traditional heritage style, warm evening lamplight mood',
  },
  {
    letter: 'D',
    filename: 'Sculptural chandelier.png',
    scene:
      'hero shot of a large sculptural statement chandelier with hand-blown ' +
      'glass orbs and warm brushed gold arms, hanging over a dining space, ' +
      'book-matched marble wall faintly visible behind, warm luxury style, ' +
      'dramatic golden hour light',
  },
]);

// ── Q12 · Signature Accent Move ──────────────────────────────────────────────
// Folder: "Q12 — Signature Move"
// Alphabetical:
//   Built-in paneled library.png
//   Curved plaster arch.png
//   Exposed ceiling beams.png
//   Waterfall island.png
const Q12 = buildQuestion('q12_signature', 'Q12 — Signature Move', [
  {
    letter: 'A',
    filename: 'Built-in paneled library.png',
    scene:
      'wide interior shot of a built-in paneled library wall with deep ' +
      'bookcases painted a rich forest green, brass picture lights above ' +
      'each shelf, a leather wingback chair in the foreground, modern ' +
      'traditional heritage style, warm evening lamplight mood',
  },
  {
    letter: 'B',
    filename: 'Curved plaster arch.png',
    scene:
      'wide interior shot of a curved plaster arch doorway in a soft clay ' +
      'tone, dividing two warm earthy rooms, rift-sawn white oak floors ' +
      'running through, minimal furniture, organic modern style, soft ' +
      'golden afternoon light',
  },
  {
    letter: 'C',
    filename: 'Exposed ceiling beams.png',
    scene:
      'wide interior shot of a great room with exposed rough-hewn wood ' +
      'ceiling beams crossing a vaulted ceiling, shiplap accent wall, warm ' +
      'white oak floors, a stone fireplace faintly visible, modern ' +
      'farmhouse style, bright morning daylight streaming through tall windows',
  },
  {
    letter: 'D',
    filename: 'Waterfall island.png',
    scene:
      'wide interior shot of a clean modern kitchen featuring a waterfall ' +
      'island in book-matched white and grey marble, the stone continuing ' +
      'down both ends to the floor, flat-front walnut cabinetry behind, ' +
      'architectural clean modern style, crisp even daylight',
  },
]);

// ── Export ──────────────────────────────────────────────────────────────────
export const JOBS = [
  ...Q7, ...Q8, ...Q9, ...Q10, ...Q11, ...Q12,
];
