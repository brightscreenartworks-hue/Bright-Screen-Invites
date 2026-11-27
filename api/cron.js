// GET /api/cron — run automatically by Vercel once a day (see vercel.json "crons").
// 1) Touches the database so the free Supabase project never pauses for inactivity.
// 2) Re-sends order alerts that failed or never went out (up to 6 attempts, last 14 days).
'use strict';

const { rest, getSettings, send, handle, allowMethods, HttpError } = require('./_lib/supabase');
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
  send(res, 200, { ok: true, db: Array.isArray(settingsRow), retried: results }, { 'Cache-Control': 'no-store' });
});
