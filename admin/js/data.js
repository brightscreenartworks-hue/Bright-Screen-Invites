// Data layer for the admin panel. Talks to Supabase (auth + database + storage) with the
// signed-in admin's session; every read/write is enforced by Row Level Security + the allowlist.
// Server-only operations (WhatsApp, thumbnails, admin logins) go through /api/* with the same token.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let sb = null;

function check({ data, error, count }) {
  if (error) throw new Error(error.message || 'Request failed');
  return count !== undefined && count !== null ? { data, count } : data;
}
const clean = (q) => String(q || '').replace(/[,()*%\\"]/g, ' ').trim();

async function api(path, { method = 'GET', body } = {}) {
  const { data } = await sb.auth.getSession();
  const token = data.session && data.session.access_token;
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

export const data = {
  // ------------------------------------------------------------ setup/auth
  async init() {
    const res = await fetch('/api/config', { cache: 'no-store' });
    const cfg = await res.json().catch(() => ({}));
    if (!cfg.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('The database is not connected yet. Add SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.');
    }
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bs-admin-auth' },
    });
  },
  async session() { return (await sb.auth.getSession()).data.session; },
  onAuth(cb) { return sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
  async signIn(email, password) {
    const { data: d, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Incorrect email or password.' : error.message);
    return d.session;
  },
  async signOut() { try { await sb.auth.signOut(); } catch { /* already signed out */ } },
  async isAdmin() { return check(await sb.rpc('is_admin')) === true; },
  async sendReset(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/` });
    if (error) throw new Error(error.message);
  },
  async updatePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },

  // ------------------------------------------------------------ categories
  async categories() {
    return check(await sb.from('categories').select('*').order('sort_order').order('name'));
  },
  async saveCategory(c) {
    const row = { ...c };
    delete row.created_at; delete row.updated_at;
    if (row.id) {
      const id = row.id; delete row.id;
      return check(await sb.from('categories').update(row).eq('id', id).select().single());
    }
    return check(await sb.from('categories').insert(row).select().single());
  },
  async deleteCategory(id) { check(await sb.from('categories').delete().eq('id', id)); },
  async reorder(table, ids) { check(await sb.rpc('reorder', { p_table: table, p_ids: ids })); },

  // ------------------------------------------------------------ samples
  async samples() {
    return check(await sb.from('samples').select('*').order('sort_order').order('uploaded_at', { ascending: false }));
  },
  async sample(id) { return check(await sb.from('samples').select('*').eq('id', id).single()); },
  async saveSample(s) {
    const row = { ...s };
    delete row.created_at; delete row.updated_at; delete row.created_by;
    if (row.id) {
      const id = row.id; delete row.id;
      return check(await sb.from('samples').update(row).eq('id', id).select().single());
    }
    return check(await sb.from('samples').insert(row).select().single());
  },
  async setSampleStatus(id, status) { check(await sb.from('samples').update({ status }).eq('id', id)); },
  async deleteSample(id) { check(await sb.from('samples').delete().eq('id', id)); },
  async uploadThumbnail(file) {
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[file.type];
    if (!ext) throw new Error('Please upload a JPG, PNG, WebP, GIF or AVIF image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
    const path = `custom/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('sample-thumbnails').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (error) throw new Error(error.message);
    return sb.storage.from('sample-thumbnails').getPublicUrl(path).data.publicUrl;
  },
  fetchThumbnail(url) { return api('/api/thumbnail', { method: 'POST', body: { url, persist: true } }); },

  // ------------------------------------------------------------ submissions
  async submissions({ search, status, category, from, to, wa, page = 1, pageSize = 25, all = false } = {}) {
    const query = () => {
      let q = sb.from('submissions').select('*', { count: 'exact' });
      const s = clean(search);
      if (s) q = q.or(['client_name', 'client_whatsapp', 'client_email', 'sample_name', 'ref', 'category'].map((c) => `${c}.ilike."%${s}%"`).join(','));
      if (status) q = q.eq('status', status);
      if (category) q = q.eq('category', category);
      if (wa) q = q.eq('whatsapp_status', wa);
      if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
      if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());
      return q.order('created_at', { ascending: false });
    };
    if (all) {
      const rows = [];
      for (let i = 0; i < 100; i++) {
        const { data: d, error } = await query().range(i * 1000, i * 1000 + 999);
        if (error) throw new Error(error.message);
        rows.push(...d);
        if (d.length < 1000) break;
      }
      return { rows, count: rows.length };
    }
    const r = check(await query().range((page - 1) * pageSize, page * pageSize - 1));
    return { rows: r.data, count: r.count };
  },
  async submission(id) {
    const [row, notes, events] = await Promise.all([
      sb.from('submissions').select('*').eq('id', id).maybeSingle(),
      sb.from('submission_notes').select('*').eq('submission_id', id).order('created_at'),
      sb.from('submission_events').select('*').eq('submission_id', id).order('created_at'),
    ]);
    return { row: check(row), notes: check(notes), events: check(events) };
  },
  async submissionCategories() {
    const rows = check(await sb.from('submissions').select('category').not('category', 'is', null).limit(2000));
    return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  },
  async setSubmissionStatus(id, status) { check(await sb.from('submissions').update({ status }).eq('id', id)); },
  async addNote(id, body) { return check(await sb.from('submission_notes').insert({ submission_id: id, body }).select().single()); },
  async deleteSubmission(id) { check(await sb.from('submissions').delete().eq('id', id)); },
  async deleteSubmissions(ids) { if (!ids.length) return; check(await sb.from('submissions').delete().in('id', ids)); },
  async trash() { return check(await sb.from('submissions_trash').select('id,data,deleted_by,deleted_at').order('deleted_at', { ascending: false })); },
  async restoreSubmission(id) { check(await sb.rpc('restore_submission', { p_id: id })); },
  async purgeTrash(id) { check(await sb.from('submissions_trash').delete().eq('id', id)); },
  deleteSubmissionFiles(id, { paths, all } = {}) { return api('/api/admin/files', { method: 'POST', body: { action: 'delete', id, paths, all: Boolean(all) } }); },
  submissionFiles(id) { return api(`/api/admin/files?id=${encodeURIComponent(id)}`); },
  resendWhatsApp(id) { return api('/api/admin/whatsapp', { method: 'POST', body: { action: 'resend', id } }); },

  // ------------------------------------------------------------ dashboard
  async stats() {
    const count = async (q) => check(await q).count || 0;
    const head = (t) => sb.from(t).select('id', { count: 'exact', head: true });
    const [samples, published, categories, subs, total, fresh, failed] = await Promise.all([
      count(head('samples')),
      count(head('samples').eq('status', 'published')),
      count(head('categories').is('parent_id', null)),
      count(head('categories').not('parent_id', 'is', null)),
      count(head('submissions')),
      count(head('submissions').eq('status', 'new')),
      count(head('submissions').eq('whatsapp_status', 'failed')),
    ]);
    return { samples, published, categories, subs, total, fresh, failed };
  },
  async activity(limit = 12) { return check(await sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit)); },
  async latestSamples(limit = 6) { return check(await sb.from('samples').select('*').order('created_at', { ascending: false }).limit(limit)); },
  async recentSubmissions(limit = 5) { return check(await sb.from('submissions').select('*').order('created_at', { ascending: false }).limit(limit)); },

  // ------------------------------------------------------------ settings
  async setting(key) {
    const row = check(await sb.from('settings').select('value').eq('key', key).maybeSingle());
    return (row && row.value) || {};
  },
  async saveSetting(key, value) {
    const { data: s } = await sb.auth.getSession();
    check(await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString(), updated_by: s.session && s.session.user.email }));
  },
  whatsappStatus() { return api('/api/admin/whatsapp'); },
  whatsappTest() { return api('/api/admin/whatsapp', { method: 'POST', body: { action: 'test' } }); },

  // ------------------------------------------------------------ admin access
  admins() { return api('/api/admin/users'); },
  async addAdmin(email) { check(await sb.from('admin_allowlist').insert({ email: email.trim().toLowerCase() })); },
  async removeAdmin(email) { check(await sb.from('admin_allowlist').delete().eq('email', email)); },
  createLogin(email, password) { return api('/api/admin/users', { method: 'POST', body: { action: 'create', email, password } }); },
  setPassword(email, password) { return api('/api/admin/users', { method: 'POST', body: { action: 'set_password', email, password } }); },
  deleteLogin(email) { return api('/api/admin/users', { method: 'POST', body: { action: 'delete_login', email } }); },

  // ------------------------------------------------------------ backup
  async backup() {
    const tables = ['categories', 'samples', 'submissions', 'submission_notes', 'submission_events', 'settings', 'admin_allowlist', 'submissions_trash'];
    const out = { exported_at: new Date().toISOString(), tables: {} };
    for (const t of tables) {
      const rows = [];
      for (let i = 0; i < 200; i++) {
        const { data: d, error } = await sb.from(t).select('*').range(i * 1000, i * 1000 + 999);
        if (error) throw new Error(`${t}: ${error.message}`);
        rows.push(...d);
        if (d.length < 1000) break;
      }
      out.tables[t] = rows;
    }
    return out;
  },
};
