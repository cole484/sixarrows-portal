// netlify/functions/selections-export.js
// Exports client selections as CSV for internal use
// GET ?clientKey=X&clientName=Y → returns CSV download

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;

function sbH() {
  return { 'apikey': SB_KEY(), 'Authorization': `Bearer ${SB_KEY()}` };
}

function csvEsc(val) {
  if (!val) return '';
  const s = String(val).replace(/\r?\n/g, ' ').trim();
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(...cells) { return cells.map(csvEsc).join(',') + '\r\n'; }

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:corsHeaders(), body:'' };

  const { clientKey, clientName } = event.queryStringParameters || {};
  if (!clientKey) return respond(400, { error: 'clientKey required' });

  // Fetch all selections rows for this client
  let allData = {};
  try {
    const url = `${SB_URL()}/rest/v1/selections?client_id=eq.${clientKey}&select=suffix,data`;
    const res  = await fetch(url, { headers: sbH() });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();
    rows.forEach(r => { allData[r.suffix] = r.data; });
  } catch(e) {
    return respond(500, { error: e.message });
  }

  const answers = allData.ans || {};
  const rooms   = Array.isArray(allData.rms) ? allData.rms
    : (typeof allData.rms === 'string' ? JSON.parse(allData.rms || '[]') : []);

  // Build CSV rows
  let csv = row('Category','Room','Item','Selection','Detail','Product / SKU','Notes');

  function addRow(cat, room, item, selection, detail='', product='', notes='') {
    if (!selection && !product) return; // skip empty
    csv += row(cat, room, item, selection, detail, product, notes);
  }

  // Countertops
  if (answers.ct_product || answers.ct_kit) {
    addRow('Countertops','Kitchen','Kitchen Countertop',
      answers.ct_kit||'', answers.ct_color||'', answers.ct_product||'',
      [answers.ct_edge, answers.ct_notes].filter(Boolean).join(' | '));
    if (answers.ct_isl && answers.ct_isl !== 'No — all matching') {
      addRow('Countertops','Kitchen','Island Countertop',
        answers.ct_isl_mat||answers.ct_isl||'','',answers.ct_isl_mat||'','');
    }
  }
  rooms.filter(r => /bath|powder/i.test(r.name||'')).forEach(rm => {
    const rk = (rm.id||rm.name||'').replace(/\s+/g,'_').toLowerCase();
    const mat = answers[`ct_bath_${rk}_mat`];
    if (mat) addRow('Countertops', rm.name, 'Countertop', mat, '', answers[`ct_bath_${rk}_product`]||'','');
  });

  // Flooring
  rooms.forEach(rm => {
    const rk = (rm.id||rm.name||'').replace(/\s+/g,'_').toLowerCase();
    const type = answers[`flooring_${rk}_type`];
    if (type) addRow('Flooring', rm.name, 'Flooring', type,
      answers[`flooring_${rk}_color`]||'',
      answers[`flooring_${rk}_product`]||'',
      answers[`flooring_${rk}_notes`]||'');
  });

  // Appliances
  [['app_range','Range / Cooktop'],['app_hood','Range Hood'],['app_ref','Refrigerator'],
   ['app_dw','Dishwasher'],['app_mw','Microwave'],['app_oven','Wall Oven'],
   ['app_wm','Washer'],['app_dr','Dryer']].forEach(([k,name]) => {
    const val = answers[`${k}_product`]||answers[k];
    if (val) addRow('Appliances','Kitchen',name,val,answers[`${k}_finish`]||'',val,'');
  });

  // Hardware
  if (answers.hw_finish || answers.hw_product) {
    addRow('Hardware','Whole Home','Door Hardware',answers.hw_door_style||'',
      answers.hw_finish||'',answers.hw_product||'',answers.hw_notes||'');
    addRow('Hardware','Whole Home','Cabinet Pulls',answers.hw_cabinet||'',
      answers.hw_finish||'','','');
  }

  // Doors & Trim
  if (answers.dr_sty) {
    addRow('Doors & Trim','Whole Home','Interior Doors',answers.dr_sty||'',
      answers.dr_ht||'',answers.tr_product||'',
      [answers.dr_col,answers.dr_spec].filter(Boolean).join(' | '));
    addRow('Doors & Trim','Whole Home','Trim & Molding',answers.tr_prof||'',
      answers.tr_base||'',answers.tr_product||'',answers.tr_crown||'');
  }

  // Tile (per bathroom)
  rooms.filter(r=>/bath|shower|powder/i.test(r.name||'')).forEach(rm => {
    const rk = (rm.id||rm.name||'').replace(/\s+/g,'_').toLowerCase();
    const floor = answers[`tile_${rk}_floor_product`]||answers[`tile_${rk}_floor`];
    const shower = answers[`tile_${rk}_shower_product`]||answers[`tile_${rk}_shower`];
    if (floor)  addRow('Tile',rm.name,'Floor Tile',floor,'',floor,answers[`tile_${rk}_floor_grout`]||'');
    if (shower) addRow('Tile',rm.name,'Shower Tile',shower,'',shower,answers[`tile_${rk}_shower_grout`]||'');
  });

  // Plumbing (per room)
  rooms.forEach(rm => {
    const rk = (rm.id||rm.name||'').replace(/\s+/g,'_').toLowerCase();
    [['toilet','Toilet'],['single_sink','Single Sink'],['double_sink','Double Sink'],
     ['walk_in_shower','Walk-In Shower'],['tub_shower_combo','Tub/Shower Combo'],
     ['freestanding_tub','Freestanding Tub'],['kitchen_sink','Kitchen Sink'],
     ['pot_filler','Pot Filler']].forEach(([fid,fname]) => {
      const prod = answers[`plumbing_${rk}_${fid}_product`]||answers[`plumbing_${rk}_${fid}_sink_product`];
      if (prod) addRow('Plumbing',rm.name,fname,prod,'',prod,'');
    });
  });

  // Exterior finishes
  ['roof','soffit','gutter'].forEach(part => {
    const mat = answers[`ext_${part}_mat`]||answers[`ext_${part}`];
    if (mat) addRow('Exterior Finishes','Exterior',
      part.charAt(0).toUpperCase()+part.slice(1),mat,
      answers[`ext_${part}_color`]||'',
      answers[`ext_${part}_product`]||mat,'');
  });

  // Specialty trim
  [['beams','Exposed Beams','beams_loc'],['shelves','Floating Shelves','shelves_loc'],
   ['mantle','Fireplace Mantle','mantle_style'],['wainscot','Wainscoting','wain_style']].forEach(([id,name,key]) => {
    if (answers[key]) addRow('Specialty Trim','Whole Home',name,
      answers[key]||'',answers[`${id}_fin`]||'','',answers[`${id}_notes`]||'');
  });

  // Fireplace
  if (answers.fireplace_fp_want && answers.fireplace_fp_want !== 'No — no fireplace') {
    addRow('Fireplace','Great Room','Fireplace',
      answers.fireplace_fp_fuel||'',answers.fireplace_fp_style||'',
      answers.fireplace_fp_product||'','');
  }

  const safeName = (clientName || clientKey).replace(/[^a-z0-9]/gi,'_');
  const filename  = `${safeName}_Selections_${new Date().toISOString().slice(0,10)}.csv`;

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: csv,
  };
};
