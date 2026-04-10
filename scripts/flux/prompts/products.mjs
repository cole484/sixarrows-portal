// scripts/flux/prompts/products.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Product image prompt library — 6 styles × 12 categories × 3 tiers = 216.
//
//  Each image is a close-up product photography shot of a single selection
//  from the DEFAULT_PRODUCTS catalog. These are NOT room shots (boards
//  handle that) — they are studio-quality product reference images for the
//  product cards in Selections v2.
//
//  Structure:
//    output/products/{style-slug}/{category}/{tier}.png
//    e.g. "modern-farmhouse/countertops/elevated.png"
//
//  To regenerate one product image:
//    node scripts/flux/generate.mjs products --only "modern_farmhouse:countertops:elevated" --force
//
//  To regenerate all products for one style:
//    node scripts/flux/generate.mjs products --style "Modern Farmhouse"
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared preamble ─────────────────────────────────────────────────────────
const SHOT = [
  'professional product photography',
  'studio lighting',
  'clean neutral background',
  'tack-sharp focus',
  'deep depth of field',
  'hyperrealistic materials and textures',
  'no text no watermarks no people',
  'shot on medium format digital camera',
].join(', ');

const P = (scene) => `${SHOT}, ${scene}`;

// ── Style profiles ──────────────────────────────────────────────────────────
// Mirrors STYLE_PROFILES from style-catalog.js — enough context for prompt
// color/material coherence without importing the full Netlify function.

const STYLES = {
  modern_farmhouse: {
    slug: 'modern-farmhouse',
    name: 'Modern Farmhouse',
    context: 'modern farmhouse style, warm whites, matte black hardware, natural wood, rustic charm with clean lines',
  },
  transitional: {
    slug: 'transitional',
    name: 'Transitional',
    context: 'transitional style, warm neutrals, brushed brass, timeless elegance balancing traditional and modern',
  },
  modern_traditional: {
    slug: 'modern-traditional',
    name: 'Modern Traditional',
    context: 'modern traditional style, deep green and navy tones, unlacquered brass, architectural heritage character',
  },
  organic_modern: {
    slug: 'organic-modern',
    name: 'Organic Modern',
    context: 'organic modern style, earthy clay tones, white oak, plaster textures, handcrafted artisanal warmth',
  },
  clean_modern: {
    slug: 'clean-modern',
    name: 'Clean Modern',
    context: 'clean modern style, crisp white and grey, matte black, minimal precise lines, architectural negative space',
  },
  warm_luxury: {
    slug: 'warm-luxury',
    name: 'Warm Luxury',
    context: 'warm luxury style, taupe and champagne, brushed gold, rich walnut, jewel tones, layered opulence',
  },
};

// ── Product catalog ─────────────────────────────────────────────────────────
// Verbatim from DEFAULT_PRODUCTS in style-catalog.js. Each category holds
// three tiers: [0] essential, [1] elevated, [2] showpiece.

