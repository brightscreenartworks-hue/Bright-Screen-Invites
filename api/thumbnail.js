// POST /api/thumbnail  { url, persist? }  — admin only.
// Finds a preview image for a media link (YouTube, Vimeo, Instagram, Google Photos, websites…).
// With persist=true, non-YouTube images are copied into Supabase Storage so they never expire
// (Instagram/Facebook image links stop working after a few days).
'use strict';

const crypto = require('crypto');
const { requireAdmin, readJson, send, handle, allowMethods, HttpError, fetchWithTimeout, uploadToStorage } = require('./_lib/supabase');
const { providerOf, youtubeId, isPublicHttpUrl, metaImage, metaTitle } = require('./_lib/media');

const UA_CRAWLER = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url, ua) {
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': ua, Accept: 'text/html,*/*' }, redirect: 'follow' }, 9000);
  if (!res.ok) return null;
  if (!isPublicHttpUrl(res.url || url)) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) return null;
  const text = await res.text();
  return { html: text.slice(0, 600000), finalUrl: res.url || url };
}

async function persistImage(imageUrl, sourceUrl) {
  if (!isPublicHttpUrl(imageUrl)) return null;
  const res = await fetchWithTimeout(imageUrl, { headers: { 'User-Agent': UA_BROWSER } }, 10000);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024 || buf.length < 200) return null;
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[type];
  const name = `auto/${crypto.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 20)}.${ext}`;
  return uploadToStorage('sample-thumbnails', name, buf, type);
}

module.exports = handle(async (req, res) => {
  allowMethods(req, ['POST']);
  await requireAdmin(req);
  const body = await readJson(req, 10 * 1024);
  const url = String(body.url || '').trim();
  if (!isPublicHttpUrl(url)) throw new HttpError(400, 'Please enter a valid public https:// link');
  const provider = providerOf(url);
  const out = { ok: true, provider, thumbnail: null, fallbacks: [], vertical: false, title: null, persisted: false };

  if (provider === 'youtube') {
    const id = youtubeId(url);
    if (!id) throw new HttpError(400, 'Could not read the YouTube video id from this link');
    out.thumbnail = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    out.fallbacks = [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
    out.vertical = /\/shorts\//.test(url);
    return send(res, 200, out, { 'Cache-Control': 'no-store' });
  }

  if (provider === 'image') {
    out.thumbnail = url;
  } else if (provider === 'vimeo') {
    try {
      const r = await fetchWithTimeout(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}&width=1280`, {}, 8000);
      if (r.ok) {
        const d = await r.json();
        out.thumbnail = d.thumbnail_url || null;
        out.title = d.title || null;
        out.vertical = d.height > d.width;
      }
    } catch { /* fall through */ }
  } else {
    // Instagram / Facebook only show preview tags to link-preview crawlers.
    const ua = ['instagram', 'facebook'].includes(provider) ? UA_CRAWLER : UA_BROWSER;
    let page = null;
    try { page = await fetchHtml(url, ua); } catch { page = null; }
    if (!page && ua === UA_CRAWLER) {
      try { page = await fetchHtml(url, UA_BROWSER); } catch { page = null; }
    }
    if (page) {
      out.thumbnail = metaImage(page.html, page.finalUrl);
      out.title = metaTitle(page.html);
    }
    out.vertical = provider === 'instagram' && /\/reels?\//.test(url);
  }

  if (out.thumbnail && body.persist) {
    try {
      const stored = await persistImage(out.thumbnail, url);
      if (stored) { out.thumbnail = stored; out.persisted = true; }
    } catch (e) {
      console.error('[thumbnail] persist failed', e.message);
    }
  }
  if (!out.thumbnail) {
    out.message = provider === 'instagram'
      ? 'Instagram did not share a preview image for this link. Please upload a custom thumbnail.'
      : 'No preview image was found for this link. Please upload a custom thumbnail.';
  }
  send(res, 200, out, { 'Cache-Control': 'no-store' });
});
