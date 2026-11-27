// POST /api/upload — lets the client attach caricature photos (and other files) to the
// submission they just sent. Files go straight from the browser to private Supabase Storage
// through one-time signed upload URLs, so large photos never pass through this function.
//
//   { action: 'sign', ref, key, files: [{ name, type, size }] } → { uploads: [{ name, path, url }] }
//   { action: 'done', ref, key, paths: [...] }                   → records the files on the submission
//
// `key` is the submission's idempotency key, which only the browser that submitted it knows.
'use strict';

const crypto = require('crypto');
const { rest, storage, readJson, send, handle, allowMethods, HttpError } = require('./_lib/supabase');
const { notifyOrder } = require('./_lib/notify');

const BUCKET = 'submission-files';
const MAX_FILES = 15;
const MAX_BYTES = 25 * 1024 * 1024;
const WINDOW_MS = 6 * 60 * 60 * 1000; // uploads allowed for 6 hours after submitting
const TYPE_OK = /^(image\/[a-z0-9.+-]+|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;
const EXT_OK = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|pdf|docx?)$/i;

function safeName(name) {
  const n = String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '');
  return (n || 'file').slice(-80);
}

async function findSubmission(ref, key) {
  if (!/^BS-[0-9A-Z-]{6,20}$/.test(String(ref || '')) || !key || String(key).length > 128) throw new HttpError(400, 'Invalid request');
  const rows = await rest(`submissions?ref=eq.${encodeURIComponent(ref)}&idempotency_key=eq.${encodeURIComponent(key)}&select=id,ref,client_name,sample_name,payload,created_at`);
  const row = rows && rows[0];
  if (!row) throw new HttpError(404, 'Submission not found');
  if (Date.now() - new Date(row.created_at).getTime() > WINDOW_MS) throw new HttpError(403, 'Upload window has closed');
  return row;
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const got = await storage(`bucket/${BUCKET}`);
  if (!got.ok) {
    const made = await storage('bucket', { method: 'POST', body: { id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_BYTES } });
    if (!made.ok && !/exist/i.test(JSON.stringify(made.data || ''))) throw new HttpError(502, 'Could not prepare file storage');
  }
  bucketReady = true;
}

async function listFiles(id) {
  const r = await storage(`object/list/${BUCKET}`, { method: 'POST', body: { prefix: `${id}`, limit: 100, offset: 0 } });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.filter((o) => o && o.name && o.id);
}

module.exports = handle(async (req, res) => {
  allowMethods(req, ['POST']);
  const body = await readJson(req, 20 * 1024);
  const row = await findSubmission(body.ref, body.key);

  if (body.action === 'sign') {
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
    if (!files.length) throw new HttpError(400, 'No files');
    const existing = Array.isArray(row.payload && row.payload.attachments) ? row.payload.attachments.length : 0;
    if (existing + files.length > MAX_FILES) throw new HttpError(400, `Up to ${MAX_FILES} files per order`);
    await ensureBucket();
    const uploads = [];
    for (const f of files) {
      const name = String(f.name || '');
      const type = String(f.type || '');
      const size = Number(f.size) || 0;
      if (size <= 0 || size > MAX_BYTES) { uploads.push({ name, error: 'File is larger than 25 MB' }); continue; }
      if (!TYPE_OK.test(type) && !EXT_OK.test(name)) { uploads.push({ name, error: 'Unsupported file type' }); continue; }
      const tag = crypto.createHash('sha1').update(`${name}|${size}`).digest('hex').slice(0, 8);
      const path = `${row.id}/${tag}-${safeName(name)}`;
      const r = await storage(`object/upload/sign/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'x-upsert': 'true' } });
      const rel = r.ok && r.data && (r.data.url || r.data.signedURL);
      if (!rel) { uploads.push({ name, error: 'Could not prepare upload' }); continue; }
      uploads.push({ name, path, url: `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1${rel}` });
    }
    return send(res, 200, { ok: true, uploads }, { 'Cache-Control': 'no-store' });
  }

  if (body.action === 'done') {
    const wanted = new Set((Array.isArray(body.paths) ? body.paths : []).map(String).filter((p) => p.startsWith(`${row.id}/`)));
    const stored = await listFiles(row.id);
    const prev = Array.isArray(row.payload && row.payload.attachments) ? row.payload.attachments : [];
    const byPath = new Map(prev.map((a) => [a.path, a]));
    let added = 0;
    for (const o of stored) {
      const path = `${row.id}/${o.name}`;
      if (!wanted.has(path) && !byPath.has(path)) continue;
      if (!byPath.has(path)) added += 1;
      byPath.set(path, {
        path,
        name: o.name.replace(/^[0-9a-f]{8}-/, ''),
        type: (o.metadata && o.metadata.mimetype) || '',
        size: (o.metadata && o.metadata.size) || 0,
        uploaded_at: o.created_at || new Date().toISOString(),
      });
    }
    const attachments = Array.from(byPath.values()).slice(0, MAX_FILES);
    await rest(`submissions?id=eq.${row.id}`, {
      method: 'PATCH',
      body: { payload: { ...(row.payload || {}), attachments } },
      prefer: 'return=minimal',
    });
    if (added) {
      const site = (process.env.SITE_URL || 'https://brightscreeninvites.vercel.app').replace(/\/+$/, '');
      const text = `📎 ${added} photo${added === 1 ? '' : 's'} received for ${row.ref} (${row.client_name || 'client'}).\n\nOpen: ${site}/admin/#/submissions/${row.id}`;
      // Push/email only (WhatsApp off here, to avoid a second WhatsApp message per order).
      await notifyOrder({ enabled: false }, `Photos for ${row.ref}: ${row.client_name || 'Client'}`, text).catch(() => {});
    }
    return send(res, 200, { ok: true, count: attachments.length }, { 'Cache-Control': 'no-store' });
  }

  throw new HttpError(400, 'Unknown action');
});