const PRODUCTS = {
  modern_farmhouse: {
    countertops: [
      { name: 'White quartz (Caesarstone Pure White or similar)', note: 'Clean, durable, low-maintenance — the everyday workhorse.' },
      { name: 'Honed Carrara marble', note: 'Soft veining, warm whites — patinas beautifully over time.' },
      { name: 'Leathered quartzite (Taj Mahal or Sea Pearl)', note: 'Natural movement with the durability of granite — truly special.' },
    ],
    flooring: [
      { name: 'Engineered white oak 5″ plank (wire-brushed)', note: 'Warm, wide, stable — classic farmhouse underfoot.' },
      { name: 'Solid white oak 7″ wide plank (custom stain)', note: 'Deeper grain character, site-finished for a seamless look.' },
      { name: 'Reclaimed heart pine or antique white oak', note: 'Genuinely old wood with a century of patina — irreplaceable.' },
    ],
    tile: [
      { name: 'White 3×6 subway tile (glossy or matte)', note: 'Never out of style — clean lines, bright kitchen wall.' },
      { name: 'Handmade 3×6 crackle-glaze subway', note: 'Same format, more depth — each tile is slightly different.' },
      { name: 'Zellige tile (hand-cut Moroccan)', note: 'Artisanal imperfections give unmatched warmth and texture.' },
    ],
    hardware: [
      { name: 'Matte black cup pulls + knobs (Amerock or similar)', note: 'Solid, clean, the modern farmhouse standard.' },
      { name: 'Oil-rubbed bronze bin pulls (Rejuvenation)', note: 'Warmer patina that deepens with use.' },
      { name: 'Hand-forged iron pulls (custom blacksmith)', note: 'One of a kind — every pull has slight hand-worked variation.' },
    ],
    plumbing: [
      { name: 'Fireclay apron-front sink + pull-down faucet (Kraus or similar)', note: 'Classic farmhouse form at a strong value.' },
      { name: 'Rohl Shaws fireclay sink + Perrin & Rowe bridge faucet', note: 'English heritage, gorgeous proportions.' },
      { name: 'Custom copper apron sink + unlacquered brass faucet (Waterworks)', note: 'Living finish that develops unique patina — the real thing.' },
    ],
    lighting: [
      { name: 'Black barn-style pendants × 3 (Kichler or similar)', note: 'Simple, iconic, great over an island.' },
      { name: 'Schoolhouse pendants + matching sconces (Schoolhouse Electric)', note: 'Cohesive vintage-modern layer.' },
      { name: 'Custom blown-glass lanterns (Urban Electric or similar)', note: 'Statement pieces — hand-blown, one-of-a-kind glow.' },
    ],
    appliances: [
      { name: 'GE Profile or KitchenAid suite (stainless)', note: 'Reliable, good-looking, widely available.' },
      { name: 'Café Appliances suite (matte white or matte black)', note: 'Customizable hardware, farmhouse-friendly finishes.' },
      { name: 'La Cornue or AGA range + panel-ready Sub-Zero', note: 'Heirloom-level cooking — the centerpiece of the kitchen.' },
    ],
    paint: [
      { name: 'Benjamin Moore White Dove (OC-17) walls + Wrought Iron trim', note: 'Warm white + deep contrast — the go-to combo.' },
      { name: 'Farrow & Ball All White + Down Pipe', note: 'Richer pigment, more depth in the finish.' },
      { name: 'Portola lime wash (custom color match)', note: 'Hand-applied texture with built-in depth — no two walls alike.' },
    ],
    fireplace: [
      { name: 'Painted shiplap surround + simple mantel', note: 'Clean, paintable, classic farmhouse.' },
      { name: 'Reclaimed wood beam mantel + stacked stone surround', note: 'More texture and weight — a real focal point.' },
      { name: 'Full limestone surround with hand-carved mantel', note: 'Architectural statement — old-world craft.' },
    ],
    exterior_finishes: [
      { name: 'James Hardie board-and-batten (Arctic White) + black windows', note: 'Iconic modern farmhouse look, low maintenance.' },
      { name: 'Natural cedar board-and-batten + standing-seam metal roof accent', note: 'Real wood warmth with architectural metal detail.' },
      { name: 'Custom-milled vertical siding + copper gutters + stone base', note: 'Layered materials — the kind of exterior people photograph.' },
    ],
    specialty_trim: [
      { name: 'MDF shaker-profile wainscoting (painted)', note: 'Adds character on a budget — classic panel look.' },
      { name: 'Tongue-and-groove ceiling + built-in mudroom bench', note: 'Architectural layers that make the house feel finished.' },
      { name: 'Full coffered ceilings + custom built-in cabinetry', note: 'Millwork that defines the room — museum-level.' },
    ],
    doors: [
      { name: 'Solid-core 2-panel shaker (painted white)', note: 'Clean lines, good weight — a solid upgrade from hollow-core.' },
      { name: 'True divided-lite interior doors (glass panels)', note: 'Let light flow between rooms — classic charm.' },
      { name: 'Custom arched entry door + antique-reproduction interior doors', note: 'Every door a statement — the house tells a story at every threshold.' },
    ],
  },

  transitional: {
    countertops: [
      { name: 'Quartz (Cambria Torquay or Silestone Calacatta Gold)', note: 'Subtle marble look without the maintenance.' },
      { name: 'Honed quartzite (White Macaubas)', note: 'Natural stone with a polished, understated feel.' },
      { name: 'Book-matched Calacatta Oro marble', note: 'Dramatic veining, perfectly mirrored — a true luxury counter.' },
    ],
    flooring: [
      { name: 'Engineered oak 5″ plank in warm medium stain', note: 'Versatile, warm, pairs with everything.' },
      { name: 'Solid white oak 7″ plank (custom matte finish)', note: 'Wider, richer — a noticeably elevated floor.' },
      { name: 'European white oak parquet (herringbone pattern)', note: 'Old-world pattern, modern finish — unforgettable floors.' },
    ],
    tile: [
      { name: 'Marble-look porcelain subway tile', note: 'Clean lines with a hint of stone character.' },
      { name: 'Honed marble subway with brass Schluter trim', note: 'Real marble, polished detail at the edges.' },
      { name: 'Waterjet marble mosaic (arabesque or herringbone)', note: 'Intricate pattern work — each piece precision-cut.' },
    ],
    hardware: [
      { name: 'Brushed brass knobs + pulls (Top Knobs or similar)', note: 'Warm, polished, fits the transitional sweet spot.' },
      { name: 'Satin brass pulls (Armac Martin or Emtek)', note: 'Heavier weight, tighter tolerances — you feel the quality.' },
      { name: 'Unlacquered brass (Waterworks or custom)', note: 'Living finish that develops rich patina with use.' },
    ],
    plumbing: [
      { name: 'Undermount single-bowl stainless + Moen Align faucet', note: 'Clean, functional, contemporary classic.' },
      { name: 'Kohler Whitehaven apron sink + Purist faucet (brushed brass)', note: 'Elevated farmhouse lines with refined hardware.' },
      { name: 'Waterstone traditional faucet + Shaw fireclay farmhouse sink', note: 'Hand-finished brass, heirloom-grade ceramics.' },
    ],
    lighting: [
      { name: 'Brushed brass globe pendants × 2 (West Elm or CB2)', note: 'Simple, warm, modern — great island lighting.' },
      { name: 'Visual Comfort brass linear chandelier', note: 'Polished lines, even light spread — designer standard.' },
      { name: 'Custom linear suspension (Apparatus or Roll & Hill)', note: 'Art-level lighting — sculptural and functional.' },
    ],
    appliances: [
      { name: 'KitchenAid or Bosch stainless suite', note: 'Reliable, clean design, great value.' },
      { name: 'Fisher & Paykel or Thermador Professional', note: 'Pro-grade performance in a refined package.' },
      { name: 'Wolf range + Sub-Zero columns (panel-ready)', note: 'Best-in-class — disappears into cabinetry or commands attention.' },
    ],
    paint: [
      { name: 'Benjamin Moore Revere Pewter + Simply White trim', note: 'Warm greige — the transitional neutral standard.' },
      { name: 'Farrow & Ball Skimming Stone + Strong White', note: 'More nuance and depth — beautiful in changing light.' },
      { name: 'Venetian plaster (Stucco Italiano or Limestrong)', note: 'Seamless, luminous walls — a finish, not just a color.' },
    ],
    fireplace: [
      { name: 'Marble tile surround + painted MDF mantel', note: 'Clean, classic, easy to style.' },
      { name: 'Full-height paneled surround with honed marble hearth', note: 'Architectural framing — makes the mantel a statement.' },
      { name: 'Floor-to-ceiling fluted stone surround (custom)', note: 'Monolithic stone — a fireplace you build a room around.' },
    ],
    exterior_finishes: [
      { name: 'Fiber cement lap siding (warm grey) + black clad windows', note: 'Clean lines, low maintenance, classic feel.' },
      { name: 'Brick + painted wood trim + standing-seam metal entry roof', note: 'Layered materials with traditional bones.' },
      { name: 'Natural limestone base + painted cedar + copper accents', note: 'Timeless material mix — gets better with age.' },
    ],
    specialty_trim: [
      { name: 'Chair rail + panel molding in dining/entry', note: 'Classic wall detail — instant architectural weight.' },
      { name: 'Full wall paneling + crown molding package', note: 'Every room has structure and rhythm.' },
      { name: 'Custom millwork library + paneled ceiling + arched doorways', note: 'Bespoke trim that turns a house into an estate.' },
    ],
    doors: [
      { name: 'Solid-core 1-panel shaker (painted)', note: 'Simple, modern, substantial feel.' },
      { name: '5-panel mission doors + satin brass hinges', note: 'More detail, warm hardware — refined touch.' },
      { name: 'Custom solid-wood doors with concealed hinges', note: 'Flush lines, invisible hardware — cabinetry-level craft.' },
    ],
  },

  modern_traditional: {
    countertops: [
      { name: 'Honed quartz (Caesarstone Calacatta Nuvo)', note: 'Marble look, zero upkeep — practical luxury.' },
      { name: 'Honed Calacatta marble', note: 'Rich veining, warm tone — the real thing, beautifully imperfect.' },
      { name: 'Book-matched Calacatta Viola marble', note: 'Dramatic purple-grey veining — a signature stone.' },
    ],
    flooring: [
      { name: 'Engineered walnut 5″ plank', note: 'Rich dark tone, stable and consistent.' },
      { name: 'Solid walnut 7″ wide plank (site-finished)', note: 'Deeper color variation, hand-finished warmth.' },
      { name: 'Antique reclaimed walnut or mahogany parquet', note: 'Genuine old wood — every board has a story.' },
    ],
    tile: [
      { name: 'Marble-look porcelain in herringbone layout', note: 'Classic pattern, stone feel, durable.' },
      { name: 'Honed Calacatta hexagon mosaic', note: 'Timeless, elegant — the traditional bath standard.' },
      { name: 'Custom waterjet marble medallion + border', note: 'Precision-cut artistry — like a stone carpet.' },
    ],
    hardware: [
      { name: 'Oil-rubbed bronze knobs + bin pulls (Baldwin)', note: 'Traditional, warm, heritage feel.' },
      { name: 'Unlacquered brass cup pulls (Rejuvenation)', note: 'Warm patina that deepens beautifully.' },
      { name: 'Hand-cast bronze hardware (Rocky Mountain or E.R. Butler)', note: 'Investment hardware — each piece is individually cast.' },
    ],
    plumbing: [
      { name: 'Undermount farmhouse sink + widespread faucet (Delta Cassidy)', note: 'Traditional styling at a solid value.' },
      { name: 'Rohl fireclay sink + Perrin & Rowe faucet (unlacquered brass)', note: 'English heritage, gorgeous proportions.' },
      { name: 'Waterworks faucet + custom stone basin', note: 'Museum-level bathroom fittings — the finest available.' },
    ],
    lighting: [
      { name: 'Classic lantern pendants in aged brass (Quoizel or similar)', note: 'Traditional form, warm finish.' },
      { name: 'Visual Comfort Darlana or CHD library sconces', note: 'The designer standard for traditional homes.' },
      { name: 'Vaughan or Circa Lighting custom chandeliers', note: 'English heritage lighting — every fixture is an antique in the making.' },
    ],
    appliances: [
      { name: 'KitchenAid or GE Profile (stainless or black stainless)', note: 'Reliable, clean, blends into any kitchen.' },
      { name: 'Thermador or BlueStar range + panel-ready fridge', note: 'Pro performance with options to hide behind cabinet panels.' },
      { name: 'La Cornue CornuFé range + fully integrated Sub-Zero/Wolf', note: 'Furniture-grade appliances — the kitchen as showroom.' },
    ],
    paint: [
      { name: 'Benjamin Moore Hale Navy accent + White Dove walls', note: 'Classic contrast — deep and inviting.' },
      { name: 'Farrow & Ball Studio Green + Pointing trim', note: 'Rich heritage green — moody, warm, alive.' },
      { name: 'Custom color-matched lime wash + lacquered accent walls', note: 'Dimensional walls — high-gloss lacquer reflects like a mirror.' },
    ],
    fireplace: [
      { name: 'Painted paneled surround + stone hearth', note: 'Clean traditional lines, easy to customize.' },
      { name: 'Full limestone surround with dentil molding', note: 'Architectural stone detail — classical and warm.' },
      { name: 'Hand-carved marble mantel (antique or reproduction)', note: 'A genuine art piece — the kind collectors seek out.' },
    ],
    exterior_finishes: [
      { name: 'Brick veneer + painted wood trim + asphalt shingle', note: 'Classic traditional look, proven durability.' },
      { name: 'Full brick + limestone window surrounds + slate roof accent', note: 'Layered stone and masonry — substantial and dignified.' },
      { name: 'Hand-laid natural stone + copper roof + custom iron railings', note: 'Old-world craft — the house looks like it\'s always been there.' },
    ],
    specialty_trim: [
      { name: 'Crown molding + baseboard package (6″+)', note: 'Proportional trim — makes standard rooms feel grand.' },
      { name: 'Coffered ceiling + paneled wainscoting + picture rails', note: 'Full architectural trim package — every surface detailed.' },
      { name: 'Custom plaster ceiling medallions + hand-carved moldings', note: 'Artisan plasterwork — European estate level.' },
    ],
    doors: [
      { name: 'Solid-core 6-panel (painted)', note: 'Traditional profile, good weight.' },
      { name: 'True divided-lite french doors + raised-panel interior', note: 'Classical proportions, glass light flow.' },
      { name: 'Custom mahogany entry door + arched transom + pocket doors', note: 'Every doorway is an architectural moment.' },
    ],
  },

  organic_modern: {
    countertops: [
      { name: 'Quartz in warm white (Silestone Calacatta Gold or similar)', note: 'Clean surface with soft warmth.' },
      { name: 'Honed soapstone', note: 'Matte, tactile, naturally antibacterial — develops character.' },
      { name: 'Live-edge walnut slab island + quartzite perimeter', note: 'Natural edge, organic form — the island is a sculpture.' },
    ],
    flooring: [
      { name: 'Engineered white oak 6″ plank (natural matte finish)', note: 'Light, modern, beautifully simple.' },
      { name: 'Wide-plank white oak 8″+ (European grade, matte oil)', note: 'More natural variation, butter-soft finish.' },
      { name: 'Hand-scraped white oak or teak (custom oil finish)', note: 'Artisan texture underfoot — every board unique.' },
    ],
    tile: [
      { name: 'Handmade-look ceramic in warm white', note: 'Subtle variation, organic feel, easy to source.' },
      { name: 'Zellige tile (hand-cut, natural white or sage)', note: 'Moroccan artisan tile — undulating surface catches light.' },
      { name: 'Cle Tile zellige + custom terracotta floor tile', note: 'Full artisan tile program — walls and floors tell a story.' },
    ],
    hardware: [
      { name: 'Leather pulls + matte brass knobs (CB2 or similar)', note: 'Soft, tactile, organic — a fresh alternative to metal.' },
      { name: 'Unlacquered brass knurled pulls (Buster + Punch)', note: 'Industrial meets organic — develops beautiful patina.' },
      { name: 'Custom hand-thrown ceramic knobs + bronze pulls', note: 'Artisan-made — every piece slightly different.' },
    ],
    plumbing: [
      { name: 'Undermount stainless + pull-down faucet (satin brass)', note: 'Warm metal, clean form, reliable function.' },
      { name: 'Concrete vessel sink + wall-mount faucet (unlacquered brass)', note: 'Sculptural basin, minimal footprint.' },
      { name: 'Hand-carved stone basin + Vola or Fantini wall-mount faucet', note: 'Each basin is unique — river-stone or marble, hand-finished.' },
    ],
    lighting: [
      { name: 'Woven rattan or linen drum pendants (DERA or similar)', note: 'Soft light, natural material, organic warmth.' },
      { name: 'Ceramic pendant cluster (Heather Levine or Apparatus)', note: 'Handmade clay forms — art that lights a room.' },
      { name: 'Custom plaster dome pendants + artisan sconces', note: 'Sculptural plaster — seamless, glowing, monolithic.' },
    ],
    appliances: [
      { name: 'Bosch or Fisher & Paykel (panel-ready where possible)', note: 'Disappears into cabinetry — the organic kitchen is about materials, not logos.' },
      { name: 'Fisher & Paykel integrated columns + induction cooktop', note: 'Sleek, invisible, lets the kitchen materials breathe.' },
      { name: 'Gaggenau fully integrated + Bora downdraft (no hood)', note: 'No visual appliance clutter — the kitchen looks like furniture.' },
    ],
    paint: [
      { name: 'Benjamin Moore White Sand + Natural Linen trim', note: 'Warm, quiet, grounding — lets materials lead.' },
      { name: 'Farrow & Ball Jitney or Setting Plaster', note: 'Earthy, clay-warm — beautiful in natural light.' },
      { name: 'Lime wash plaster walls (Portola or Roman Clay)', note: 'Hand-applied plaster — depth and movement in every wall.' },
    ],
    fireplace: [
      { name: 'Smooth plaster surround (rounded edges)', note: 'Sculptural, minimal — organic modern\'s signature fireplace.' },
      { name: 'Hand-plastered arch surround + stone hearth', note: 'Curved form, natural stone base — a warm focal point.' },
      { name: 'Full plaster hood fireplace (floor to ceiling) + custom grate', note: 'Monolithic plaster — the room orbits around it.' },
    ],
    exterior_finishes: [
      { name: 'Smooth stucco (warm white) + natural wood accent', note: 'Clean, warm, Mediterranean-inflected.' },
      { name: 'Lime-wash stucco + cedar accent wall + ipe deck', note: 'Textured walls, real wood — ages beautifully.' },
      { name: 'Rammed earth accent wall + weathering steel + natural stone', note: 'Raw, elemental materials — the house feels grown from the land.' },
    ],
    specialty_trim: [
      { name: 'Rounded plaster arch doorways (drywall build-out)', note: 'Soft arches transform standard openings.' },
      { name: 'Full arched openings + floating oak shelves + niches', note: 'Sculptural plaster transitions, integrated storage.' },
      { name: 'Tadelakt plaster wet room + custom curved millwork', note: 'Waterproof lime plaster + organic cabinetry — spa-level craft.' },
    ],
    doors: [
      { name: 'Flush solid-core slab doors (warm white)', note: 'Minimal, clean — lets the walls and materials speak.' },
      { name: 'White oak slab doors with concealed hinges', note: 'Warm wood, invisible hardware — furniture-grade.' },
      { name: 'Custom arched white oak doors + pivot entry door', note: 'Sculptural doorways — every transition is intentional.' },
    ],
  },

  clean_modern: {
    countertops: [
      { name: 'White quartz (Caesarstone Statuario Nuvo)', note: 'Crisp, consistent — the modern kitchen standard.' },
      { name: 'Dekton ultra-compact surface (Kelya or Sirius)', note: 'Virtually indestructible, razor-thin edge profile.' },
      { name: 'Neolith sintered stone slab (waterfall island)', note: 'Seamless waterfall edges — a monolithic stone statement.' },
    ],
    flooring: [
      { name: 'Large-format porcelain tile (24×24 or 24×48)', note: 'Minimal grout lines, clean plane — architectural floor.' },
      { name: 'Engineered European oak in matte grey-wash', note: 'Warm enough to balance all the crisp surfaces.' },
      { name: 'Polished concrete or terrazzo (poured in place)', note: 'Seamless, industrial-modern — no seams, no grout, all texture.' },
    ],
    tile: [
      { name: 'Large-format porcelain wall tile (marble look)', note: 'Minimal joints, maximum visual impact.' },
      { name: 'Full slab porcelain backsplash (book-matched)', note: 'No grout lines — the wall reads as one stone.' },
      { name: 'Back-painted glass or natural stone slab (floor to ceiling)', note: 'Reflective or natural — either way, seamless and sculptural.' },
    ],
    hardware: [
      { name: 'Integrated finger pulls (routed into cabinet edge)', note: 'No visible hardware — the ultimate clean line.' },
      { name: 'Brushed stainless edge pulls (Sugatsune or Hafele)', note: 'Minimal profile, precision-machined feel.' },
      { name: 'Custom milled aluminum channel pulls (anodized)', note: 'Bespoke — designed specifically for each cabinet run.' },
    ],
    plumbing: [
      { name: 'Undermount single-bowl stainless + Grohe Essence faucet', note: 'Clean geometry, flush-mount — quietly excellent.' },
      { name: 'Integrated stainless workstation sink + Dornbracht faucet', note: 'Built-in cutting boards, colanders — the sink is a tool.' },
      { name: 'Custom integrated Corian sink + Vola wall-mount faucet', note: 'Sink and counter are one seamless surface — no edges, no joints.' },
    ],
    lighting: [
      { name: 'Recessed LED cans + under-cabinet LED strips', note: 'Invisible source, clean light — architecture does the work.' },
      { name: 'Linear LED pendant (Flos or Vibia)', note: 'One sculptural line of light over the island.' },
      { name: 'Custom cove lighting system + Occhio or Nemo fixtures', note: 'Integrated light architecture — the ceiling glows, no fixtures visible.' },
    ],
    appliances: [
      { name: 'Bosch 800 series (panel-ready)', note: 'Fully hidden behind cabinet panels — clean lines.' },
      { name: 'Miele panel-ready + induction cooktop', note: 'German engineering, invisible integration.' },
      { name: 'Gaggenau 400 series + Bora downdraft (hoodless)', note: 'No hood, no handles, no logos — appliances as architecture.' },
    ],
    paint: [
      { name: 'Benjamin Moore Chantilly Lace + Super White trim', note: 'Crisp, bright, lets architecture lead.' },
      { name: 'Benjamin Moore Gray Owl + matte lacquer accent wall', note: 'Warm grey + a reflective moment — refined modern palette.' },
      { name: 'Microcement walls (Ideal Work or Topciment)', note: 'Seamless, industrial, tactile — no paint, no wallpaper, all texture.' },
    ],
    fireplace: [
      { name: 'Full-height porcelain slab surround', note: 'One material, floor to ceiling — clean and dramatic.' },
      { name: 'Blackened steel box surround + concrete hearth', note: 'Industrial materials, precise geometry.' },
      { name: 'Suspended steel + glass fireplace (custom)', note: 'A floating fire — architectural sculpture.' },
    ],
    exterior_finishes: [
      { name: 'Fiber cement panels (dark charcoal) + aluminum-clad windows', note: 'Flat planes, dark palette — modern from the street.' },
      { name: 'Zinc or Corten steel cladding + ipe rain screen', note: 'Weathering metals that change with time — alive.' },
      { name: 'Board-formed concrete + blackened steel + hidden gutters', note: 'Monolithic — the house reads as one cast form.' },
    ],
    specialty_trim: [
      { name: 'Flush baseboards + shadow-gap reveal (no crown molding)', note: 'Clean modern DNA — trim disappears, walls float.' },
      { name: 'Full flush-detail package + integrated LED reveals', note: 'Light in the walls — shadows and glow define the rooms.' },
      { name: 'Custom pivot walls + motorized panels + hidden rooms', note: 'Architecture as furniture — walls move, rooms transform.' },
    ],
    doors: [
      { name: 'Flush solid-core slab (painted to match walls)', note: 'Invisible doors — the wall plane is unbroken.' },
      { name: 'Floor-to-ceiling flush doors with concealed hinges', note: 'Full-height, frameless — monumental simplicity.' },
      { name: 'Custom pivot doors (10ft+ height) + motorized pocket doors', note: 'Doors as architecture — they rotate, disappear, transform the plan.' },
    ],
  },

  warm_luxury: {
    countertops: [
      { name: 'Polished quartz (Caesarstone Empira Black)', note: 'Deep, rich, durable — luxury look, practical surface.' },
      { name: 'Honed Calacatta Viola marble', note: 'Purple-grey veining on warm white — dramatic and rare.' },
      { name: 'Book-matched exotic marble (Paonazzo or Arabescato Orobico)', note: 'Mirrored slabs — a geological artwork as your countertop.' },
    ],
    flooring: [
      { name: 'Engineered walnut 6″ plank (warm matte finish)', note: 'Rich, dark, grounding — sets a warm luxury tone.' },
      { name: 'Wide-plank European walnut (brushed, oiled)', note: 'Deeper grain character, softer underfoot.' },
      { name: 'Parquet de Versailles or custom inlay pattern', note: 'French palace-level floors — geometry and wood as art.' },
    ],
    tile: [
      { name: 'Polished marble look porcelain (large format)', note: 'Dramatic veining, durable, budget-friendly.' },
      { name: 'Honed marble mosaics (chevron or arabesque)', note: 'Intricate real-stone patterns — handset luxury.' },
      { name: 'Book-matched marble slab walls + mosaic floor (bathroom)', note: 'Full stone immersion — walls and floors tell one story.' },
    ],
    hardware: [
      { name: 'Brushed gold pulls + knobs (Amerock Golden Champagne)', note: 'Warm gold, clean lines — accessible luxury.' },
      { name: 'Satin brass fluted pulls (Armac Martin or Emtek)', note: 'Textured surface catches light — tactile and elegant.' },
      { name: 'Hand-cast solid bronze hardware (E.R. Butler or Nanz)', note: 'Weight and warmth in your hand — the finest hardware made.' },
    ],
    plumbing: [
      { name: 'Undermount double-bowl + Brizo Litze faucet (brushed gold)', note: 'Modern form, warm finish — elevated everyday.' },
      { name: 'Rohl fireclay sink + Perrin & Rowe bridge (satin brass)', note: 'Heritage form, luxe finish — timeless combination.' },
      { name: 'Waterworks freestanding tub + wall-mount faucet + rain shower', note: 'Sculpture-grade fixtures — the bathroom is a destination.' },
    ],
    lighting: [
      { name: 'Crystal + brass pendants (Restoration Hardware or similar)', note: 'Sparkle + warmth — glamorous without trying.' },
      { name: 'Visual Comfort Aerin or Kelly Wearstler collection', note: 'Designer pedigree, sculptural form — a name over your island.' },
      { name: 'Custom Murano glass chandelier + bespoke sconce program', note: 'Hand-blown Italian glass — each fixture is a work of art.' },
    ],
    appliances: [
      { name: 'Thermador Professional suite', note: 'Pro-grade, great aesthetics, serious cooking power.' },
      { name: 'Wolf range + Sub-Zero fridge + Cove dishwasher', note: 'The luxury trifecta — restaurant power, residential beauty.' },
      { name: 'La Cornue Château range + Miele steam oven + wine columns', note: 'Bespoke French range + full culinary arsenal — the ultimate kitchen.' },
    ],
    paint: [
      { name: 'Benjamin Moore Kendall Charcoal + White Dove', note: 'Rich contrast — moody walls, crisp trim.' },
      { name: 'Farrow & Ball Hague Blue or Salamander + warm trim', note: 'Deep jewel tones — dramatic, enveloping rooms.' },
      { name: 'High-gloss lacquer walls + Venetian plaster ceiling', note: 'Mirror-finish walls reflect light and art — gallery-level treatment.' },
    ],
    fireplace: [
      { name: 'Marble surround + fluted detail', note: 'Classic luxury — stone and texture.' },
      { name: 'Book-matched marble surround (floor to ceiling)', note: 'Dramatic stone statement — the room\'s centerpiece.' },
      { name: 'Antique reclaimed marble mantel + custom bronze surround', note: 'Genuine antique stone — centuries of provenance.' },
    ],
    exterior_finishes: [
      { name: 'Painted brick + black clad windows + stone entry', note: 'Classic luxury from the curb — refined and dignified.' },
      { name: 'Natural stone veneer + copper gutters + slate roof', note: 'Layered, aging materials — gets more beautiful with time.' },
      { name: 'Full cut stone facade + custom iron balconettes + clay tile roof', note: 'European estate presence — the house commands its street.' },
    ],
    specialty_trim: [
      { name: 'Paneled wainscoting + picture rail (dining + entry)', note: 'Traditional framing — sets the luxury baseline.' },
      { name: 'Full wall paneling + coffered ceiling + arched openings', note: 'Every room architecturally complete — museum-level trim.' },
      { name: 'Custom fluted millwork + lacquered built-ins + plaster details', note: 'Bespoke trim program — hand-fluted columns, specialty plaster, the works.' },
    ],
    doors: [
      { name: 'Solid-core raised-panel doors (painted)', note: 'Traditional weight and profile — a solid starting point.' },
      { name: 'Walnut-stained interior doors + glass-panel french doors', note: 'Rich wood, elegant proportions, natural light.' },
      { name: 'Custom solid walnut doors + bronze hinges + pivot entry', note: 'Every door is furniture — bronze, walnut, and weight.' },
    ],
  },
};

