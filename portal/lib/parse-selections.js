// portal/lib/parse-selections.js
//
// Canonical derivation of individual selection records from the Wave
// Selections storage blob.
//
// Wave Selections keeps everything for a client in one jsonb blob
// (selections.data where suffix = 'ans') as a flat map of form field
// ids, plus a few companion suffixes: rms (rooms), ltx (which light
// types are in each room), pfx (which plumbing fixtures are in each
// room), fpu (fireplace units), spc (which specialty trim items were
// chosen). There is no per-selection row anywhere.
//
// This module turns that blob into a list of discrete items so each one
// can be given a uuid in the selection_items table and pinned to a plan.
//
// Two rules matter here:
//
// 1. Keys are built from ids that never change (category, room id,
//    fixture id), not from display labels. The design book builds its
//    key from "category:room name:label", which means renaming a room
//    changes the key of every item in it. That is survivable for image
//    overrides and fatal for pins, so this module does not copy it.
//
// 2. Lighting and plumbing are driven from the ltx and pfx state, which
//    records exactly which fixtures exist in each room, rather than from
//    a guessed list of fixture ids.
//
// Imported by netlify/functions/selection-items-sync.js. Kept in
// portal/lib so a browser page can import it as a module later.
// portal/design-book.html still carries its own older copy of this
// logic for image overrides; the two are independent on purpose.

// ── Wave and category model ──────────────────────────────────
// Mirrors WAVES / CATS in portal/selections-app.html. wave is the
// integer index used throughout that app.
export const WAVES = [
  { label: 'Wave 1', name: 'Structure' },
  { label: 'Wave 2', name: 'The Shell' },
  { label: 'Wave 3', name: 'The Jewelry' },
];

export const CATEGORIES = {
  fireplace:         { name: 'Fireplace',                 wave: 0 },
  appliances:        { name: 'Appliances',                wave: 0 },
  exterior_finishes: { name: 'Exterior Finishes',         wave: 0 },
  hvac:              { name: 'HVAC',                      wave: 0 },
  specialty_trim:    { name: 'Specialty Trim & Built-Ins', wave: 1 },
  flooring:          { name: 'Flooring',                  wave: 1 },
  tile:              { name: 'Tile',                      wave: 1 },
  plumbing:          { name: 'Plumbing Fixtures',         wave: 2 },
  lighting:          { name: 'Lighting Fixtures',         wave: 2 },
  countertops:       { name: 'Countertops',               wave: 2 },
  hardware:          { name: 'Hardware',                  wave: 2 },
  paint:             { name: 'Paint & Stain',             wave: 2 },
  doors:             { name: 'Interior Doors & Trim',     wave: 2 },
};

// Categories that make sense on an exterior elevation rather than a
// floor plan. Used to bias the plan filter, not to forbid anything.
export const ELEVATION_CATEGORIES = ['exterior_finishes', 'doors', 'lighting', 'paint'];

// Mirrors LIGHT_TYPES in portal/selections-app.html.
export const LIGHT_TYPES = [
  { id: 'recessed',    name: 'Recessed Lights' },
  { id: 'pendant',     name: 'Pendant' },
  { id: 'chandelier',  name: 'Chandelier' },
  { id: 'sconces',     name: 'Sconces' },
  { id: 'under_cab',   name: 'Under Cabinet' },
  { id: 'ceiling_fan', name: 'Ceiling Fan' },
  { id: 'fan_light',   name: 'Ceiling Fan with Light' },
  { id: 'track',       name: 'Track Lighting' },
  { id: 'accent',      name: 'Accent / Feature' },
  { id: 'cove',        name: 'Cove / Toe Kick' },
  { id: 'ext_wall',    name: 'Exterior Wall Mount' },
  { id: 'step_path',   name: 'Step / Path Lighting' },
  { id: 'cab_int',     name: 'Cabinet Interior' },
  { id: 'vanity_bar',  name: 'Vanity Bar / Mirror Light' },
];

