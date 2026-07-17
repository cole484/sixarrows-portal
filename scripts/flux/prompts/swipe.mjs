// scripts/flux/prompts/swipe.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Swipe taste-board prompt library — 30 images for Pinterest-style swiping.
//
//  These images help a designer learn a client's preferences for materials,
//  metals, colors, patterns, and design details. The client swipes yes/no on
//  each image, and the boolean tags on each job are used to compute their
//  taste profile from the results.
//
//  Structure:
//    output/swipe/swipe-{nn}.png   (flat directory, 30 images)
//
//  To regenerate one image:
//    node scripts/flux/generate.mjs swipe --only "swipe_14" --force
//
//  To regenerate all swipe images:
//    node scripts/flux/generate.mjs swipe --force
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared style preamble ────────────────────────────────────────────────────
// Same editorial photography style as quiz images — keeps the whole app
// feeling like one curated photo shoot.
const SHOT = [
  'professional interior design photography',
  'editorial style',
  'soft natural light',
  'hyperrealistic materials',
  'no text no watermarks no people',
  'shot on medium format camera',
].join(', ');

const P = (scene) => `${SHOT}, ${scene}`;

// ── Tag keys reference ──────────────────────────────────────────────────────
// warmMetal, coolMetal, blackMetal,
// naturalStone, naturalWood, handmadeTexture, polishedSurface,
// busyPattern, quietSurface,
// brightAiry, warmEarthy, moodyDark, crispNeutral,
// highContrast, lowContrast

// ── Materials (8 images) ────────────────────────────────────────────────────

