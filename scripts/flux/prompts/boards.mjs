// scripts/flux/prompts/boards.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Design board prompt library — 6 styles × 4 rooms × 3 tiers = 72 images.
//
//  Each image is a full-room editorial photograph showing a complete design
//  vision for one room, in one style, at one budget tier. The tier drives
//  material quality and "wow factor" — Essential is smart and clean,
//  Elevated is designer-level, Showpiece is magazine-cover.
//
//  Structure:
//    output/boards/<Style>/<Room> — <Tier>.png
//    e.g. "Modern Farmhouse/Kitchen — Essential.png"
//
//  To regenerate one board:
//    node scripts/flux/generate.mjs boards --only "modern_farmhouse:kitchen:essential" --force
//
//  To regenerate all boards for one style:
//    node scripts/flux/generate.mjs boards --style "Modern Farmhouse"
//
//  To regenerate all boards for one room:
//    node scripts/flux/generate.mjs boards --room kitchen
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared preamble ─────────────────────────────────────────────────────────
const SHOT = [
  'professional interior design magazine photograph',
  'Architectural Digest editorial style, wide-angle room shot',
  'soft natural daylight from large windows',
  'hyperrealistic, tack-sharp focus throughout, deep depth of field',
  'shot on medium format camera',
  'realistic materials and natural textures with subtle imperfections',
  'accurate hardware and fixture placement',
  'beautifully styled with curated decor accessories',
  'clean editorial framing, no people, no text, no watermarks',
  'cinematic color grading, photoreal, not CGI',
].join(', ');

const P = (scene) => `${SHOT}, ${scene}`;

// ── Style definitions ───────────────────────────────────────────────────────
// Each style has a palette, material language, and mood that stays consistent
// across all rooms and tiers.

const STYLES = {
  modern_farmhouse: {
    name: 'Modern Farmhouse',
    palette: 'warm white walls, matte black hardware, natural wood accents, cream and linen tones',
    mood: 'modern farmhouse style, fresh inviting warm rustic charm with clean contemporary lines',
    materials: {
      cabinet: 'white shaker cabinets with matte black cup pulls',
      wood: 'reclaimed or wire-brushed white oak',
      metal: 'matte black iron and blackened steel',
      textile: 'natural linen, cotton, jute',
      stone: 'honed white quartz or marble',
      accent: 'shiplap accent wall, barn-style elements',
    },
  },
  transitional: {
    name: 'Transitional',
    palette: 'soft grey and warm white walls, brushed nickel accents, pale oak tones',
    mood: 'transitional style, clean timeless elegance balancing traditional proportions with modern simplicity',
    materials: {
      cabinet: 'soft grey painted shaker cabinets with brushed nickel pulls',
      wood: 'light natural oak with a satin finish',
      metal: 'brushed nickel and polished chrome',
      textile: 'tailored linen and soft wool',
      stone: 'honed Carrara marble or soft grey quartz',
      accent: 'subtle paneled wainscoting, clean crown molding',
    },
  },
  modern_traditional: {
    name: 'Modern Traditional',
    palette: 'rich deep green or navy walls, unlacquered brass hardware, warm walnut wood, cream trim',
    mood: 'modern traditional heritage style, architectural gravitas with curated collected character',
    materials: {
      cabinet: 'inset beaded-frame cabinets in deep forest green or navy with brass knobs',
      wood: 'rich walnut with a warm satin finish',
      metal: 'unlacquered brass and aged bronze',
      textile: 'velvet, leather, heavy linen',
      stone: 'honed Calacatta marble with bold veining',
      accent: 'paneled library walls, picture rail molding, built-in bookcases',
    },
  },
  organic_modern: {
    name: 'Organic Modern',
    palette: 'soft clay and warm plaster walls, natural cream tones, terracotta and sage accents',
    mood: 'organic modern style, warm grounded tactile with handcrafted artisanal character',
    materials: {
      cabinet: 'flat-front rift-sawn white oak cabinets with integrated pulls',
      wood: 'rift-sawn white oak in a natural matte finish',
      metal: 'brushed brass and blackened iron',
      textile: 'raw linen, bouclé, woven jute',
      stone: 'limewashed plaster, honed travertine, natural limestone',
      accent: 'curved plaster arches, handmade tile, organic sculptural forms',
    },
  },
  clean_modern: {
    name: 'Clean Modern',
    palette: 'crisp white and warm grey walls, matte black and concrete accents, minimal color',
    mood: 'clean modern architectural style, precise minimal with intentional negative space',
    materials: {
      cabinet: 'flat-front matte lacquer cabinets in warm grey with finger-pull edges',
      wood: 'bleached or cerused oak with an ultra-matte finish',
      metal: 'matte black steel and brushed stainless',
      textile: 'structured linen, cashmere, fine merino',
      stone: 'honed quartzite slab, poured concrete, terrazzo',
      accent: 'floor-to-ceiling glazing, cantilevered elements, flush detailing',
    },
  },
  warm_luxury: {
    name: 'Warm Luxury',
    palette: 'warm taupe and champagne walls, brushed gold hardware, deep jewel tone accents',
    mood: 'warm luxury style, rich layered opulent with a sense of tailored intimacy',
    materials: {
      cabinet: 'fluted walnut cabinets with brushed gold hardware',
      wood: 'rich walnut and figured oak with a hand-rubbed finish',
      metal: 'brushed gold and champagne bronze',
      textile: 'silk, mohair velvet, cashmere, embroidered linen',
      stone: 'book-matched marble, onyx, natural quartzite',
      accent: 'coffered ceilings, custom millwork, statement chandeliers',
    },
  },
};

