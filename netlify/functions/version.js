// netlify/functions/version.js
//
// Answers one question: which commit is actually running.
//
// Exists because a deploy that silently does not publish is indistinguishable
// from a deploy that never ran, and chasing that difference by testing feature
// behaviour costs a round trip per guess. This is the cheap check.
export const handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({
    commit: process.env.COMMIT_REF || 'unknown',
    branch: process.env.BRANCH || 'unknown',
    builtAt: process.env.BUILD_ID || 'unknown',
    context: process.env.CONTEXT || 'unknown',
  }, null, 2),
});
