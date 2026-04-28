// netlify/functions/lookahead.js
// 8-week lookahead view — read endpoint for the admin Lookahead tab.
//
// GET ?projectId=xxx    — single project
// GET ?projectId=all    — all active projects (default)

import { respond, corsHeaders } from './lib/supabase-client.js';
import { computeProjectLookahead, computeAllLookaheads } from './lib/lookahead.js';

const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'sa_admin_2026';

function checkAuth(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === ADMIN_PASSWORD();
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (!checkAuth(event)) return respond(401, { error: 'Unauthorized' });
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  try {
    const params = event.queryStringParameters || {};
    const projectId = params.projectId;

    if (!projectId || projectId === 'all') {
      const data = await computeAllLookaheads();
      return respond(200, data);
    }

    const project = await computeProjectLookahead(projectId);
    if (!project) return respond(404, { error: 'Project not found' });
    return respond(200, { generated_at: new Date().toISOString(), horizon_days: 56, projects: [project] });
  } catch (err) {
    console.error('lookahead error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};
