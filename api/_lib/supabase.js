// Server-only helpers. Never imported by browser code.
// Uses the Supabase REST API directly (no npm dependencies needed on Vercel).
'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY);
}

class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// PostgREST call with the service role (bypasses RLS — server only).
async function rest(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  if (!configured()) throw new HttpError(503, 'Database is not configured');
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    throw new HttpError(res.status >= 500 ? 502 : res.status, 'Database request failed',
      typeof data === 'object' && data ? data.message || data.hint : String(data).slice(0, 200));
  }
  return data;
}

async function getSettings(key) {
  const rows = await rest(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  return (rows && rows[0] && rows[0].value) || {};
}

// Verifies a Supabase access token AND that the email is on the allowlist.
async function requireAdmin(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Not signed in');
  if (!configured()) throw new HttpError(503, 'Database is not configured');
  const res = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(401, 'Session expired — please sign in again');
  const user = await res.json();
  const email = String(user.email || '').toLowerCase();
  if (!email) throw new HttpError(403, 'Not authorized');
  const rows = await rest(`admin_allowlist?email=eq.${encodeURIComponent(email)}&select=email`);
  if (!rows || !rows.length) throw new HttpError(403, 'Not authorized');
  return { id: user.id, email };
}

// Auth admin API (service role) — creating admin logins, resetting passwords.
async function authAdmin(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new HttpError(503, 'Database is not configured');
  const res = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 422 ? 400 : res.status, data.msg || data.message || 'Auth request failed');
  return data;
}

// Upload bytes to Supabase Storage (service role) and return the public URL.
async function uploadToStorage(bucket, objectPath, bytes, contentType) {
  if (!configured()) throw new HttpError(503, 'Database is not configured');
  const res = await fetchWithTimeout(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'Cache-Control': 'max-age=31536000',
    },
    body: bytes,
  }, 15000);
  if (!res.ok) throw new HttpError(502, 'Could not store thumbnail');
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

// Raw Supabase Storage API call with the service role (server only).
async function storage(path, { method = 'GET', body, headers = {} } = {}) {
  if (!configured()) throw new HttpError(503, 'Database is not configured');
  const res = await fetchWithTimeout(`${SUPABASE_URL}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, 15000);
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { ok: res.ok, status: res.status, data };
}

// ---- tiny request/response helpers ----
async function readJson(req, maxBytes = 200 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    if (req.body.length > maxBytes) throw new HttpError(413, 'Request too large');
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error('[api]', err && err.message, err && err.detail);
      send(res, status, { ok: false, error: err instanceof HttpError ? err.message : 'Server error' },
        { 'Cache-Control': 'no-store' });
    }
  };
}

function allowMethods(req, methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, 'Method not allowed');
}

module.exports = {
  SUPABASE_URL, ANON_KEY, configured, HttpError, fetchWithTimeout, rest, getSettings,
  requireAdmin, authAdmin, uploadToStorage, storage, readJson, send, handle, allowMethods,
};
