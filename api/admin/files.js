// /api/admin/files — admin only. Photos/files a client attached to their submission.
//   GET  ?id=<submission id>                         → short-lived links to view/download
//   POST { action: 'delete', id, paths: [...] }      → permanently deletes those files from storage
//   POST { action: 'delete', id, all: true }         → permanently deletes every file of the order
'use strict';

const { requireAdmin, rest, storage, readJson, send, handle, allowMethods, HttpError } = require('../_lib/supabase');

const BUCKET = 'submission-files';

async function loadRow(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid submission id');
  const rows = await rest(`submissions?id=eq.${id}&select=id,ref,payload`);
  if (!rows || !rows[0]) throw new HttpError(404, 'Submission not found');
  const row = rows[0];
  const list = Array.isArray(row.payload && row.payload.attachments) ? row.payload.attachments : [];
  return { row, files: list.filter((a) => a && typeof a.path === 'string' && a.path.startsWith(`${id}/`)) };
}

// Lists every object stored under the order's folder (catches stray uploads too).
async function listFolder(id) {
  const r = await storage(`object/list/${BUCKET}`, { method: 'POST', body: { prefix: id, limit: 1000, offset: 0 } });
  return r.ok && Array.isArray(r.data) ? r.data.filter((o) => o && o.id && o.name).map((o) => `${id}/${o.name}`) : [];
}

async function removeObjects(paths) {
  if (!paths.length) return;
  const r = await storage(`object/${BUCKET}`, { method: 'DELETE', body: { prefixes: paths } });
  if (!r.ok) throw new HttpError(502, 'Could not delete the files from storage — please try again');
}

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  const admin = await requireAdmin(req);

  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
    const { files } = await loadRow(id);
    if (!files.length) return send(res, 200, { ok: true, files: [] }, { 'Cache-Control': 'no-store' });
    const base = `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1`;
    const r = await storage(`object/sign/${BUCKET}`, { method: 'POST', body: { expiresIn: 3600, paths: files.map((f) => f.path) } });
    const signed = new Map((Array.isArray(r.data) ? r.data : []).filter((s) => s && s.signedURL).map((s) => [s.path, `${base}${s.signedURL}`]));
    return send(res, 200, {
      ok: true,
      files: files.map((f) => ({
        path: f.path, name: f.name, type: f.type, size: f.size, uploaded_at: f.uploaded_at,
        url: signed.get(f.path) || null,
      })),
    }, { 'Cache-Control': 'no-store' });
  }

  const body = await readJson(req, 20 * 1024);
  if (body.action !== 'delete') throw new HttpError(400, 'Unknown action');
  const id = String(body.id || '');
  const { row, files } = await loadRow(id);

  let targets;
  if (body.all === true) {
    targets = Array.from(new Set([...files.map((f) => f.path), ...(await listFolder(id))]));
  } else {
    const want = new Set((Array.isArray(body.paths) ? body.paths : []).map(String));
    targets = files.map((f) => f.path).filter((p) => want.has(p));
  }
  if (!targets.length) throw new HttpError(400, 'No files selected');

  await removeObjects(targets);

  const gone = new Set(targets);
  const removed = files.filter((f) => gone.has(f.path));
  const remaining = files.filter((f) => !gone.has(f.path));
  await rest(`submissions?id=eq.${id}`, {
    method: 'PATCH',
    body: { payload: { ...(row.payload || {}), attachments: remaining } },
    prefer: 'return=minimal',
  });
  const freed = removed.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const names = removed.map((f) => f.name).slice(0, 15);
  // Best effort: history + activity log entries.
  await rest('submission_events', {
    method: 'POST',
    body: { submission_id: id, type: 'files_deleted', detail: { count: removed.length, names, bytes: freed }, actor: admin.email },
    prefer: 'return=minimal',
  }).catch(() => {});
  await rest('activity_log', {
    method: 'POST',
    body: { actor: admin.email, action: 'deleted', entity: 'submission', entity_id: id, summary: `Deleted ${removed.length} photo${removed.length === 1 ? '' : 's'} from ${row.ref}` },
    prefer: 'return=minimal',
  }).catch(() => {});

  send(res, 200, { ok: true, deleted: removed.length, remaining: remaining.length, freed_bytes: freed }, { 'Cache-Control': 'no-store' });
});
