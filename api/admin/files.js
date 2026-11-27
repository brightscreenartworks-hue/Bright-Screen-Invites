// GET /api/admin/files?id=<submission id> — admin only.
// Returns short-lived links to the photos/files a client attached to their submission.
'use strict';

const { requireAdmin, rest, storage, send, handle, allowMethods, HttpError } = require('../_lib/supabase');

const BUCKET = 'submission-files';

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET']);
  await requireAdmin(req);
  const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid submission id');
  const rows = await rest(`submissions?id=eq.${id}&select=id,payload`);
  if (!rows || !rows[0]) throw new HttpError(404, 'Submission not found');
  const list = Array.isArray(rows[0].payload && rows[0].payload.attachments) ? rows[0].payload.attachments : [];
  const files = list.filter((a) => a && typeof a.path === 'string' && a.path.startsWith(`${id}/`));
  if (!files.length) return send(res, 200, { ok: true, files: [] }, { 'Cache-Control': 'no-store' });

  const base = `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1`;
  const r = await storage(`object/sign/${BUCKET}`, { method: 'POST', body: { expiresIn: 3600, paths: files.map((f) => f.path) } });
  const signed = new Map((Array.isArray(r.data) ? r.data : []).filter((s) => s && s.signedURL).map((s) => [s.path, `${base}${s.signedURL}`]));
  send(res, 200, {
    ok: true,
    files: files.map((f) => ({
      name: f.name, type: f.type, size: f.size, uploaded_at: f.uploaded_at,
      url: signed.get(f.path) || null,
    })),
  }, { 'Cache-Control': 'no-store' });
});