// Mirrors BATH_FIXTURES / KITCHEN_FIXTURES / UTILITY_FIXTURES.
export const PLUMBING_FIXTURES = [
  { id: 'toilet',               name: 'Toilet' },
  { id: 'single_sink',          name: 'Single Sink' },
  { id: 'double_sink',          name: 'Double Sink' },
  { id: 'walk_in_shower',       name: 'Walk-in Shower' },
  { id: 'tub_shower_combo',     name: 'Tub/Shower Combo' },
  { id: 'freestanding_tub',     name: 'Freestanding Tub' },
  { id: 'bidet',                name: 'Bidet' },
  { id: 'urinal',               name: 'Urinal' },
  { id: 'kitchen_sink',         name: 'Kitchen Sink' },
  { id: 'pot_filler',           name: 'Pot Filler' },
  { id: 'bar_prep_sink',        name: 'Bar / Prep Sink' },
  { id: 'outdoor_kitchen_sink', name: 'Outdoor Kitchen Sink' },
  { id: 'wet_bar_sink',         name: 'Wet Bar Sink' },
  { id: 'utility_sink',         name: 'Utility / Laundry Sink' },
  { id: 'washer_hookup',        name: 'Washer Hookup' },
  { id: 'hose_bibb',            name: 'Hose Bibb' },
  { id: 'floor_drain',          name: 'Floor Drain' },
];

const PLUMBING_FIXTURE_NAMES = Object.fromEntries(
  PLUMBING_FIXTURES.map(f => [f.id, f.name])
);

// Standard appliances, keyed as app_<id>_product in the blob.
const STD_APPLIANCES = [
  { id: 'range',  name: 'Range / Cooktop' },
  { id: 'hood',   name: 'Range Hood' },
  { id: 'fridge', name: 'Refrigerator' },
  { id: 'dish',   name: 'Dishwasher' },
  { id: 'micro',  name: 'Microwave' },
  { id: 'oven',   name: 'Wall Oven' },
];

// Optional appliances, keyed as app_add_sel_<id> / app_add_prod_<id>.
const ADDL_APPLIANCES = [
  { id: 'wine_fridge',   name: 'Wine Fridge' },
  { id: 'bev_fridge',    name: 'Beverage Fridge' },
  { id: 'warming_draw',  name: 'Warming Drawer' },
  { id: 'steam_oven',    name: 'Steam Oven' },
  { id: 'speed_oven',    name: 'Speed Oven' },
  { id: 'coffee_sys',    name: 'Coffee System' },
  { id: 'ice_maker',     name: 'Ice Maker' },
  { id: 'trash_comp',    name: 'Trash Compactor' },
  { id: 'second_dish',   name: 'Second Dishwasher' },
  { id: 'outdoor_grill', name: 'Outdoor Grill' },
  { id: 'outdoor_fridge',name: 'Outdoor Fridge' },
  { id: 'outdoor_pizza', name: 'Outdoor Pizza Oven' },
  { id: 'wine_tower',    name: 'Wine Tower' },
  { id: 'keg_fridge',    name: 'Keg Fridge' },
];

const SPECIALTY_ITEMS = [
  { id: 'beams',      name: 'Exposed Beams',          loc: 'beams_loc',   style: 'beams_style', finish: 'beams_fin' },
  { id: 'shelves',    name: 'Floating Shelves',       loc: 'shelves_loc', style: 'shelves_mat', finish: '' },
  { id: 'mantle',     name: 'Fireplace Mantle',       loc: 'mantle_loc',  style: 'mantle_style', finish: 'mantle_fin' },
  { id: 'wainscot',   name: 'Wainscoting / Paneling', loc: 'wain_loc',    style: 'wain_style',  finish: 'wain_ht' },
  { id: 'coffered',   name: 'Coffered Ceiling',       loc: 'coff_loc',    style: '',            finish: 'coff_fin' },
  { id: 'other_trim', name: 'Other Specialty Trim',   loc: 'oth_desc',    style: '',            finish: '' },
];

