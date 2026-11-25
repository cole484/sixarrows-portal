// portal/lib/admin-auth.js
// Shared admin login for admin.html and visual-selections.html.
//
// The pages hold no password. The admin types it once, the server checks
// it (admin-clients?ping=1 against the ADMIN_PASSWORD env var), and it is
// kept in sessionStorage for the tab so it can be sent as the Bearer token.
// Classic script: exposes window.SAAdminAuth so module pages can use it too.
(function () {
  const KEY = 'sa_admin_auth';
  const FN = '/.netlify/functions';

  function stored() {
    try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function store(pw) {
    try { sessionStorage.setItem(KEY, pw); } catch (e) { /* private mode */ }
  }
  function clear() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }
  function header(pw) {
    return { 'Authorization': 'Bearer ' + (pw == null ? stored() : pw) };
  }

  // Resolves { ok: true } or { ok: false, wrongPassword, message }.
  async function verify(pw) {
    if (!pw) return { ok: false, wrongPassword: true, message: 'Enter the admin password.' };
    let res;
    try {
      res = await fetch(FN + '/admin-clients?ping=1', { headers: header(pw) });
    } catch (e) {
      return { ok: false, wrongPassword: false, message: 'Could not reach the server. Check your connection and try again.' };
    }
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, wrongPassword: true, message: 'Incorrect password.' };
    const body = await res.json().catch(() => null);
    return { ok: false, wrongPassword: false, message: (body && body.error) || ('Server error ' + res.status) };
  }

  // Verify, and keep the password for this tab only if it was right.
  async function login(pw) {
    const r = await verify(pw);
    if (r.ok) store(pw);
    return r;
  }

  // Re-check a stored password on page load, so a rotated password
  // sends stale tabs back to the login form. Clears it only on a 401;
  // a network blip should not log the admin out.
  async function resume() {
    const pw = stored();
    if (!pw) return { ok: false, wrongPassword: true, message: '' };
    const r = await verify(pw);
    if (!r.ok && r.wrongPassword) clear();
    return r;
  }

  window.SAAdminAuth = { stored, clear, header, verify, login, resume };
})();
