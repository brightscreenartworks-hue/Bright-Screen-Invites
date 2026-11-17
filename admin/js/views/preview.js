// "Preview on website": loads the REAL client page in a same-origin iframe and asks the page's
// own renderer (assets/bs-live.js) to show the draft card — so the preview is pixel-exact.
import { html, icon, modal, esc } from '../ui.js';

export function toCatalogCategories(cats) {
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  return cats.map((c) => ({
    id: c.id,
    parent: c.parent_id ? (byId[c.parent_id] || {}).slug || null : null,
    slug: c.slug,
    name: c.name,
    description: c.description,
    pageTitle: c.page_title,
    pageDescription: c.page_description,
    badge: c.badge,
    icon: c.icon,
    pageUrl: c.page_url,
    hash: c.hash || (c.parent_id ? c.slug : null),
    viewId: c.view_id || (c.parent_id ? `view-${c.slug}` : null),
    cardId: c.card_id || (c.parent_id ? `card-cat-${c.slug}` : null),
    thumbnail: c.custom_thumbnail_url,
    order: c.sort_order,
  }));
}

export function toCatalogSample(s, cats) {
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  return {
    id: s.id || 'draft-preview',
    domId: s.legacy_id || `sample-${String(s.id || 'draft').slice(0, 8)}`,
    category: (byId[s.category_id] || {}).slug,
    subcategory: s.subcategory_id ? (byId[s.subcategory_id] || {}).slug : null,
    title: s.title || 'Untitled sample',
    mediaUrl: s.media_url,
    provider: s.media_provider,
    shareUrl: s.share_url,
    thumbnail: s.custom_thumbnail_url || s.auto_thumbnail_url || '',
    fallbacks: s.thumbnail_fallbacks || [],
    alt: s.alt_text,
    vertical: !!s.vertical_thumb,
    fillLabel: s.fill_label,
    fillCategory: s.fill_category,
    linkTitle: s.link_title,
    tagTitle: s.tag_title,
    order: Number.isFinite(s.sort_order) ? s.sort_order : -1,
    uploadedAt: s.uploaded_at || new Date().toISOString(),
  };
}

export function pageFor(sample, cats) {
  const top = cats.find((c) => c.id === sample.category_id);
  if (!top) return null;
  const base = top.page_url || `collection.html?c=${encodeURIComponent(top.slug)}`;
  return `../${base}${base.includes('?') ? '&' : '?'}bs_preview=1`;
}

export function openPreview(sample, cats) {
  const url = pageFor(sample, cats);
  if (!url) return;
  const draft = toCatalogSample(sample, cats);
  const catalogCats = toCatalogCategories(cats);
  modal({
    title: `Preview · ${sample.title || 'Untitled'}`,
    size: 'xl',
    body: String(html`<div class="row between" style="margin:-4px 0 12px">
        <span class="small muted">This is the live client page with your card rendered exactly as visitors will see it${sample.status && sample.status !== 'published' ? ' (it is not public until you publish it)' : ''}.</span>
        <div class="segmented" role="group" aria-label="Device"><button type="button" class="on" data-dev="desktop">${icon('monitor')} Desktop</button><button type="button" data-dev="mobile">${icon('phone')} Mobile</button></div>
      </div>`),
    onMount(root) {
      const b = root.querySelector('.modal-b');
      b.style.display = 'flex'; b.style.flexDirection = 'column'; b.style.paddingBottom = '0';
      const stage = document.createElement('div');
      stage.className = 'preview-stage';
      stage.innerHTML = String(html`<iframe title="Website preview" src="${url}"></iframe>`);
      b.appendChild(stage);
      const frame = stage.querySelector('iframe');
      frame.addEventListener('load', () => {
        const tryRender = (n) => {
          const w = frame.contentWindow;
          if (w && w.BSLive) { w.BSLive.previewSample(draft, catalogCats); return; }
          if (n > 40) { stage.innerHTML = '<div class="empty-state">Could not load the page preview.</div>'; return; }
          setTimeout(() => tryRender(n + 1), 100);
        };
        tryRender(0);
      });
      root.querySelectorAll('[data-dev]').forEach((btn) => btn.addEventListener('click', () => {
        root.querySelectorAll('[data-dev]').forEach((x) => x.classList.toggle('on', x === btn));
        stage.classList.toggle('mobile', btn.dataset.dev === 'mobile');
      }));
    },
  });
  void esc;
}
