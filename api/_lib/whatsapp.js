// Server-side WhatsApp delivery. Credentials come ONLY from environment variables.
// Supported providers:
//   callmebot — free; sends to your own WhatsApp number   (env: CALLMEBOT_API_KEY)
//   meta      — official WhatsApp Cloud API               (env: META_WA_TOKEN, META_WA_PHONE_NUMBER_ID,
//                                                           optional META_WA_TEMPLATE, META_WA_TEMPLATE_LANG)
//   twilio    — Twilio WhatsApp                           (env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)
'use strict';

const { fetchWithTimeout } = require('./supabase');

const MAX_LEN = 3500;

function digits(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

function providerStatus() {
  return {
    callmebot: Boolean(process.env.CALLMEBOT_API_KEY),
    meta: Boolean(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_NUMBER_ID),
    twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM),
  };
}

function clip(text) {
  const t = String(text || '');
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN - 40) + '\n…(full details in the admin panel)' : t;
}

async function sendCallMeBot(to, text) {
  const key = process.env.CALLMEBOT_API_KEY;
  if (!key) throw new Error('CALLMEBOT_API_KEY is not set');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+' + to)}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetchWithTimeout(url, {}, 12000);
  const body = await res.text();
  const failed = !res.ok || (/error|invalid|not\s+allowed/i.test(body) && !/queued|will be sent|message sent/i.test(body));
  if (failed) {
    throw new Error(`CallMeBot: ${res.status} ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  }
  return { provider: 'callmebot' };
}

async function sendMeta(to, text) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID are not set');
  const template = process.env.META_WA_TEMPLATE;
  // Business-initiated messages need an approved template; template params may not contain newlines.
  const body = template
    ? {
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: template,
          language: { code: process.env.META_WA_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').replace(/ {4,}/g, ' ').slice(0, 1000) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } };
  const res = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 12000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta: ${(data.error && data.error.message) || res.status}`);
  return { provider: 'meta', id: data.messages && data.messages[0] && data.messages[0].id };
}

async function sendTwilio(to, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !tok || !from) throw new Error('Twilio environment variables are not set');
  const form = new URLSearchParams({ From: `whatsapp:+${digits(from)}`, To: `whatsapp:+${to}`, Body: text.slice(0, 1600) });
  const res = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }, 12000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio: ${data.message || res.status}`);
  return { provider: 'twilio', id: data.sid };
}

/**
 * Sends a WhatsApp message using the settings row (provider, destination, enabled).
 * Never throws: returns { status: 'sent' | 'failed' | 'disabled', error? }.
 */
async function sendWhatsApp(settings, text) {
  const cfg = settings || {};
  if (cfg.enabled === false) return { status: 'disabled' };
  const to = digits(cfg.destination || process.env.WHATSAPP_DESTINATION);
  if (to.length < 8) return { status: 'failed', error: 'No destination WhatsApp number configured' };
  const provider = cfg.provider || process.env.WHATSAPP_PROVIDER || 'callmebot';
  const message = clip(text);
  try {
    let r;
    if (provider === 'meta') r = await sendMeta(to, message);
    else if (provider === 'twilio') r = await sendTwilio(to, message);
    else r = await sendCallMeBot(to, message);
    return { status: 'sent', ...r };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'WhatsApp provider timed out' : String((err && err.message) || err);
    return { status: 'failed', error: msg.slice(0, 300) };
  }
}

module.exports = { sendWhatsApp, providerStatus, digits };
