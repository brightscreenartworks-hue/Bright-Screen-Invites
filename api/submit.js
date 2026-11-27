// POST /api/submit — called by the public website when a client submits details.
// 1) validates on the server, 2) saves permanently to the database (idempotent: no duplicates),
// 3) sends the details to the business WhatsApp. If WhatsApp fails the record is still saved.
'use strict';

const crypto = require('crypto');
const { rest, getSettings, readJson, send, handle, allowMethods, HttpError } = require('./_lib/supabase');
const { digits } = require('./_lib/whatsapp');
const { notifyOrder } = require('./_lib/notify');

const SOURCES = new Set(['fill-details', 'index-personalize', 'other']);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function str(v, max = 300) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

// Keep only plain JSON data, bounded in size and depth.
function cleanPayload(value, depth = 0) {
  if (depth > 4) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === 'string') return str(value, 4000);
  if (Array.isArray(value)) return value.slice(0, 60).map((v) => cleanPayload(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 80)) {
      const key = str(k, 60);
      if (key && !key.startsWith('__')) out[key] = cleanPayload(v, depth + 1);
    }
    return out;
  }
  return null;
}

function buildSummary(s) {
  const lines = [
    `💌 Design: ${s.sample_name || 'Custom request'}`,
    s.category ? `🗂 Category: ${s.category}` : '',
    s.sample_link ? `🔗 ${s.sample_link}` : '',
    '',
    `👤 ${s.client_name || '-'}`,
    `📱 ${s.client_whatsapp || '-'}`,
    s.client_email ? `✉️ ${s.client_email}` : '',
  ];
  const p = s.payload || {};
  const extra = ['bride', 'groom', 'eventDate', 'weddingDate', 'venue', 'city', 'eventsList', 'notes']
    .filter((k) => p[k]).map((k) => `• ${k}: ${p[k]}`);
  return lines.concat(extra.length ? ['', ...extra] : []).filter((l, i, a) => l || a[i - 1]).join('\n');
}

function siteOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `https://${host}` : '';
}

