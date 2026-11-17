// Settings: own password, session timeout, admin limit, backups, recovery bin.
import { html, icon, toast, errMsg, fmtDate, download, confirmDialog } from '../ui.js';

export async function render(ctx) {
  ctx.setTitle('Settings', 'System');
  let [general, trash] = await Promise.all([ctx.data.setting('general'), ctx.data.trash()]);
  if (!ctx.isCurrent()) return;
  const g = { max_admins: 3, idle_timeout_minutes: 120, ...general };

  const paint = () => {
    ctx.el.innerHTML = String(html`
      <div class="grid-2" style="align-items:start">
        <div class="stack">
          <form class="card" id="pwForm"><div class="card-h"><h2>Your password</h2></div><div class="card-b">
            <p class="small muted" style="margin-top:0">Signed in as <strong>${ctx.me.email}</strong></p>
            <label class="field"><span class="label">New password</span><input class="input" type="password" name="p1" autocomplete="new-password" required></label>
            <label class="field"><span class="label">Repeat new password</span><input class="input" type="password" name="p2" autocomplete="new-password" required></label>
            <div class="hint">At least 10 characters with letters and numbers.</div>
            <button class="btn primary" style="margin-top:14px" type="submit">Update password</button></div></form>

          <form class="card" id="secForm"><div class="card-h"><h2>Security</h2></div><div class="card-b">
            <label class="field"><span class="label">Sign out after inactivity (minutes)</span>
              <input class="input" type="number" name="idle" min="10" max="1440" value="${g.idle_timeout_minutes}"></label>
            <label class="field"><span class="label">Maximum number of admins</span>
              <input class="input" type="number" name="max" min="1" max="10" value="${g.max_admins}"></label>
            <button class="btn primary" style="margin-top:14px" type="submit">Save</button></div></form>
        </div>

        <div class="stack">
          <div class="card"><div class="card-h"><h2>Backup & recovery</h2></div><div class="card-b">
            <p class="small muted" style="margin-top:0">Download a complete copy of samples, categories, submissions (with notes & history), settings and the admin list. Keep a copy somewhere safe (e.g. Google Drive) — monthly is a good habit.</p>
            <button class="btn" id="backupBtn">${icon('download')} Download full backup (JSON)</button>
            <p class="small muted" style="margin-bottom:0">Client submissions are never deleted automatically. Manually deleted ones go to the recovery bin below.</p>
          </div></div>

          <div class="card"><div class="card-h"><h2>Recovery bin</h2><span class="spacer"></span><span class="pill plain grey">${trash.length}</span></div>
            ${trash.length ? html`<div class="table-wrap"><table class="tbl"><tbody>${trash.map((t) => html`<tr data-id="${t.id}">
              <td><strong>${t.data.client_name || 'Client'}</strong><div class="small muted">${t.data.ref} · deleted ${fmtDate(t.deleted_at)}${t.deleted_by ? ` by ${t.deleted_by}` : ''}</div></td>
              <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-act="restore">${icon('refresh')} Restore</button>
                <button class="btn sm danger" data-act="purge" title="Delete forever">${icon('trash')}</button></div></td></tr>`)}</tbody></table></div>`
              : html`<div class="empty-state">The recovery bin is empty.</div>`}
          </div>
        </div>
      </div>`);
    bind();
  };

  function bind() {
    const el = ctx.el;
    el.querySelector('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const p = f.p1.value;
      if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return toast('Use at least 10 characters with letters and numbers.', 'err');
      if (p !== f.p2.value) return toast('Passwords do not match.', 'err');
      try { await ctx.data.updatePassword(p); f.reset(); toast('Password updated', 'ok'); } catch (er) { toast(errMsg(er), 'err'); }
    });
    el.querySelector('#secForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const idle = Math.min(1440, Math.max(10, Number(e.target.idle.value) || 120));
      const max = Math.min(10, Math.max(1, Number(e.target.max.value) || 3));
      try { Object.assign(g, { idle_timeout_minutes: idle, max_admins: max }); await ctx.data.saveSetting('general', g); toast('Saved — the inactivity timeout applies from your next sign-in', 'ok'); }
      catch (er) { toast(errMsg(er), 'err'); }
    });
    el.querySelector('#backupBtn').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const data = await ctx.data.backup();
        download(`bright-screen-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
        const n = Object.values(data.tables).reduce((a, t) => a + t.length, 0);
        toast(`Backup downloaded (${n} records)`, 'ok');
      } catch (er) { toast(errMsg(er), 'err'); }
      b.disabled = false;
    });
    el.querySelectorAll('tr[data-id] [data-act]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('tr').dataset.id;
      try {
        if (b.dataset.act === 'restore') {
          await ctx.data.restoreSubmission(id);
          toast('Submission restored', 'ok');
          ctx.refreshCounts();
        } else {
          const ok = await confirmDialog({ title: 'Delete forever?', message: 'This permanently erases the submission, its notes and history. This cannot be undone.', confirm: 'Delete forever', danger: true, typeToConfirm: 'DELETE' });
          if (!ok) return;
          await ctx.data.purgeTrash(id);
          toast('Deleted permanently', 'ok');
        }
        trash = await ctx.data.trash();
        paint();
      } catch (er) { toast(errMsg(er), 'err'); }
    }));
  }
  paint();
}
