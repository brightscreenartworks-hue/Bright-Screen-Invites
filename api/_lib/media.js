// Media link helpers shared by the thumbnail endpoint (server side).
'use strict';

function providerOf(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return 'other'; }
  if (h.includes('youtube.com') || h === 'youtu.be') return 'youtube';
  if (h.includes('instagram.com')) return 'instagram';
  if (h.includes('vimeo.com')) return 'vimeo';
  if (h.startsWith('photos.google') || h === 'photos.app.goo.gl') return 'google_photos';
  if (h === 'drive.google.com') return 'google_drive';
  if (h.includes('facebook.com') || h === 'fb.watch') return 'facebook';
  if (h.includes('pinterest.') || h === 'pin.it') return 'pinterest';
  if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) return 'image';
  return 'website';
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[2] : null;
  } catch { return null; }
}

function isPublicHttpUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.port && !['80', '443'].includes(u.port)) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  if (h.startsWith('[') || h.includes(':')) return false; // no raw IPv6
  return true;
}

function metaImage(html, baseUrl) {
  const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const raw =
    pick(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i) ||
    pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i) ||
    pick(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
  if (!raw) return null;
  const decoded = raw.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');
  try { return new URL(decoded, baseUrl).toString(); } catch { return null; }
}

function metaTitle(html) {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : null;
}

module.exports = { providerOf, youtubeId, isPublicHttpUrl, metaImage, metaTitle };
