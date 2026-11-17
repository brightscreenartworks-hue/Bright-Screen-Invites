#!/usr/bin/env node
// One-time setup: adds your admin emails to the allowlist and creates their logins.
//
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   ADMIN_EMAILS="first@gmail.com,second@gmail.com,third@gmail.com" \
//   node scripts/setup-admins.mjs
//
// You'll be asked to type a password for each email (min 10 chars, letters + numbers).
// Passwords are sent straight to Supabase Auth, which stores only a bcrypt hash.
// Safe to re-run: existing allowlist entries/logins are left as they are.
import readline from 'node:readline';

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const emails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
if (!url || !key || !emails.length) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_EMAILS first (see the comment at the top of this file).');
  process.exit(1);
}
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

function ask(question, hidden = true) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const existing = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: H })).json();
const known = new Set((existing.users || []).map((u) => String(u.email).toLowerCase()));

for (const email of emails) {
  const r = await fetch(`${url}/rest/v1/admin_allowlist?on_conflict=email`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ email, added_by: 'setup' }),
  });
  if (!r.ok) { console.error(`✗ allowlist ${email}:`, await r.text()); continue; }
  console.log(`✓ ${email} is on the allowlist`);
  if (known.has(email)) { console.log(`  (login already exists — skipped)`); continue; }
  let pw = '';
  while (!(pw.length >= 10 && /[A-Za-z]/.test(pw) && /\d/.test(pw))) {
    pw = await ask(`  Password for ${email} (min 10 chars, letters+numbers): `);
  }
  const c = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, email_confirm: true }),
  });
  console.log(c.ok ? `  ✓ login created` : `  ✗ could not create login: ${await c.text()}`);
}
console.log('\nDone. Sign in at https://<your-site>/admin/');