// ── Category prompt templates ───────────────────────────────────────────────
// Each function takes (product, style) and returns a scene description.
// The product object has { name, note }. The style object has { context }.

const CATEGORY_PROMPTS = {
  countertops: (prod, style) =>
    `close-up of ${prod.name} countertop slab showing surface texture and veining, ` +
    `${style.context}`,

  flooring: (prod, style) =>
    `close-up of ${prod.name} flooring showing grain pattern and texture, overhead angle, ` +
    `${style.context}`,

  tile: (prod, style) =>
    `close-up of ${prod.name} tile arrangement showing pattern and texture, ` +
    `${style.context}`,

  hardware: (prod, style) =>
    `close-up of ${prod.name} cabinet hardware on white background, ` +
    `${style.context}`,

  plumbing: (prod, style) =>
    `${prod.name} sink and faucet arrangement, three-quarter view, ` +
    `${style.context}`,

  lighting: (prod, style) =>
    `${prod.name} light fixture, three-quarter view against dark background, ` +
    `${style.context}`,

  appliances: (prod, style) =>
    `${prod.name} kitchen appliance, editorial product shot, ` +
    `${style.context}`,

  paint: (prod, style) =>
    `painted wall sample showing ${prod.name} color and finish, close-up, ` +
    `${style.context}`,

  fireplace: (prod, style) =>
    `${prod.name} fireplace surround detail, architectural close-up, ` +
    `${style.context}`,

  exterior_finishes: (prod, style) =>
    `${prod.name} exterior material close-up showing texture, ` +
    `${style.context}`,

  specialty_trim: (prod, style) =>
    `${prod.name} trim/millwork detail, architectural close-up, ` +
    `${style.context}`,

  doors: (prod, style) =>
    `${prod.name} interior door, full view in a neutral room setting, ` +
    `${style.context}`,
};

// ── Tier mapping ────────────────────────────────────────────────────────────
const TIERS = ['essential', 'elevated', 'showpiece'];

// ── Build all 216 jobs ──────────────────────────────────────────────────────
const JOBS_ALL = [];

for (const [styleKey, style] of Object.entries(STYLES)) {
  const products = PRODUCTS[styleKey];

  for (const [categoryKey, items] of Object.entries(products)) {
    const promptBuilder = CATEGORY_PROMPTS[categoryKey];

    for (let i = 0; i < TIERS.length; i++) {
      const tier = TIERS[i];
      const product = items[i];
      const scene = promptBuilder(product, style);

      JOBS_ALL.push({
        id:          `${styleKey}:${categoryKey}:${tier}`,
        relPath:     `${style.slug}/${categoryKey}/${tier}.png`,
        prompt:      P(scene),
        aspectRatio: '1:1',
      });
    }
  }
}

export const JOBS = JOBS_ALL;