async function deliver(req, row, settings) {
  const header = `🆕 *New client submission* · ${row.ref}`;
  const link = settings.include_admin_link !== false && siteOrigin(req)
    ? `\n\n🔐 Admin: ${siteOrigin(req)}/admin/#/submissions/${row.id}` : '';
  const text = `${header}\n\n${row.summary_text || buildSummary(row)}${link}`;
  const subject = `New order ${row.ref}: ${row.client_name || 'Client'}${row.sample_name ? ` (${row.sample_name})` : ''}`;
  // Email + WhatsApp (whichever are configured). Status is 'sent' when any channel delivered.
  const result = await notifyOrder(settings, subject, text.replace(/\*/g, ''));
  const patch = {
    whatsapp_status: result.status,
    whatsapp_error: result.error || null,
    whatsapp_attempts: (row.whatsapp_attempts || 0) + 1,
    ...(result.status === 'sent' ? { whatsapp_sent_at: new Date().toISOString() } : {}),
  };
  try {
    await rest(`submissions?id=eq.${row.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  } catch (e) {
    console.error('[submit] could not record alert status', e.message);
  }
  return result.status;
}

module.exports = handle(async (req, res) => {
  allowMethods(req, ['POST']);
  const body = await readJson(req, 150 * 1024);

  // Honeypot: real visitors never fill this hidden field.
  if (str(body.website || body.company_site)) {
    return send(res, 200, { ok: true, ref: null }, { 'Cache-Control': 'no-store' });
  }

  const client = body.client && typeof body.client === 'object' ? body.client : {};
  const record = {
    source: SOURCES.has(body.source) ? body.source : 'other',
    category: str(body.category, 120) || null,
    sample_name: str(body.sample_name, 300) || null,
    sample_link: str(body.sample_link, 1000) || null,
    client_name: str(client.name, 120) || null,
    client_whatsapp: str(client.whatsapp, 32) || null,
    client_email: str(client.email, 200).toLowerCase() || null,
    payload: cleanPayload(body.payload && typeof body.payload === 'object' ? body.payload : {}) || {},
    summary_text: str(body.summary_text, 8000) || null,
    user_agent: str(req.headers['user-agent'], 300) || null,
  };

  // Never lose a lead: the website's own form decides which fields are required.
  // Only a completely empty submission is refused.
  const couple = (record.payload && record.payload.couple) || {};
  const p = record.payload || {};
  const hasSomething = record.client_name || record.client_whatsapp || record.client_email ||
    couple.brideName || couple.groomName || p.bride || p.groom || p.fullName ||
    (Array.isArray(p.events) && p.events.length) || p.notes;
  if (!hasSomething) throw new HttpError(400, 'Please fill in your details before submitting');
  // Odd-looking contact details are kept (so nothing is lost) but noted for the admin.
  const warnings = [];
  if (record.client_whatsapp) {
    const d = digits(record.client_whatsapp);
    if (d.length < 7 || d.length > 15) warnings.push('WhatsApp number looks invalid');
  }
  if (record.client_email && !EMAIL_RE.test(record.client_email)) warnings.push('Email looks invalid');
  if (warnings.length) record.payload = { ...record.payload, _checks: warnings };
  if (!record.client_name) record.client_name = couple.brideName && couple.groomName
    ? `${couple.brideName} & ${couple.groomName}` : (couple.brideName || couple.groomName || p.fullName || null);
  if (record.sample_link && !/^https?:\/\//i.test(record.sample_link)) record.sample_link = null;
  if (JSON.stringify(record.payload).length > 120000) throw new HttpError(413, 'Submission is too large');

  // Idempotency: the browser sends a key derived from the form content, so double clicks,
  // retries and re-submitting identical details never create duplicates.
  let key = str(body.idempotency_key, 128);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    key = 'srv_' + crypto.createHash('sha256')
      .update(JSON.stringify([record.client_name, record.client_whatsapp, record.sample_name, record.payload]))
      .digest('hex').slice(0, 40);
  }
  record.idempotency_key = key;

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  record.ip_hash = ip
    ? crypto.createHash('sha256').update(ip + (process.env.SUBMIT_SALT || 'bright-screen')).digest('hex').slice(0, 32)
    : null;

  // Basic abuse protection: at most 15 submissions per 10 minutes from one connection.
  if (record.ip_hash) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await rest(`submissions?select=id&ip_hash=eq.${record.ip_hash}&created_at=gte.${encodeURIComponent(since)}&limit=16`);
    if (Array.isArray(recent) && recent.length >= 15) {
      throw new HttpError(429, 'Too many submissions — please try again in a few minutes');
    }
  }

  const inserted = await rest('submissions?on_conflict=idempotency_key', {
    method: 'POST',
    body: record,
    prefer: 'return=representation,resolution=ignore-duplicates',
  });

  let row = Array.isArray(inserted) && inserted[0];
  let duplicate = false;
  if (!row) {
    duplicate = true;
    const existing = await rest(`submissions?idempotency_key=eq.${encodeURIComponent(key)}&select=*`);
    row = existing && existing[0];
    if (!row) throw new HttpError(500, 'Could not save submission');
  }

  // The record is saved at this point. WhatsApp is best-effort and never loses the record.
  let whatsapp = row.whatsapp_status;
  const retryable = duplicate && whatsapp !== 'sent' && whatsapp !== 'disabled' && (row.whatsapp_attempts || 0) < 3;
  if (!duplicate || retryable) {
    let settings = {};
    try { settings = await getSettings('whatsapp'); } catch (e) { console.error('[submit] settings', e.message); }
    whatsapp = await deliver(req, row, settings);
  }

  send(res, duplicate ? 200 : 201, { ok: true, ref: row.ref, duplicate, whatsapp }, { 'Cache-Control': 'no-store' });
});

module.exports._test = { cleanPayload, buildSummary, str };
module.exports.deliver = deliver;
