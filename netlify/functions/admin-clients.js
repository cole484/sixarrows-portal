// netlify/functions/admin-clients.js
// Full client CRUD for the admin panel
// GET    ?all=1         — list all clients (admin)
// GET    ?clientId=xxx  — get one client with all relations
// POST                  — create new client
// PUT    ?clientId=xxx  — update client fields
// DELETE ?clientId=xxx  — delete client

import { respond, corsHeaders } from './lib/supabase-client.js';

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_ANON_KEY;
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';

function sbHeaders() {
  return {
    'apikey': SB_KEY(),
    'Authorization': `Bearer ${SB_KEY()}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    headers: sbHeaders(),
    ...options,
  });
  if (!res.ok) throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Default budget categories for new clients
const DEFAULT_BUDGET_CATS = [
  { name:'Design & Planning',            total:0, spent:0, status:'pending', sort_order:1, sub_categories:[{name:'Surveying & Permits',total:0,spent:0},{name:'Interior Design',total:0,spent:0}]},
  { name:'Construction Costs',           total:0, spent:0, status:'pending', sort_order:2, sub_categories:[{name:'Foundation',total:0,spent:0},{name:'Framing',total:0,spent:0},{name:'Roofing',total:0,spent:0},{name:'Windows & Doors',total:0,spent:0},{name:'Exterior Siding & Masonry',total:0,spent:0}]},
  { name:'Mechanical Systems',           total:0, spent:0, status:'pending', sort_order:3, sub_categories:[{name:'Plumbing',total:0,spent:0},{name:'Electrical',total:0,spent:0},{name:'HVAC',total:0,spent:0},{name:'Insulation',total:0,spent:0}]},
  { name:'Interior Finishes',            total:0, spent:0, status:'pending', sort_order:4, sub_categories:[{name:'Drywall',total:0,spent:0},{name:'Paint & Staining',total:0,spent:0},{name:'Flooring',total:0,spent:0},{name:'Cabinetry',total:0,spent:0},{name:'Countertops',total:0,spent:0},{name:'Trim Work & Moldings',total:0,spent:0},{name:'Appliances',total:0,spent:0}]},
  { name:'Exterior Work',                total:0, spent:0, status:'pending', sort_order:5, sub_categories:[{name:'Dirt & Grading',total:0,spent:0},{name:'Rock & Concrete',total:0,spent:0},{name:'Final Grade & Landscaping',total:0,spent:0}]},
  { name:'Utilities & Hookups',          total:0, spent:0, status:'pending', sort_order:6, sub_categories:[{name:'Water & Sewer Lines',total:0,spent:0},{name:'Septic System',total:0,spent:0},{name:'Water Meter',total:0,spent:0},{name:'Utility Trenching',total:0,spent:0},{name:'Gas Connection',total:0,spent:0},{name:'Electrical Connection',total:0,spent:0}]},
  { name:'Miscellaneous',                total:0, spent:0, status:'pending', sort_order:7, sub_categories:[{name:'Contingency Fund',total:0,spent:0}]},
  { name:'Other Costs & Management Fee', total:0, spent:0, status:'pending', sort_order:8, sub_categories:[{name:'Temp Utilities',total:0,spent:0},{name:'Dumpsters & Toilet',total:0,spent:0},{name:'Site Clean Up & Builders Risk',total:0,spent:0},{name:'Six Arrows Management Fee',total:0,spent:0}]},
];

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // Basic admin auth check
  const authHeader = event.headers?.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (token !== ADMIN_PASSWORD()) {
    return respond(401, { error: 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};

  // ── GET: list all or fetch one ─────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      if (params.all === '1') {
        const clients = await sbFetch('clients?select=*&order=client_name.asc');
        return respond(200, { clients: clients || [] });
      }

      if (params.clientId) {
        const clientId = params.clientId;
        const [client, budgetCats, changeOrders, milestones, updates, decisions] = await Promise.all([
          sbFetch(`clients?id=eq.${clientId}&select=*`).then(r => r?.[0]),
          sbFetch(`budget_categories?client_id=eq.${clientId}&order=sort_order.asc`),
          sbFetch(`change_orders?client_id=eq.${clientId}&order=created_at.desc`),
          sbFetch(`milestones?client_id=eq.${clientId}&order=sort_order.asc`),
          sbFetch(`updates?client_id=eq.${clientId}&approved=eq.true&order=created_at.desc`),
          sbFetch(`decisions?client_id=eq.${clientId}&order=sort_order.asc`),
        ]);
        if (!client) return respond(404, { error: 'Client not found' });
        return respond(200, { ...client, budgetCategories: budgetCats || [], changeOrderItems: changeOrders || [], timeline: milestones || [], updates: updates || [], decisions: decisions || [] });
      }

      return respond(400, { error: 'Specify ?all=1 or ?clientId=xxx' });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── POST: create new client ─────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body || '{}');
      const id = data.id || data.client_name?.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
      if (!id || !data.email || !data.password || !data.client_name) {
        return respond(400, { error: 'id, email, password, and client_name required' });
      }
      const newClient = {
        id,
        email:                  data.email,
        password:               data.password,
        client_name:            data.client_name,
        project_name:           data.project_name || 'Custom Home',
        location:               data.location || 'Bowling Green, KY',
        status_type:            data.status_type || 'sab',
        phase_label:            data.phase_label || 'Phase 1 — Design & Architecture',
        notion_tracker_page_id: data.notion_tracker_page_id || null,
        selections_client_key:  data.selections_client_key || id,
        quick_summary:          data.quick_summary || 'Welcome to your Six Arrows client portal.',
        team_lead:              data.team_lead || 'Cole Borders',
        team_phone:             data.team_phone || '(270) 782-5388',
        team_email:             data.team_email || 'cole@sixarrowsconstruction.com',
      };

      const created = await sbFetch('clients', {
        method: 'POST',
        body: JSON.stringify(newClient),
      });

      // Create default budget categories
      const budgetRows = DEFAULT_BUDGET_CATS.map(cat => ({ ...cat, client_id: id }));
      await sbFetch('budget_categories', {
        method: 'POST',
        body: JSON.stringify(budgetRows),
        headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
      }).catch(() => {}); // Non-fatal

      return respond(201, { success: true, client: created?.[0] || newClient });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── PUT: update client fields ───────────────────────────────
  if (event.httpMethod === 'PUT') {
    const clientId = params.clientId;
    if (!clientId) return respond(400, { error: 'clientId required' });
    try {
      const updates = JSON.parse(event.body || '{}');
      const result = await sbFetch(`clients?id=eq.${clientId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
      });
      return respond(200, { success: true, client: result?.[0] });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // ── DELETE: remove client ───────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const clientId = params.clientId;
    if (!clientId) return respond(400, { error: 'clientId required' });
    try {
      await sbFetch(`clients?id=eq.${clientId}`, { method: 'DELETE' });
      return respond(200, { success: true });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed' });
};
