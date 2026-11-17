// /api/admin/whatsapp — admin only.
//   GET                          → which providers have credentials configured (never the secrets)
//   POST { action: 'test' }      → sends a test message with the saved settings
//   POST { action: 'resend', id } → re-sends a submission's details
'use strict';

const { requireAdmin, readJson, send, handle, allowMethods, HttpError, rest, getSettings } = require('../_lib/supabase');
const { sendWhatsApp, providerStatus } = require('../_lib/whatsapp');
const submit = require('../submit');

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  const admin = await requireAdmin(req);

  if (req.method === 'GET') {
    return send(res, 200, { ok: true, providers: providerStatus() }, { 'Cache-Control': 'no-store' });
  }

  const body = await readJson(req, 10 * 1024);
  const settings = await getSettings('whatsapp');

  if (body.action === 'test') {
    const result = await sendWhatsApp({ ...settings, enabled: true },
      `✅ Bright Screen Invites — test message\nSent from the Admin Panel by ${admin.email} at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`);
    return send(res, 200, { ok: result.status === 'sent', ...result }, { 'Cache-Control': 'no-store' });
  }

  if (body.action === 'resend') {
    const id = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid submission id');
    const rows = await rest(`submissions?id=eq.${id}&select=*`);
    if (!rows || !rows[0]) throw new HttpError(404, 'Submission not found');
    const status = await submit.deliver(req, rows[0], { ...settings, enabled: true });
    return send(res, 200, { ok: status === 'sent', status }, { 'Cache-Control': 'no-store' });
  }

  throw new HttpError(400, 'Unknown action');
});
