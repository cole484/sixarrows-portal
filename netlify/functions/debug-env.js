// netlify/functions/debug-env.js
// Temporary — confirms environment variables are set correctly
// DELETE THIS after confirming everything works

export const handler = async (event) => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      SUPABASE_URL:      process.env.SUPABASE_URL ? '✓ SET' : '✗ MISSING',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? '✓ SET' : '✗ MISSING',
      NOTION_TOKEN:      process.env.NOTION_TOKEN ? '✓ SET' : '✗ MISSING',
      SAB_CUSTOMERS_DB_ID: process.env.SAB_CUSTOMERS_DB_ID ? '✓ SET' : '✗ MISSING',
      ADMIN_PASSWORD:    process.env.ADMIN_PASSWORD ? '✓ SET' : '✗ MISSING',
      NODE_ENV:          process.env.NODE_ENV || 'not set',
    }),
  };
};
