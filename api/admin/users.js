// /api/admin/users — admin only. Manages LOGIN ACCOUNTS for allowlisted emails.
// (The allowlist itself is edited from the Admin Access page and enforced by the database.)
//   GET                                              → allowlist + whether each email has a login
//   POST { action: 'create', email, password }       → create a login for an allowlisted email
//   POST { action: 'set_password', email, password } → set a new password
//   POST { action: 'delete_login', email }           → remove a login (not your own)
'use strict';

const { requireAdmin, readJson, send, handle, allowMethods, HttpError, rest, authAdmin } = require('../_lib/supabase');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function checkPassword(pw) {
  const p = String(pw || '');
  if (p.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw new HttpError(400, 'Password must contain letters and numbers');
  if (p.length > 72) throw new HttpError(400, 'Password is too long');
  return p;
}

async function allUsers() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const data = await authAdmin(`users?page=${page}&per_page=200`);
    const users = data.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  const me = await requireAdmin(req);

  if (req.method === 'GET') {
    const [allow, users] = await Promise.all([
      rest('admin_allowlist?select=email,added_by,created_at&order=created_at.asc'),
      allUsers(),
    ]);
    const byEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
    return send(res, 200, {
      ok: true,
      me: me.email,
      admins: allow.map((a) => {
        const u = byEmail.get(a.email);
        return { ...a, has_login: Boolean(u), last_sign_in_at: u ? u.last_sign_in_at : null };
      }),
    }, { 'Cache-Control': 'no-store' });
  }

  const body = await readJson(req, 10 * 1024);
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email');

  const allowed = await rest(`admin_allowlist?email=eq.${encodeURIComponent(email)}&select=email`);
  const users = await allUsers();
  const user = users.find((u) => String(u.email || '').toLowerCase() === email);

  if (body.action === 'create') {
    if (!allowed.length) throw new HttpError(403, 'Add this email to the allowlist first');
    if (user) throw new HttpError(409, 'This email already has a login — use “Set password” instead');
    await authAdmin('users', { method: 'POST', body: { email, password: checkPassword(body.password), email_confirm: true } });
    return send(res, 201, { ok: true });
  }
  if (body.action === 'set_password') {
    if (!allowed.length) throw new HttpError(403, 'This email is not an admin');
    if (!user) throw new HttpError(404, 'No login exists for this email yet');
    await authAdmin(`users/${user.id}`, { method: 'PUT', body: { password: checkPassword(body.password) } });
    return send(res, 200, { ok: true });
  }
  if (body.action === 'delete_login') {
    if (email === me.email) throw new HttpError(400, 'You cannot delete your own login');
    if (!user) return send(res, 200, { ok: true });
    await authAdmin(`users/${user.id}`, { method: 'DELETE' });
    return send(res, 200, { ok: true });
  }
  throw new HttpError(400, 'Unknown action');
});
