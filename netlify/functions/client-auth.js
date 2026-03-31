// netlify/functions/client-auth.js
// Handles login verification and client data fetching from Supabase
// POST /login     — verifies email/password, returns client record
// GET  /client    — returns full client data by id

import { supabase, respond, corsHeaders } from './lib/supabase-client.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // ── GET: fetch full client record ──────────────────────────
  if (event.httpMethod === 'GET') {
    const clientId = event.queryStringParameters?.clientId;
    if (!clientId) return respond(400, { error: 'clientId required' });

    try {
      const client = await supabase('clients', {
        filters: [{ col: 'id', op: 'eq', val: clientId }],
        single: true,
      });
      if (!client) return respond(404, { error: 'Client not found' });

      // Fetch related data in parallel
      const [budgetCats, changeOrders, milestones, updates, decisions] = await Promise.all([
        supabase('budget_categories', {
          filters: [{ col: 'client_id', op: 'eq', val: clientId }],
          order: 'sort_order.asc',
        }),
        supabase('change_orders', {
          filters: [{ col: 'client_id', op: 'eq', val: clientId }],
          order: 'created_at.desc',
        }),
        supabase('milestones', {
          filters: [{ col: 'client_id', op: 'eq', val: clientId }],
          order: 'sort_order.asc',
        }),
        supabase('updates', {
          filters: [{ col: 'client_id', op: 'eq', val: clientId }],
          order: 'created_at.desc',
          limit: 20,
        }),
        supabase('decisions', {
          filters: [{ col: 'client_id', op: 'eq', val: clientId }],
          order: 'sort_order.asc',
        }),
      ]);

      return respond(200, {
        ...client,
        budgetCategories:  budgetCats  || [],
        changeOrderItems:  changeOrders || [],
        timeline:          milestones  || [],
        updates:           updates     || [],
        decisions:         decisions   || [],
      });
    } catch (err) {
      console.error('client-auth GET error:', err);
      return respond(500, { error: err.message });
    }
  }

  // ── POST: login verification ────────────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const { email, password } = JSON.parse(event.body || '{}');
      if (!email || !password) return respond(400, { error: 'email and password required' });

      const client = await supabase('clients', {
        filters: [
          { col: 'email', op: 'ilike', val: email.trim() },
          { col: 'password', op: 'eq', val: password },
        ],
        single: true,
      });

      if (!client) return respond(401, { error: 'Invalid email or password' });

      // Return lightweight session token (just client id for now)
      return respond(200, { success: true, clientId: client.id, clientName: client.client_name });
    } catch (err) {
      console.error('client-auth POST error:', err);
      return respond(500, { error: err.message });
    }
  }

  return respond(405, { error: 'Method not allowed' });
};
