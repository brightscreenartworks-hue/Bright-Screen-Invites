// Server-side order alerts. Runs on Vercel (always on), so alerts arrive even when
// your own phone/computer is off. Channels:
//   • Email    — to NOTIFY_EMAIL (Vercel env var). Uses Resend if RESEND_API_KEY is set,
//                otherwise the free FormSubmit relay (one-time "Activate" email the first time).
//   • WhatsApp — via ./whatsapp.js when enabled in Admin → WhatsApp Settings and a provider key exists.
'use strict';

const { fetchWithTimeout } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

function siteUrl() {
  return (process.env.SITE_URL || 'https://brightscreeninvites.vercel.app').replace(/\/+$/, '');
}

async function sendEmail(subject, text) {
  const to = (process.env.NOTIFY_EMAIL || '').trim();
  if (!to) return { status: 'disabled' };
  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'Bright Screen Orders <onboarding@resend.dev>',
          to: to.split(',').map((s) => s.trim()).filter(Boolean),
          subject,
          text,
        }),
      }, 12000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend: ${data.message || res.status}`);
      return { status: 'sent', provider: 'resend' };
    }
    // FormSubmit relay (no account needed). Origin/Referer must be your website.
    const res = await fetchWithTimeout(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: siteUrl(),
        Referer: `${siteUrl()}/fill-details.html`,
      },
      body: JSON.stringify({ _subject: subject, _template: 'box', _captcha: 'false', Order: text }),
    }, 12000);
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && String(data.success) === 'true';
    if (!ok) throw new Error(`Email relay: ${(data.message || res.status).toString().slice(0, 200)}`);
    return { status: 'sent', provider: 'formsubmit' };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'Email relay timed out' : String((err && err.message) || err);
    return { status: 'failed', error: msg.slice(0, 300) };
  }
}

/**
 * Sends the order alert on every configured channel.
 * Returns { status: 'sent'|'failed'|'disabled', error?, channels: {...} } — 'sent' if ANY channel delivered.
 */
async function notifyOrder(waSettings, subject, text) {
  const [email, whatsapp] = await Promise.all([
    sendEmail(subject, text),
    sendWhatsApp(waSettings, text),
  ]);
  const channels = { email, whatsapp };
  const results = [email, whatsapp];
  if (results.some((r) => r.status === 'sent')) {
    const failed = results.filter((r) => r.status === 'failed').map((r) => r.error);
    return { status: 'sent', error: failed.length ? `Partly failed: ${failed.join(' | ')}` : null, channels };
  }
  if (results.every((r) => r.status === 'disabled')) return { status: 'disabled', error: null, channels };
  return { status: 'failed', error: results.filter((r) => r.error).map((r) => r.error).join(' | ').slice(0, 300), channels };
}

module.exports = { notifyOrder, sendEmail };