const MATERIALS = [
  {
    id: 'swipe_01',
    relPath: 'swipe-01.png',
    prompt: P(
      'close-up detail photograph of a honed Carrara marble countertop, ' +
      'subtle grey veining running diagonally across the creamy white surface, ' +
      'soft morning light raking across the stone revealing the gentle matte texture. ' +
      'A tiny section of white cabinetry visible at the edge for scale.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, quietSurface: true, brightAiry: true, lowContrast: true },
  },
  {
    id: 'swipe_02',
    relPath: 'swipe-02.png',
    prompt: P(
      'close-up macro photograph of rich walnut wood grain, oiled matte finish, ' +
      'warm chocolate and amber tones with visible cathedral grain pattern and ' +
      'subtle natural imperfections. Soft directional window light emphasizes ' +
      'the depth of the grain and the hand-rubbed oil finish.'
    ),
    aspectRatio: '4:3',
    tags: { naturalWood: true, warmEarthy: true, lowContrast: true },
  },
  {
    id: 'swipe_03',
    relPath: 'swipe-03.png',
    prompt: P(
      'close-up photograph of a zellige tile wall in sage green, handmade Moroccan ' +
      'tiles showing subtle color variation from tile to tile, uneven glazed ' +
      'surfaces catching the light differently, visible handcrafted irregular edges ' +
      'and slight undulation. Warm afternoon light revealing the artisanal texture.'
    ),
    aspectRatio: '4:3',
    tags: { handmadeTexture: true, warmEarthy: true, busyPattern: true },
  },
  {
    id: 'swipe_04',
    relPath: 'swipe-04.png',
    prompt: P(
      'close-up photograph of a white quartz countertop, perfectly uniform clean ' +
      'surface with a soft polished sheen, crisp and contemporary. Bright even ' +
      'daylight showing the flawless consistency of the engineered stone, a sliver ' +
      'of white cabinetry visible at the lower edge.'
    ),
    aspectRatio: '4:3',
    tags: { polishedSurface: true, quietSurface: true, brightAiry: true, crispNeutral: true },
  },
  {
    id: 'swipe_05',
    relPath: 'swipe-05.png',
    prompt: P(
      'close-up photograph of a soapstone countertop, matte dark charcoal surface ' +
      'with subtle lighter mineral veins, the stone showing a velvety honed finish ' +
      'that absorbs light rather than reflecting it. Moody diffused light from a ' +
      'nearby window casting soft shadows across the dense natural stone.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, moodyDark: true, quietSurface: true },
  },
  {
    id: 'swipe_06',
    relPath: 'swipe-06.png',
    prompt: P(
      'close-up photograph of a reclaimed wood ceiling beam, aged grey and honey ' +
      'patina with visible saw marks, nail holes, and weathered character from ' +
      'decades of use. Warm golden afternoon light catching the textured surface ' +
      'and highlighting the authentic imperfections of the salvaged timber.'
    ),
    aspectRatio: '4:3',
    tags: { naturalWood: true, handmadeTexture: true, warmEarthy: true },
  },
  {
    id: 'swipe_07',
    relPath: 'swipe-07.png',
    prompt: P(
      'close-up photograph of a book-matched marble slab wall, dramatic deep ' +
      'purple and plum veining mirrored symmetrically across the center seam, ' +
      'creating a bold butterfly pattern against a creamy white ground. Even ' +
      'gallery lighting emphasizing the high-contrast mineral drama of the stone.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, busyPattern: true, highContrast: true },
  },
  {
    id: 'swipe_08',
    relPath: 'swipe-08.png',
    prompt: P(
      'close-up photograph of a smooth hand-applied plaster wall in warm white, ' +
      'subtle trowel marks and gentle undulation visible in raking light, ' +
      'creating a soft organic texture that feels handcrafted and timeless. ' +
      'Soft diffused natural light revealing the delicate surface imperfections.'
    ),
    aspectRatio: '4:3',
    tags: { handmadeTexture: true, quietSurface: true, warmEarthy: true, lowContrast: true },
  },
];

// ── Metals & Hardware (6 images) ────────────────────────────────────────────

const METALS = [
  {
    id: 'swipe_09',
    relPath: 'swipe-09.png',
    prompt: P(
      'detail photograph of unlacquered brass cabinet cup pulls mounted on white ' +
      'shaker cabinet doors, the brass showing a warm living patina with golden ' +
      'tones, two pulls visible on adjacent drawers. Bright airy kitchen setting ' +
      'with soft morning daylight illuminating the warm metal against crisp white paint.'
    ),
    aspectRatio: '4:3',
    tags: { warmMetal: true, quietSurface: true, brightAiry: true },
  },
  {
    id: 'swipe_10',
    relPath: 'swipe-10.png',
    prompt: P(
      'detail photograph of a brushed nickel single-handle kitchen faucet with ' +
      'clean modern lines and a high-arc spout, the brushed finish showing soft ' +
      'muted reflections. Crisp neutral background with white quartz countertop ' +
      'and even daylight highlighting the precise machined metal surface.'
    ),
    aspectRatio: '4:3',
    tags: { coolMetal: true, polishedSurface: true, crispNeutral: true },
  },
  {
    id: 'swipe_11',
    relPath: 'swipe-11.png',
    prompt: P(
      'detail photograph of a matte black iron pendant light with a simple dome ' +
      'shade, suspended from a dark cord against a bright white ceiling. ' +
      'The flat black finish absorbs light completely, creating a bold graphic ' +
      'silhouette. High-contrast editorial lighting, minimal composition.'
    ),
    aspectRatio: '4:3',
    tags: { blackMetal: true, highContrast: true },
  },
  {
    id: 'swipe_12',
    relPath: 'swipe-12.png',
    prompt: P(
      'detail photograph of polished chrome bathroom fixtures — a wall-mounted ' +
      'faucet and matching cross-handle valves on a white marble vanity backsplash. ' +
      'Mirror-like chrome surfaces catching crisp reflections of the bright ' +
      'bathroom. Clean even daylight, precise minimal composition.'
    ),
    aspectRatio: '4:3',
    tags: { coolMetal: true, polishedSurface: true, crispNeutral: true },
  },
  {
    id: 'swipe_13',
    relPath: 'swipe-13.png',
    prompt: P(
      'detail photograph of oil-rubbed bronze door hardware — a lever handle and ' +
      'matching deadbolt on a warm wood paneled door, the bronze showing a deep ' +
      'dark brown finish with subtle copper highlights at the edges where the ' +
      'patina has worn. Warm afternoon light, heritage architectural setting.'
    ),
    aspectRatio: '4:3',
    tags: { warmMetal: true, naturalWood: true, warmEarthy: true },
  },
  {
    id: 'swipe_14',
    relPath: 'swipe-14.png',
    prompt: P(
      'detail photograph of a brushed gold rain shower head, large round disc ' +
      'with fine perforations, warm satin gold finish catching soft bathroom light. ' +
      'Mounted on a ceiling arm against a clean white tile ceiling, water droplets ' +
      'visible on the polished metal surface. Luxurious spa atmosphere.'
    ),
    aspectRatio: '4:3',
    tags: { warmMetal: true, polishedSurface: true },
  },
];

// ── Color Palettes / Room Moods (6 images) ──────────────────────────────────

const COLOR_MOODS = [
  {
    id: 'swipe_15',
    relPath: 'swipe-15.png',
    prompt: P(
      'wide interior photograph of a bright white kitchen flooded with morning ' +
      'sunlight, creamy warm white walls and cabinets, light oak floors, sheer ' +
      'white linen curtains filtering golden light through tall windows. ' +
      'The entire space feels airy, uplifting, and luminous with soft shadows.'
    ),
    aspectRatio: '4:3',
    tags: { brightAiry: true, lowContrast: true, quietSurface: true },
  },
  {
    id: 'swipe_16',
    relPath: 'swipe-16.png',
    prompt: P(
      'interior photograph of a deep forest green library with floor-to-ceiling ' +
      'built-in bookcases, unlacquered brass picture-light sconces casting warm ' +
      'pools of lamplight across leather-bound books, a dark walnut reading desk ' +
      'in the foreground. Rich moody evening atmosphere with dramatic light and shadow.'
    ),
    aspectRatio: '4:3',
    tags: { moodyDark: true, warmMetal: true, highContrast: true },
  },
  {
    id: 'swipe_17',
    relPath: 'swipe-17.png',
    prompt: P(
      'interior photograph of a warm earthy living room with hand-plastered clay-toned ' +
      'walls, a low linen sofa with natural cotton cushions, a rift-sawn white oak ' +
      'coffee table, and a woven jute rug on wide-plank oak floors. Soft golden ' +
      'afternoon light streaming through an arched doorway, grounded artisanal mood.'
    ),
    aspectRatio: '4:3',
    tags: { warmEarthy: true, naturalWood: true, lowContrast: true, handmadeTexture: true },
  },
  {
    id: 'swipe_18',
    relPath: 'swipe-18.png',
    prompt: P(
      'interior photograph of a cool grey bathroom with soft white marble walls, ' +
      'pale grey painted vanity, polished chrome fixtures, and a frameless glass ' +
      'shower enclosure. Even overcast daylight diffusing through a frosted window, ' +
      'creating a quiet precise atmosphere with minimal decoration.'
    ),
    aspectRatio: '4:3',
    tags: { crispNeutral: true, polishedSurface: true, lowContrast: true, quietSurface: true },
  },
  {
    id: 'swipe_19',
    relPath: 'swipe-19.png',
    prompt: P(
      'interior photograph of a navy blue dining room with tall white wainscoting ' +
      'panels rising halfway up the wall, deep saturated navy paint above, a white ' +
      'ceiling with simple crown molding. A dining table with cream upholstered ' +
      'chairs visible in the foreground. Dramatic contrast between dark and light, ' +
      'architectural presence.'
    ),
    aspectRatio: '4:3',
    tags: { moodyDark: true, highContrast: true },
  },
  {
    id: 'swipe_20',
    relPath: 'swipe-20.png',
    prompt: P(
      'interior photograph of a cream and warm wood kitchen bathed in soft morning ' +
      'light, creamy white painted cabinets with natural white oak open shelving, ' +
      'light oak wide-plank floors, a warm wood cutting board and ceramic vase on ' +
      'the counter. Gentle warm tones throughout, inviting and serene atmosphere.'
    ),
    aspectRatio: '4:3',
    tags: { brightAiry: true, warmEarthy: true, naturalWood: true, lowContrast: true },
  },
];

// ── Patterns & Details (5 images) ───────────────────────────────────────────

const PATTERNS = [
  {
    id: 'swipe_21',
    relPath: 'swipe-21.png',
    prompt: P(
      'overhead photograph of a herringbone marble floor pattern, honed Carrara ' +
      'marble planks set in a classic herringbone layout with thin grey grout ' +
      'lines, the white marble showing subtle grey veining that creates visual ' +
      'rhythm across the geometric pattern. Even overhead daylight, clean editorial framing.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, busyPattern: true, highContrast: true },
  },
  {
    id: 'swipe_22',
    relPath: 'swipe-22.png',
    prompt: P(
      'close-up photograph of a simple white subway tile backsplash in classic ' +
      'running bond pattern, crisp white glossy ceramic tiles with light grey ' +
      'grout, clean uniform rows creating a calm repetitive rhythm. Bright ' +
      'morning light washing evenly across the familiar timeless tile pattern.'
    ),
    aspectRatio: '4:3',
    tags: { quietSurface: true, brightAiry: true, lowContrast: true },
  },
  {
    id: 'swipe_23',
    relPath: 'swipe-23.png',
    prompt: P(
      'overhead photograph of a bold encaustic cement tile floor with a geometric ' +
      'star-and-cross pattern in charcoal, terracotta, and cream, handmade tiles ' +
      'showing slight color variation and a chalky matte surface. Each tile ' +
      'interlocking to create a complex repeating medallion pattern, warm directional light.'
    ),
    aspectRatio: '4:3',
    tags: { busyPattern: true, highContrast: true, handmadeTexture: true },
  },
  {
    id: 'swipe_24',
    relPath: 'swipe-24.png',
    prompt: P(
      'close-up photograph of a full-slab natural stone backsplash behind a range, ' +
      'a single continuous piece of honed quartzite with soft grey and taupe ' +
      'movement, no grout lines visible, the uninterrupted stone surface creating ' +
      'a calm monolithic presence. Soft diffused daylight, clean minimal composition.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, quietSurface: true, lowContrast: true },
  },
  {
    id: 'swipe_25',
    relPath: 'swipe-25.png',
    prompt: P(
      'close-up photograph of a waterjet marble mosaic in an arabesque lantern ' +
      'pattern, polished Calacatta marble pieces with soft grey veining set in ' +
      'narrow grey grout, the intricate curved shapes creating an elegant ' +
      'decorative pattern. Even gallery lighting highlighting the polished stone ' +
      'surfaces and precise craftsmanship.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, busyPattern: true, highContrast: true, polishedSurface: true },
  },
];

// ── Architectural Details (5 images) ────────────────────────────────────────

const ARCHITECTURAL = [
  {
    id: 'swipe_26',
    relPath: 'swipe-26.png',
    prompt: P(
      'interior photograph of a sculptural plaster range hood with a smooth ' +
      'arched silhouette, hand-finished warm white plaster with subtle trowel ' +
      'texture, mounted above a professional range in an earthy organic kitchen. ' +
      'Soft afternoon light casting a gentle shadow beneath the curved form, ' +
      'artisanal handcrafted character.'
    ),
    aspectRatio: '4:3',
    tags: { handmadeTexture: true, quietSurface: true, warmEarthy: true },
  },
  {
    id: 'swipe_27',
    relPath: 'swipe-27.png',
    prompt: P(
      'upward-angled photograph of a coffered ceiling with deep recessed panels ' +
      'and crisp white crown molding, each coffer casting precise geometric ' +
      'shadows. Architectural detail showing traditional proportions and clean ' +
      'paint lines. Soft even daylight illuminating the dimensional relief ' +
      'of the millwork.'
    ),
    aspectRatio: '4:3',
    tags: { highContrast: true, polishedSurface: true },
  },
  {
    id: 'swipe_28',
    relPath: 'swipe-28.png',
    prompt: P(
      'interior photograph of a floor-to-ceiling fluted natural stone fireplace ' +
      'surround, tall vertical channels carved into honed limestone creating a ' +
      'rhythmic pattern of light and shadow, a simple linear firebox at the base. ' +
      'The stone rising dramatically to the ceiling, warm directional light ' +
      'emphasizing the sculptural fluting.'
    ),
    aspectRatio: '4:3',
    tags: { naturalStone: true, quietSurface: true, highContrast: true },
  },
  {
    id: 'swipe_29',
    relPath: 'swipe-29.png',
    prompt: P(
      'interior photograph of a warm pendant cluster of three brass globe lights ' +
      'hanging at staggered heights over a kitchen island, brushed brass finish ' +
      'with opal glass shades casting soft warm pools of light on the countertop ' +
      'below. Warm earthy kitchen setting with wood and stone, intimate evening ' +
      'atmosphere.'
    ),
    aspectRatio: '4:3',
    tags: { warmMetal: true, warmEarthy: true, lowContrast: true },
  },
  {
    id: 'swipe_30',
    relPath: 'swipe-30.png',
    prompt: P(
      'interior photograph of a modern linear LED pendant light suspended over ' +
      'a dining table, a slim brushed aluminum bar with integrated LED strip ' +
      'casting clean even downlight, minimal and precise in form. Cool grey ' +
      'and white dining space with soft overcast daylight, quiet contemporary ' +
      'atmosphere.'
    ),
    aspectRatio: '4:3',
    tags: { coolMetal: true, crispNeutral: true, quietSurface: true, lowContrast: true },
  },
];

// ── Export ──────────────────────────────────────────────────────────────────
export const JOBS = [
  ...MATERIALS,
  ...METALS,
  ...COLOR_MOODS,
  ...PATTERNS,
  ...ARCHITECTURAL,
];
