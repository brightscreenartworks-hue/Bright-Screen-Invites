// Admin Access: the email allowlist (enforced in the database) + login accounts for those emails.
import { html, icon, toast, modal, confirmDialog, errMsg, fmtDate, timeAgo, initials } from '../ui.js';

function passwordDialog(title, email) {
  return modal({
    title,
    body: String(html`<form id="pwForm"><p class="small muted" style="margin-top:0">For <strong>${email}</strong>. Share it privately; they can change it later in Settings.</p>
      <label class="field"><span class="label">Password</span><input class="input" type="password" name="p1" autocomplete="new-password" minlength="10" required></label>
      <label class="field"><span class="label">Repeat password</span><input class="input" type="password" name="p2" autocomplete="new-password" required></label>
      <div class="hint">At least 10 characters with letters and numbers. Stored only as a secure hash by Supabase Auth.</div>
      <p class="small" data-err style="color:var(--red)"></p></form>`),
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Save password', kind: 'primary',
        handler: (root) => {
          const f = root.querySelector('#pwForm');
          const p = f.p1.value;
          const err = (m) => { root.querySelector('[data-err]').textContent = m; return false; };
          if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return err('Use at least 10 characters with letters and numbers.');
          if (p !== f.p2.value) return err('Passwords do not match.');
          return p;
        },
      },
    ],
  });
}

export async function render(ctx) {
  ctx.setTitle('Admin Access', 'System');
  let [info, general] = await Promise.all([ctx.data.admins(), ctx.data.setting('general')]);
  if (!ctx.isCurrent()) return;
  const max = Number(general.max_admins) || 3;

  const paint = () => {
    const admins = info.admins || [];
    ctx.el.innerHTML = String(html`
      <div class="alert info">🛡️ <span>Only the emails below can sign in. Access is checked by the database on every request, so removing an email takes effect immediately. Public registration is disabled.</span></div>
      <div class="card">
        <div class="card-h"><h2>Authorized admins</h2><span class="pill plain grey">${admins.length} / ${max}</span><span class="spacer"></span>
          <button class="btn primary sm" id="addBtn" ${admins.length >= max ? 'disabled title="Admin limit reached — raise it in Settings"' : ''}>${icon('plus')} Add admin email</button></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Admin</th><th>Login</th><th class="hide-sm">Last sign-in</th><th class="hide-sm">Added</th><th></th></tr></thead>
          <tbody>${admins.map((a) => html`<tr data-email="${a.email}">
            <td><div class="row" style="flex-wrap:nowrap"><div class="avatar">${initials(a.email)}</div><div><strong>${a.email}</strong>${a.email === info.me ? html` <span class="pill plain pink">You</span>` : ''}</div></div></td>
            <td>${a.has_login ? html`<span class="pill green">Active</span>` : html`<span class="pill amber">No login yet</span>`}</td>
            <td class="hide-sm">${a.last_sign_in_at ? timeAgo(a.last_sign_in_at) : '—'}</td>
            <td class="hide-sm small muted">${fmtDate(a.created_at, false)}${a.added_by ? ` · ${a.added_by}` : ''}</td>
            <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
              ${a.has_login ? html`<button class="btn sm" data-act="password">${icon('key')} <span class="hide-sm">Set password</span></button>`
                : html`<button class="btn sm primary" data-act="create">${icon('key')} Create login</button>`}
              ${a.email !== info.me ? html`<button class="btn sm danger" data-act="remove" title="Remove access">${icon('trash')}</button>` : ''}
            </div></td></tr>`)}</tbody></table></div>
      </div>`);
    ctx.el.querySelector('#addBtn').addEventListener('click', add);
    ctx.el.querySelectorAll('tr[data-email] [data-act]').forEach((b) => b.addEventListener('click', () => act(b.closest('tr').dataset.email, b.dataset.act)));
  };

  const refresh = async () => { info = await ctx.data.admins(); paint(); };

  async function add() {
    const email = await modal({
      title: 'Add admin email',
      body: String(html`<form id="addForm"><label class="field"><span class="label">Gmail / email address</span><input class="input" type="email" name="email" required placeholder="name@gmail.com"></label>
        <div class="hint">After adding, click “Create login” to set their password.</div><p class="small" data-err style="color:var(--red)"></p></form>`),
      actions: [{ label: 'Cancel', value: null }, {
        label: 'Add', kind: 'primary',
        handler: (root) => {
          const v = root.querySelector('[name=email]').value.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { root.querySelector('[data-err]').textContent = 'Enter a valid email.'; return false; }
          return v;
        },
      }],
    });
    if (!email) return;
    try { await ctx.data.addAdmin(email); toast('Admin email added', 'ok'); await refresh(); } catch (e) { toast(errMsg(e), 'err'); }
  }

  async function act(email, a) {
    try {
      if (a === 'create') {
        const p = await passwordDialog('Create login', email);
        if (!p) return;
        await ctx.data.createLogin(email, p);
        toast('Login created', 'ok');
      } else if (a === 'password') {
        const p = await passwordDialog('Set new password', email);
        if (!p) return;
        await ctx.data.setPassword(email, p);
        toast('Password updated', 'ok');
      } else if (a === 'remove') {
        const ok = await confirmDialog({ title: 'Remove admin access?', message: `${email} will immediately lose access to the admin panel, and their login will be deleted.`, confirm: 'Remove access', danger: true });
        if (!ok) return;
        await ctx.data.removeAdmin(email);
        try { await ctx.data.deleteLogin(email); } catch { /* access is already revoked by the allowlist */ }
        toast('Access removed', 'ok');
      }
      await refresh();
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  paint();
}