const EXT_PARTS = [
  { id: 'roof',   name: 'Roof' },
  { id: 'soffit', name: 'Soffit' },
  { id: 'gutter', name: 'Gutters' },
  { id: 'siding', name: 'Siding' },
];

// ── Helpers ──────────────────────────────────────────────────

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'x';
}

// First non-empty answer among several candidate keys. The blob has
// accumulated two prefix conventions over time (bare "ct_product" and
// prefixed "countertops_ct_product"), so most lookups try both.
function pick(answers, ...keys) {
  for (const k of keys) {
    const v = answers[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function isUndecided(v) {
  return !v || /^undecided$/i.test(v) || /^none\b/i.test(v);
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function clean(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  });
  return out;
}

// ── Main entry point ─────────────────────────────────────────
//
// state: { answers, rooms, lightingTypes, plumbingFixtures, fpUnits, specSel }
// Returns an array of items, each with a stable `key`.
export function parseSelections(state) {
  const answers = (state && state.answers) || {};
  const rooms = Array.isArray(state && state.rooms) ? state.rooms : [];
  const lightingTypes = (state && state.lightingTypes) || {};
  const plumbingFixtures = (state && state.plumbingFixtures) || {};
  const fpUnits = toArray(state && state.fpUnits);
  const specSel = (state && state.specSel) || {};

  const items = [];

  // roomId is the id the app already uses everywhere. Falling back to a
  // slug of the name only matters for hand-added rooms without an id.
  const roomList = rooms.map(r => ({
    id: r.id || slug(r.name),
    name: r.name || r.id || 'Room',
    plumbing: r.plumbing || 'none',
  }));

  const add = (category, roomId, slot, fields) => {
    const cat = CATEGORIES[category];
    items.push({
      key: `${category}:${roomId}:${slot}`,
      category,
      wave: cat ? cat.wave : 0,
      roomId: roomId,
      room: fields.room || '',
      label: fields.label || '',
      product: fields.product || '',
      imageUrl: fields.image || '',
      detail: clean(fields.detail || {}),
    });
  };

  // ── Fireplace ──────────────────────────────────────────────
  // fpu is one entry per physical fireplace, which is already the
  // right granularity for pins.
  const fpWant = pick(answers, 'fireplace_fp_want');
  if (fpWant && !/^no\b/i.test(fpWant)) {
    if (fpUnits.length) {
      fpUnits.forEach((u, i) => {
        add('fireplace', 'whole_home', `unit_${i + 1}`, {
          room: (u && u.location) || 'Whole Home',
          label: fpUnits.length > 1 ? `Fireplace ${i + 1}` : 'Fireplace',
          product: pick(answers, 'fireplace_fp_product') || (u && u.type) || '',
          image: pick(answers, 'fireplace_fp_photo'),
          detail: {
            fuel: (u && u.type) || '',
            size: (u && u.size) || '',
            location: (u && u.location) || '',
            notes: pick(answers, 'fireplace_fp_notes'),
          },
        });
      });
    } else {
      add('fireplace', 'whole_home', 'unit_1', {
        room: 'Whole Home',
        label: 'Fireplace',
        product: pick(answers, 'fireplace_fp_product'),
        image: pick(answers, 'fireplace_fp_photo'),
        detail: { notes: pick(answers, 'fireplace_fp_notes') },
      });
    }
  }

  // ── Appliances ─────────────────────────────────────────────
  STD_APPLIANCES.forEach(ap => {
    const product = pick(answers, `app_${ap.id}_product`, `appliances_app_${ap.id}_product`);
    const type = pick(answers, `app_${ap.id}_type`, `appliances_app_${ap.id}_type`);
    if (!product && !type) return;
    add('appliances', 'kitchen', ap.id, {
      room: 'Kitchen',
      label: ap.name,
      product: product || type,
      image: pick(answers, `app_${ap.id}_photo`),
      detail: {
        type,
        size: pick(answers, `app_${ap.id}_size`),
        brand: pick(answers, `app_${ap.id}_brand`),
        finish: pick(answers, `app_${ap.id}_finish`),
      },
    });
  });

  ADDL_APPLIANCES.forEach(ap => {
    if (!answers[`app_add_sel_${ap.id}`]) return;
    const product = pick(answers, `app_add_prod_${ap.id}`);
    add('appliances', slug(pick(answers, `app_add_loc_${ap.id}`) || 'kitchen'), `add_${ap.id}`, {
      room: pick(answers, `app_add_loc_${ap.id}`) || 'Kitchen',
      label: ap.name,
      product,
      image: pick(answers, `app_add_photo_${ap.id}`),
      detail: { location: pick(answers, `app_add_loc_${ap.id}`) },
    });
  });

  // ── Exterior finishes ──────────────────────────────────────
  EXT_PARTS.forEach(part => {
    const type = pick(answers, `ext_${part.id}_type`, `ext_${part.id}_mat`, `ext_${part.id}_material`);
    const product = pick(answers, `ext_${part.id}_product`);
    if (!type && !product) return;
    add('exterior_finishes', 'exterior', part.id, {
      room: 'Exterior',
      label: part.name,
      product: product || type,
      image: pick(answers, `ext_${part.id}_photo`),
      detail: {
        material: type,
        color: pick(answers, `ext_${part.id}_color`),
        vented: pick(answers, `ext_${part.id}_vent`),
        notes: pick(answers, `ext_${part.id}_notes`),
      },
    });
  });

  const windowColor = pick(answers, 'ext_window_color');
  if (windowColor) {
    add('exterior_finishes', 'exterior', 'windows', {
      room: 'Exterior',
      label: 'Windows',
      product: pick(answers, 'ext_window_brand') || windowColor,
      image: pick(answers, 'ext_window_photo'),
      detail: {
        color: windowColor === 'Other / custom (describe below)'
          ? pick(answers, 'ext_window_color_other') : windowColor,
        grilles: pick(answers, 'ext_window_grilles'),
        notes: pick(answers, 'ext_window_notes'),
      },
    });
  }

  const porchType = pick(answers, 'ext_porch_ceil_type');
  if (porchType && !/^none\b/i.test(porchType)) {
    add('exterior_finishes', 'exterior', 'porch_ceiling', {
      room: 'Exterior',
      label: 'Porch Ceiling',
      product: pick(answers, 'ext_porch_ceil_other') || porchType,
      image: pick(answers, 'ext_porch_ceil_photo'),
      detail: {
        material: porchType,
        color: pick(answers, 'ext_porch_ceil_color'),
        notes: pick(answers, 'ext_porch_ceil_notes'),
      },
    });
  }

  // Exterior doors are a variable length array in the blob. Index is
  // the only stable handle available, so the key uses it.
  toArray(answers.ext_doors).forEach((d, i) => {
    if (!d || (!d.label && !d.product)) return;
    const label = d.label === 'Other (specify below)'
      ? (d.customLabel || `Exterior Door ${i + 1}`)
      : (d.label || `Exterior Door ${i + 1}`);
    add('doors', 'exterior', `ext_door_${i + 1}`, {
      room: 'Exterior',
      label,
      product: d.product || label,
      image: d.photo || '',
      detail: {
        roughOpening: d.roSize || '',
        color: d.color || '',
        finish: d.finish || '',
        notes: d.notes || '',
      },
    });
  });

  // ── HVAC ───────────────────────────────────────────────────
  const heatType = pick(answers, 'hvac_heat_type');
  if (!isUndecided(heatType)) {
    add('hvac', 'whole_home', 'heating', {
      room: 'Whole Home',
      label: 'Heating',
      product: pick(answers, 'hvac_heat_make_model') || heatType,
      detail: {
        type: heatType,
        size: pick(answers, 'hvac_heat_size'),
        efficiency: pick(answers, 'hvac_heat_eff'),
        notes: pick(answers, 'hvac_notes'),
      },
    });
  }
  const coolType = pick(answers, 'hvac_cool_type');
  if (!isUndecided(coolType)) {
    add('hvac', 'whole_home', 'cooling', {
      room: 'Whole Home',
      label: 'Cooling',
      product: pick(answers, 'hvac_cool_make_model') || coolType,
      detail: {
        type: coolType,
        size: pick(answers, 'hvac_cool_size'),
        seer: pick(answers, 'hvac_cool_seer'),
      },
    });
  }
  const thermostat = pick(answers, 'hvac_thermostat');
  if (thermostat && !isUndecided(thermostat)) {
    add('hvac', 'whole_home', 'thermostat', {
      room: 'Whole Home',
      label: 'Thermostat',
      product: thermostat,
      detail: { zones: pick(answers, 'hvac_zones') },
    });
  }

  // ── Specialty trim ─────────────────────────────────────────
  SPECIALTY_ITEMS.forEach(ti => {
    const chosen = specSel[ti.id];
    const loc = pick(answers, `specialty_trim_${ti.loc}`, ti.loc);
    if (!chosen && !loc) return;
    add('specialty_trim', 'whole_home', ti.id, {
      room: 'Whole Home',
      label: ti.name,
      product: loc,
      image: pick(answers, `specialty_trim_${ti.id}_photo`, `${ti.id}_photo`),
      detail: {
        locations: loc,
        style: ti.style ? pick(answers, `specialty_trim_${ti.style}`, ti.style) : '',
        finish: ti.finish ? pick(answers, `specialty_trim_${ti.finish}`, ti.finish) : '',
        notes: pick(answers, `specialty_trim_${ti.id}_notes`, `${ti.id}_notes`),
      },
    });
  });

  // ── Flooring, one per room ─────────────────────────────────
  roomList.forEach(rm => {
    const type = pick(answers, `flooring_floor_${rm.id}`, `flooring_${rm.id}_type`);
    if (!type) return;
    add('flooring', rm.id, 'floor', {
      room: rm.name,
      label: `${rm.name} Flooring`,
      product: pick(answers, `flooring_product_${rm.id}`, `flooring_${rm.id}_product`) || type,
      image: pick(answers, `flooring_product_${rm.id}_photo`, `flooring_photo_${rm.id}`),
      detail: {
        material: type,
        color: pick(answers, `flooring_color_${rm.id}`, `flooring_${rm.id}_color`),
        notes: pick(answers, `flooring_notes_${rm.id}`, `flooring_${rm.id}_notes`),
      },
    });
  });

  // ── Tile ───────────────────────────────────────────────────
  const tileSlots = [
    { slot: 'floor',      name: 'Floor Tile' },
    { slot: 'shower',     name: 'Shower Tile' },
    { slot: 'accent',     name: 'Accent Tile' },
    { slot: 'backsplash', name: 'Backsplash Tile' },
  ];
  roomList.forEach(rm => {
    tileSlots.forEach(ts => {
      const material = pick(answers, `tile_${ts.slot}_${rm.id}`, `tile_${rm.id}_${ts.slot}`);
      const product = pick(answers, `tile_${ts.slot}_product_${rm.id}`, `tile_${rm.id}_${ts.slot}_product`);
      if (!material && !product) return;
      add('tile', rm.id, ts.slot, {
        room: rm.name,
        label: `${rm.name} ${ts.name}`,
        product: product || material,
        image: pick(answers, `tile_${ts.slot}_photo_${rm.id}`, `tile_${rm.id}_${ts.slot}_photo`),
        detail: {
          material,
          grout: pick(answers, `tile_${ts.slot}_grout_${rm.id}`, `tile_${rm.id}_${ts.slot}_grout`),
        },
      });
    });
  });

  // ── Countertops ────────────────────────────────────────────
  const ctKit = pick(answers, 'countertops_ct_kit', 'ct_kit');
  const ctProduct = pick(answers, 'countertops_ct_product', 'ct_product');
  if (ctKit || ctProduct) {
    add('countertops', 'kitchen', 'main', {
      room: 'Kitchen',
      label: 'Kitchen Countertop',
      product: ctProduct || ctKit,
      image: pick(answers, 'countertops_ct_photo', 'ct_photo'),
      detail: {
        material: ctKit,
        color: pick(answers, 'countertops_ct_color', 'ct_color'),
        edge: pick(answers, 'countertops_ct_edge', 'ct_edge'),
        notes: pick(answers, 'countertops_ct_notes', 'ct_notes'),
      },
    });
    const ctIsl = pick(answers, 'countertops_ct_isl', 'ct_isl');
    if (/^yes/i.test(ctIsl)) {
      const islMat = pick(answers, 'countertops_ct_isl_mat', 'ct_isl_mat');
      add('countertops', 'kitchen', 'island', {
        room: 'Kitchen',
        label: 'Island Countertop',
        product: islMat,
        image: pick(answers, 'countertops_ct_isl_photo', 'ct_isl_photo'),
        detail: { material: islMat },
      });
    }
  }
  roomList.forEach(rm => {
    const mat = pick(answers, `ct_bath_${rm.id}`, `ct_bath_${rm.id}_mat`, `ct_util_${rm.id}`);
    if (!mat) return;
    add('countertops', rm.id, 'surface', {
      room: rm.name,
      label: `${rm.name} Countertop`,
      product: pick(answers, `ct_bath_product_${rm.id}`, `ct_util_product_${rm.id}`) || mat,
      image: pick(answers, `ct_bath_photo_${rm.id}`),
      detail: { material: mat, other: pick(answers, `ct_bath_other_${rm.id}`) },
    });
  });

  // ── Plumbing fixtures ──────────────────────────────────────
  // Driven from pfx, which records exactly which fixtures are in each
  // room. One item per fixture type per room; multiples of the same
  // fixture become multiple pins against the one item.
  roomList.forEach(rm => {
    const selected = plumbingFixtures[rm.id] || {};
    Object.keys(selected).forEach(fixId => {
      if (!selected[fixId]) return;
      const name = PLUMBING_FIXTURE_NAMES[fixId] || fixId.replace(/_/g, ' ');
      const base = `plumbing_${rm.id}_${fixId}`;
      const product = pick(answers, `${base}_product`, `${base}_sink_product`);
      add('plumbing', rm.id, fixId, {
        room: rm.name,
        label: `${rm.name} ${name}`,
        product,
        image: pick(answers, `${base}_photo`, `${base}_sink_photo`),
        detail: {
          style: pick(answers, `${base}_style`, `${base}_type`),
          head: pick(answers, `${base}_head`),
          door: pick(answers, `${base}_door`),
          notes: pick(answers, `plumbing_${rm.id}_notes`),
        },
      });

      // Sinks carry a separate faucet product, which is its own
      // fixture on the plan and gets its own pin.
      const faucet = pick(answers, `${base}_faucet_product`);
      if (faucet) {
        add('plumbing', rm.id, `${fixId}_faucet`, {
          room: rm.name,
          label: `${rm.name} ${name} Faucet`,
          product: faucet,
          image: pick(answers, `${base}_faucet_photo`),
          detail: { holes: pick(answers, `${base}_faucet`) },
        });
      }
    });
  });

  // ── Lighting fixtures ──────────────────────────────────────
  // Driven from ltx. A room with recessed cans is one item; the twelve
  // physical cans are twelve pins against it.
  roomList.forEach(rm => {
    const selected = lightingTypes[rm.id] || {};
    LIGHT_TYPES.forEach(lt => {
      if (!selected[lt.id]) return;
      const base = `lighting_${rm.id}_${lt.id}`;
      add('lighting', rm.id, lt.id, {
        room: rm.name,
        label: `${rm.name} ${lt.name}`,
        product: pick(answers, `${base}_product`),
        image: pick(answers, `${base}_photo`),
        detail: { notes: pick(answers, `lighting_${rm.id}_notes`) },
      });
    });
  });

  // ── Paint, one per room ────────────────────────────────────
  roomList.forEach(rm => {
    const wall = pick(answers, `paint_int_wall_${rm.id}`);
    const trim = pick(answers, `paint_int_trim_${rm.id}`);
    const ceil = pick(answers, `paint_int_ceil_${rm.id}`);
    if (!wall && !trim && !ceil) return;
    add('paint', rm.id, 'paint', {
      room: rm.name,
      label: `${rm.name} Paint`,
      product: wall || trim || ceil,
      detail: {
        wall, trim, ceiling: ceil,
        notes: pick(answers, `paint_int_notes_${rm.id}`),
      },
    });
  });

  const porchCeilColor = pick(answers, 'paint_porch_ceil_color');
  if (porchCeilColor) {
    add('paint', 'exterior', 'porch_ceiling', {
      room: 'Exterior',
      label: 'Porch Ceiling Paint',
      product: porchCeilColor,
      detail: { type: pick(answers, 'paint_porch_ceil_type') },
    });
  }

  // ── Hardware ───────────────────────────────────────────────
  const hwFinish = pick(answers, 'hardware_hw_finish', 'hw_finish');
  const hwProduct = pick(answers, 'hardware_hw_product', 'hw_product');
  if (hwFinish || hwProduct) {
    add('hardware', 'whole_home', 'door_hardware', {
      room: 'Whole Home',
      label: 'Door Hardware',
      product: hwProduct || pick(answers, 'hardware_hw_door_style', 'hw_door_style'),
      image: pick(answers, 'hardware_hw_photo', 'hw_photo'),
      detail: {
        style: pick(answers, 'hardware_hw_door_style', 'hw_door_style'),
        finish: hwFinish,
        hinge: pick(answers, 'hardware_hw_hinge', 'hw_hinge'),
        notes: pick(answers, 'hardware_hw_notes', 'hw_notes'),
      },
    });
    add('hardware', 'whole_home', 'cabinet_pulls', {
      room: 'Whole Home',
      label: 'Cabinet Pulls',
      product: pick(answers, 'hardware_hw_cabinet', 'hw_cabinet'),
      detail: { finish: hwFinish },
    });
    const bathAcc = pick(answers, 'hardware_hw_bath', 'hw_bath');
    if (bathAcc) {
      add('hardware', 'whole_home', 'bath_accessories', {
        room: 'Whole Home',
        label: 'Bath Accessories',
        product: bathAcc,
        detail: { finish: hwFinish },
      });
    }
  }

  // ── Interior doors and trim ────────────────────────────────
  const drStyle = pick(answers, 'doors_dr_sty', 'dr_sty');
  const trProduct = pick(answers, 'doors_tr_product', 'tr_product');
  if (drStyle || trProduct) {
    add('doors', 'whole_home', 'interior_doors', {
      room: 'Whole Home',
      label: 'Interior Doors',
      product: trProduct || drStyle,
      image: pick(answers, 'doors_dr_photo', 'dr_photo'),
      detail: {
        style: drStyle,
        height: pick(answers, 'doors_dr_ht', 'dr_ht'),
        finish: pick(answers, 'doors_dr_col', 'dr_col'),
        special: pick(answers, 'doors_dr_spec', 'dr_spec'),
      },
    });
    add('doors', 'whole_home', 'trim_molding', {
      room: 'Whole Home',
      label: 'Trim & Molding',
      product: trProduct,
      image: pick(answers, 'doors_tr_photo', 'tr_photo'),
      detail: {
        profile: pick(answers, 'doors_tr_prof', 'tr_prof'),
        base: pick(answers, 'doors_tr_base', 'tr_base'),
        crown: pick(answers, 'doors_tr_crown', 'tr_crown'),
        notes: pick(answers, 'doors_tr_notes', 'tr_notes'),
      },
    });
  }

  // Guard against a duplicate key slipping through, which would make
  // the upsert in the sync function drop rows silently.
  const seen = new Set();
  return items.filter(it => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
}