// ── Room × Tier scene templates ─────────────────────────────────────────────
// Each function takes a style object and returns the scene description.
// The tier drives the level of material, finish, and detail.

const ROOMS = {
  kitchen: {
    name: 'Kitchen',
    scenes: {
      essential: (s) =>
        `wide editorial photograph of a complete kitchen, ` +
        `${s.materials.cabinet}, ${s.materials.stone} countertops, ` +
        `simple ceramic tile backsplash in a neutral tone, ` +
        `stainless steel appliances, a pendant light over the island, ` +
        `${s.materials.wood} flooring, ` +
        `${s.palette}, ${s.mood}, ` +
        `clean and well-designed but approachable, quality builder-grade finishes ` +
        `that look beautiful without the splurge`,

      elevated: (s) =>
        `wide editorial photograph of a beautifully designed kitchen, ` +
        `${s.materials.cabinet}, ${s.materials.stone} countertops with ` +
        `waterfall edge on the island, designer tile backsplash with ` +
        `texture and dimension, upgraded stainless appliances with ` +
        `panel-ready refrigerator, two coordinated pendant lights over the island, ` +
        `${s.materials.wood} flooring in a herringbone or wide-plank pattern, ` +
        `${s.materials.accent}, ` +
        `${s.palette}, ${s.mood}, ` +
        `a clear step up in materials and thoughtful designer-level details`,

      showpiece: (s) =>
        `wide editorial photograph of a stunning magazine-worthy kitchen, ` +
        `${s.materials.cabinet}, ${s.materials.stone} countertops with ` +
        `book-matched waterfall island, statement backsplash in ${s.materials.stone}, ` +
        `professional-grade range with custom hood, panel-integrated appliances, ` +
        `a dramatic statement pendant or chandelier over the island, ` +
        `${s.materials.wood} flooring in an intricate pattern, ` +
        `${s.materials.accent}, custom open shelving with curated display, ` +
        `${s.palette}, ${s.mood}, ` +
        `heirloom-quality materials and statement details, the kitchen ` +
        `guests will not stop talking about`,
    },
  },

  primary_bath: {
    name: 'Primary Bath',
    scenes: {
      essential: (s) =>
        `wide editorial photograph of a complete primary bathroom, ` +
        `a clean vanity with ${s.materials.stone} countertop and ` +
        `undermount sinks, large-format porcelain floor tile in a neutral tone, ` +
        `simple framed mirrors, ${s.materials.metal} fixtures and faucets, ` +
        `a glass-enclosed walk-in shower with clean subway tile, ` +
        `${s.palette}, ${s.mood}, ` +
        `clean and well-designed but approachable, quality finishes ` +
        `that feel fresh and comfortable`,

      elevated: (s) =>
        `wide editorial photograph of a beautifully designed primary bathroom, ` +
        `a custom floating vanity in ${s.materials.wood} with ${s.materials.stone} ` +
        `countertop, designer wall-mounted faucets in ${s.materials.metal}, ` +
        `a freestanding soaking tub beside a large window, ` +
        `floor-to-ceiling tile in the shower with a niche and bench, ` +
        `accent tile feature wall behind the tub, ` +
        `${s.palette}, ${s.mood}, ` +
        `designer-level materials with moments of real luxury`,

      showpiece: (s) =>
        `wide editorial photograph of a stunning spa-like primary bathroom, ` +
        `a bespoke double vanity in ${s.materials.wood} with ${s.materials.stone} ` +
        `countertop and integrated vessel sinks, ` +
        `a sculptural freestanding tub as the centerpiece beneath a statement ` +
        `chandelier or pendant, floor-to-ceiling natural stone throughout, ` +
        `frameless glass shower with rain head and body jets, ` +
        `heated ${s.materials.wood} flooring, ${s.materials.accent}, ` +
        `${s.palette}, ${s.mood}, ` +
        `heirloom-quality materials, a private retreat that feels like ` +
        `a five-star hotel spa`,
    },
  },

  living_room: {
    name: 'Living Room',
    scenes: {
      essential: (s) =>
        `wide editorial photograph of a complete living room, ` +
        `clean painted walls in ${s.palette}, ${s.materials.wood} flooring, ` +
        `a comfortable upholstered sofa in ${s.materials.textile}, ` +
        `a simple fireplace with a clean surround, ` +
        `two table lamps and a floor lamp, styled coffee table, ` +
        `${s.mood}, ` +
        `clean and well-designed but approachable, a room that feels ` +
        `warm and inviting without overdesigning`,

      elevated: (s) =>
        `wide editorial photograph of a beautifully designed living room, ` +
        `${s.materials.accent}, ${s.materials.wood} flooring, ` +
        `designer upholstered seating in ${s.materials.textile} with ` +
        `accent chairs, a fireplace with natural stone surround, ` +
        `custom built-in shelving styled with art and books, ` +
        `designer lighting including a statement overhead fixture, ` +
        `layered area rug, curated art on the walls, ` +
        `${s.palette}, ${s.mood}, ` +
        `a clear step up in design intention and material quality`,

      showpiece: (s) =>
        `wide editorial photograph of a stunning magazine-worthy living room, ` +
        `full architectural millwork and ${s.materials.accent}, ` +
        `${s.materials.wood} flooring in an intricate pattern, ` +
        `bespoke upholstered seating in ${s.materials.textile}, ` +
        `a dramatic floor-to-ceiling stone fireplace as the centerpiece, ` +
        `custom floor-to-ceiling built-ins with integrated art lighting, ` +
        `a statement chandelier, collected art and sculptural objects, ` +
        `${s.palette}, ${s.mood}, ` +
        `heirloom-quality materials and bespoke details, the room ` +
        `that defines the home`,
    },
  },

  exterior: {
    name: 'Exterior',
    scenes: {
      essential: (s) =>
        `wide editorial photograph of a home exterior front elevation, ` +
        `clean siding in a warm neutral tone with painted trim, ` +
        `a welcoming front entry with a simple covered porch, ` +
        `${s.materials.metal} exterior lighting fixtures flanking the door, ` +
        `a paved walkway with basic foundation landscaping, ` +
        `${s.mood} translated to exterior architectural style, ` +
        `clean and well-maintained curb appeal, afternoon golden hour light`,

      elevated: (s) =>
        `wide editorial photograph of a home exterior front elevation, ` +
        `mixed materials combining stone or brick base with painted ` +
        `board-and-batten or lap siding above, an upgraded front entry ` +
        `with a deeper covered porch and architectural columns, ` +
        `${s.materials.metal} exterior lanterns and house numbers, ` +
        `designed landscaping with layered plantings and a stone walkway, ` +
        `${s.mood} translated to exterior architectural style, ` +
        `real curb appeal with architectural presence, afternoon golden hour light`,

      showpiece: (s) =>
        `wide editorial photograph of a stunning home exterior front elevation, ` +
        `full natural stone or brick facade with custom mortar detailing, ` +
        `a grand entry with bespoke architectural details like arched ` +
        `doorways or custom ironwork, statement exterior lighting, ` +
        `a porte-cochère or deep covered veranda, ` +
        `professionally designed landscaping with mature plantings ` +
        `and custom hardscape, ${s.materials.metal} accents throughout, ` +
        `${s.mood} translated to exterior architectural style, ` +
        `the home that makes people slow down driving past, ` +
        `afternoon golden hour light with long warm shadows`,
    },
  },
};

// ── Tier labels ─────────────────────────────────────────────────────────────
const TIERS = ['essential', 'elevated', 'showpiece'];
const TIER_LABELS = { essential: 'Essential', elevated: 'Elevated', showpiece: 'Showpiece' };

// ── Build all 72 jobs ───────────────────────────────────────────────────────
const JOBS_ALL = [];

for (const [styleKey, style] of Object.entries(STYLES)) {
  for (const [roomKey, room] of Object.entries(ROOMS)) {
    for (const tier of TIERS) {
      const scene = room.scenes[tier](style);
      JOBS_ALL.push({
        id:        `${styleKey}:${roomKey}:${tier}`,
        relPath:   `${style.name}/${room.name} — ${TIER_LABELS[tier]}.png`,
        prompt:    P(scene),
        aspectRatio: roomKey === 'exterior' ? '3:2' : '4:3',
      });
    }
  }
}

export const JOBS = JOBS_ALL;
