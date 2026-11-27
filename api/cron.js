// GET /api/cron — run automatically by Vercel once a day (see vercel.json "crons").
// 1) Touches the database so the free Supabase project never pauses for inactivity.
// 2) Re-sends order alerts that failed or never went out (up to 6 attempts, last 14 days).
// 3) Frees storage: deletes client photos whose order was permanently deleted (not in inbox or recovery bin).
'use strict';

const { rest, storage, getSettings, send, handle, allowMethods, HttpError } = require('./_lib/supabase');
const submit = require('./submit');

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET']);
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized');

  // 1) keep-alive: a real query against the database
  const settingsRow = await rest('settings?select=key&limit=1');

  // 2) retry undelivered alerts
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const pending = await rest(
    `submissions?select=*&whatsapp_status=in.(failed,pending)&whatsapp_attempts=lt.6&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=20`
  );
  let settings = {};
  try { settings = await getSettings('whatsapp'); } catch { /* defaults */ }
  const results = [];
  for (const row of pending || []) {
    try {
      results.push({ ref: row.ref, status: await submit.deliver(req, row, settings) });
    } catch (e) {
      results.push({ ref: row.ref, status: 'error', error: e.message });
    }
  }
  // 3) remove photos of orders that no longer exist anywhere
  let cleaned = 0;
  try {
    const root = await storage('object/list/submission-files', { method: 'POST', body: { prefix: '', limit: 200, offset: 0 } });
    const folders = (Array.isArray(root.data) ? root.data : []).filter((o) => o && !o.id && /^[0-9a-f-]{36}$/i.test(o.name)).map((o) => o.name);
    if (folders.length) {
      const list = folders.join(',');
      const live = await rest(`submissions?id=in.(${list})&select=id`);
      const binned = await rest(`submissions_trash?id=in.(${list})&select=id`);
      const keep = new Set([...(live || []), ...(binned || [])].map((r) => r.id));
      for (const id of folders.filter((f) => !keep.has(f)).slice(0, 20)) {
        const r = await storage('object/list/submission-files', { method: 'POST', body: { prefix: id, limit: 1000, offset: 0 } });
        const paths = (Array.isArray(r.data) ? r.data : []).filter((o) => o && o.id).map((o) => `${id}/${o.name}`);
        if (paths.length) {
          const del = await storage('object/submission-files', { method: 'DELETE', body: { prefixes: paths } });
          if (del.ok) cleaned += paths.length;
        }
      }
    }
  } catch { /* storage not set up yet */ }

  send(res, 200, { ok: true, db: Array.isArray(settingsRow), retried: results, orphan_files_deleted: cleaned }, { 'Cache-Control': 'no-store' });
});
