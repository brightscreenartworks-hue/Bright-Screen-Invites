// Small UI toolkit for the admin panel (no framework, no build step).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s == null ? '' : s));
function fmt(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}
/** Auto-escaping template tag. Nested html`` results are inserted as-is. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ''); });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegated event helper: on(root, 'click', '[data-act]', (e, el) => …) */
export function on(root, type, selector, fn) {
  const h = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

// ------------------------------------------------------------------ icons
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  samples: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  categories: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.4L3 20.5l1.6-5.3A8.4 8.4 0 1 1 21 11.5z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/>',
};
export const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);

// ------------------------------------------------------------------ toast
export function toast(msg, kind = 'info', ms = 3200) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms);
  setTimeout(() => t.remove(), ms + 350);
}

// ------------------------------------------------------------------ modal
/**
 * modal({ title, body, size, actions:[{label, kind, value}], onMount }) → Promise<value|null>
 * Use close(value) inside onMount handlers to resolve programmatically.
 */
export function modal({ title, body = '', size = '', actions = [], onMount, dismissable = true } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = String(html`
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-h"><h3>${title}</h3><span class="spacer"></span>
          <button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-b">${raw(body)}</div>
        ${actions.length ? html`<div class="modal-f">${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-i="${i}" type="button">${a.label}</button>`)}</div>` : ''}
      </div>`);
    const prevFocus = document.activeElement;
    let done = false;
    const close = (val = null) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      bg.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg && dismissable) close(null); });
    bg.querySelector('[data-close]').addEventListener('click', () => close(null));
    bg.querySelectorAll('.modal-f [data-i]').forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.handler) {
        b.disabled = true;
        try {
          const r = await a.handler(bg);
          if (r !== false) close(r === undefined ? a.value : r);
        } finally { b.disabled = false; }
      } else close(a.value);
    }));
    document.body.appendChild(bg);
    const first = bg.querySelector('input, select, textarea, .modal-f .btn.primary, .modal-f .btn.danger');
    if (first) setTimeout(() => first.focus(), 30);
    if (onMount) onMount(bg, close);
  });
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirm = 'Confirm', danger = false, typeToConfirm = '' } = {}) {
  const body = String(html`<p style="margin:0 0 6px">${message}</p>
    ${typeToConfirm ? html`<label class="field" style="margin-top:14px"><span class="label">Type <strong>${typeToConfirm}</strong> to confirm</span>
      <input class="input" data-typed autocomplete="off"></label>` : ''}`);
  return modal({
    title, body,
    actions: [
      { label: 'Cancel', value: false },
      {
        label: confirm, kind: danger ? 'danger solid' : 'primary',
        handler: (root) => {
          if (!typeToConfirm) return true;
          const v = root.querySelector('[data-typed]').value.trim();
          if (v !== typeToConfirm) { root.querySelector('[data-typed]').classList.add('invalid'); return false; }
          return true;
        },
      },
    ],
  }).then((v) => v === true);
}

// ------------------------------------------------------------------ format
export function fmtDate(d, withTime = true) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}
export function timeAgo(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d, false);
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const initials = (email) => String(email || '?').slice(0, 2).toUpperCase();

export const STATUS = {
  new: { label: 'New', cls: 'pink' },
  in_progress: { label: 'In Progress', cls: 'blue' },
  completed: { label: 'Completed', cls: 'green' },
  archived: { label: 'Archived', cls: 'grey' },
};
export const SAMPLE_STATUS = {
  published: { label: 'Published', cls: 'green' },
  hidden: { label: 'Hidden', cls: 'grey' },
  draft: { label: 'Draft', cls: 'amber' },
};
export const WA_STATUS = {
  sent: { label: 'WhatsApp sent', cls: 'green' },
  failed: { label: 'WhatsApp failed', cls: 'red' },
  pending: { label: 'WhatsApp pending', cls: 'amber' },
  disabled: { label: 'WhatsApp off', cls: 'grey' },
};
export const statusPill = (map, key) => { const s = map[key] || { label: key, cls: 'grey' }; return html`<span class="pill ${s.cls}">${s.label}</span>`; };

// ------------------------------------------------------------------ media
export function providerOf(url) {
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
export const PROVIDER_LABEL = {
  youtube: 'YouTube', instagram: 'Instagram', vimeo: 'Vimeo', google_photos: 'Google Photos', google_drive: 'Google Drive',
  facebook: 'Facebook', pinterest: 'Pinterest', website: 'Website', image: 'Image', other: 'Link',
};
export function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[2] : null;
  } catch { return null; }
}
/** Resolves a thumbnail path that may be relative to the site root (e.g. "Thumbnails/x.jpg"). */
export const siteUrl = (src) => (!src ? '' : /^(https?:|data:|blob:)/.test(src) ? src : `../${String(src).replace(/^\/+/, '')}`);

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toCsv(rows, cols) {
  const q = (v) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  return '﻿' + [cols.map((c) => q(c.label)).join(','), ...rows.map((r) => cols.map((c) => q(c.get(r))).join(','))].join('\r\n');
}
export function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong');
  if (/row-level security|permission denied|not authorized/i.test(m)) return 'You are not authorized to do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Network error — check your connection and try again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}
