/*!
 * Bright Screen Invites — live catalog (connects the client site to the Admin Panel)
 *
 * Loads published categories & samples from /api/catalog and renders them with the
 * EXACT same markup/classes the hand-written pages already use. If the API is
 * unreachable for any reason, the page simply keeps its existing static content,
 * so the website can never break because of the admin backend.
 *
 * Usage (end of <body>, after the page's own <script>):
 *   <script src="assets/bs-live.js" data-page="video-invites"></script>
 *   data-page: index | video-invites | website-invites | static-invites | itinerary-stationery | collection
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var PAGE = (script && script.getAttribute('data-page')) || 'index';
  var API = (script && script.getAttribute('data-api')) || '/api/catalog';
  var params = new URLSearchParams(window.location.search);
  var PREVIEW = params.has('bs_preview');
  var TOP_SLUG = PAGE === 'collection' ? (params.get('c') || '') : PAGE;

  // Existing grids on the flat pages.
  var FLAT_GRIDS = { 'static-invites': '#static-grid', 'itinerary-stationery': '#itinerary-grid' };
  // Legacy hash aliases that the original routers accepted.
  var HASH_ALIASES = { 'north-indian-wedding-invites': 'northindian' };

  var state = { data: null, live: false, draft: null };

  // ------------------------------------------------------------------ utils
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    if (/^(javascript|data|vbscript):/i.test(s)) return '';
    return s;
  }
  function byOrder(a, b) {
    return (a.order || 0) - (b.order || 0) || String(a.name || a.title).localeCompare(String(b.name || b.title));
  }
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); });
    } else {
      setTimeout(fn, 0);
    }
  }

  var PLAY_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var EDIT_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">\n' +
    '                  <path d="M12 20h9"></path>\n' +
    '                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>\n' +
    '                </svg>';
  var SHARE_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">\n' +
    '                  <circle cx="18" cy="5" r="3"></circle>\n' +
    '                  <circle cx="6" cy="12" r="3"></circle>\n' +
    '                  <circle cx="18" cy="19" r="3"></circle>\n' +
    '                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>\n' +
    '                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>\n' +
    '                </svg>';

  function defaultTitles(s) {
    var t = s.title;
    switch (s.provider) {
      case 'youtube': return ['Watch on YouTube (Opens in new tab)', 'Tap to Preview on YouTube'];
      case 'instagram': return ['View ' + t + ' on Instagram', 'Tap to Preview on Instagram'];
      case 'google_photos': return ['View ' + t + ' on Google Photos', 'Tap to Preview Design on Google Photos'];
      case 'vimeo': return ['Watch on Vimeo (Opens in new tab)', 'Tap to Preview on Vimeo'];
      default: return ['Preview ' + t + ' (Opens in new tab)', 'Tap to Preview'];
    }
  }

  // Image fallback chain (replaces the inline onerror the static cards used).
  function imgFallback(img) {
    var list = [];
    try { list = JSON.parse(img.getAttribute('data-fallbacks') || '[]'); } catch (e) { list = []; }
    var i = Number(img.getAttribute('data-fb-index') || 0);
    if (i < list.length) {
      img.setAttribute('data-fb-index', String(i + 1));
      img.src = list[i];
    } else {
      img.onerror = null;
    }
  }

  function fallbacksFor(s) {
    var fb = (s.fallbacks || []).slice();
    var m = /i\.ytimg\.com\/vi\/([^/]+)\/maxresdefault\.jpg/.exec(s.thumbnail || '');
    if (m && !fb.length) fb.push('https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg');
    return fb;
  }

  function imgAttrs(src, alt, vertical, fallbacks) {
    var cls = 'gig-thumb-img' + (vertical ? ' yt-shorts-thumb' : '');
    var fb = fallbacks && fallbacks.length
      ? ' data-fallbacks="' + esc(JSON.stringify(fallbacks)) + '" onerror="BSLive.imgFallback(this)"' : '';
    return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" class="' + cls + '"' + fb + '>';
  }

  // ------------------------------------------------------- card renderers
  function renderSampleCard(s, top) {
    var titles = defaultTitles(s);
    var media = safeUrl(s.mediaUrl) || safeUrl(s.thumbnail) || '#';
    var share = safeUrl(s.shareUrl) || media;
    var fillName = s.fillLabel || s.title;
    var fillCat = s.fillCategory || (top && top.name) || '';
    var fillHref = 'fill-details.html?sample=' + encodeURIComponent(fillName) +
      '&cat=' + encodeURIComponent(fillCat) +
      (share && share !== '#' ? '&link=' + encodeURIComponent(share) : '');
    var date = s.uploadedAt ? ' data-upload-date="' + esc(s.uploadedAt) + '"' : '';
    return '' +
      '<div class="gig-card sample-gig-card"' + date + ' id="' + esc(s.domId || ('sample-' + String(s.id).slice(0, 8))) + '" data-bs-id="' + esc(s.id) + '">\n' +
      '            <a href="' + esc(media) + '" target="_blank" rel="noopener noreferrer" class="gig-thumb-wrap" title="' + esc(s.linkTitle || titles[0]) + '">\n' +
      '              ' + imgAttrs(s.thumbnail, s.alt || s.title, s.vertical, fallbacksFor(s)) + '\n' +
      '            </a>\n' +
      '            <div class="gig-card-body sample-card-body">\n' +
      '              <h3 class="gig-category-name">' + esc(s.title) + '</h3>\n' +
      '              <a href="' + esc(media) + '" target="_blank" rel="noopener noreferrer" class="sample-tag-line" title="' + esc(s.tagTitle || titles[1]) + '">' + PLAY_SVG + ' Tap to Preview</a>\n' +
      '              <div class="card-actions-row">\n' +
      '                <a href="' + esc(fillHref) + '" target="_blank" rel="noopener noreferrer" class="btn-fill-details" title="Fill Details for ' + esc(s.title) + '">\n' +
      '                ' + EDIT_SVG + '\n' +
      '                  Fill Details\n' +
      '                </a>\n' +
      '                <button type="button" class="action-share-btn" onclick="handleShare(this)" data-share-title="' + esc(s.title) + '" data-share-url="' + esc(share) + '" title="Share this sample">\n' +
      '                ' + SHARE_SVG + '\n' +
      '                  Share\n' +
      '                </button>\n' +
      '              </div>\n' +
      '            </div>\n' +
      '          </div>';
  }

  function samplesOf(topSlug, subSlug) {
    var list = (state.data.samples || []).filter(function (s) {
      return s.category === topSlug && (s.subcategory || null) === (subSlug || null);
    });
    if (state.draft && state.draft.category === topSlug && (state.draft.subcategory || null) === (subSlug || null)) {
      list = list.filter(function (s) { return s.id !== state.draft.id; });
      list.push(state.draft);
    }
    return list.sort(byOrder);
  }

  function subsOf(topSlug) {
    return (state.data.categories || []).filter(function (c) { return c.parent === topSlug; }).sort(byOrder);
  }

  function topBySlug(slug) {
    return (state.data.categories || []).filter(function (c) { return !c.parent && c.slug === slug; })[0] || null;
  }

  // Category thumbnail = custom thumbnail, else the first (newest) sample's thumbnail —
  // the same behaviour the pages had with their "sync thumbnail" scripts.
  function thumbFor(cat, topSlug) {
    if (cat.thumbnail) return { src: cat.thumbnail, vertical: false, fallbacks: [] };
    var first = null;
    if (cat.parent) {
      first = samplesOf(topSlug, cat.slug)[0];
    } else {
      first = samplesOf(cat.slug, null)[0];
      if (!first) {
        var subs = subsOf(cat.slug);
        for (var i = 0; i < subs.length && !first; i++) first = samplesOf(cat.slug, subs[i].slug)[0];
      }
    }
    if (!first) return { src: '', vertical: false, fallbacks: [] };
    return {
      src: first.thumbnail,
      vertical: !!first.vertical || /ytimg\.com/.test(first.thumbnail || ''),
      fallbacks: fallbacksFor(first),
    };
  }

  function renderSubCard(sub, top) {
    var t = thumbFor(sub, top.slug);
    return '' +
      '<a href="#' + esc(sub.hash || sub.slug) + '" class="gig-card" onclick="BSLive.open(\'' + esc(sub.slug) + '\'); return false;" id="' + esc(sub.cardId || ('card-cat-' + sub.slug)) + '" title="Explore ' + esc(sub.name) + '">\n' +
      '            <div class="gig-thumb-wrap">\n' +
      '              ' + imgAttrs(t.src, sub.name, t.vertical, t.fallbacks) + '\n' +
      '            </div>\n' +
      '            <div class="gig-card-body">\n' +
      '              <h3 class="gig-category-name">' + esc(sub.name) + '</h3>\n' +
      '              <span class="sample-tag-line">' + PLAY_SVG + ' Tap to preview</span>\n' +
      (sub.badge ? '              <span class="gig-badge-count">' + esc(sub.badge) + '</span>\n' : '') +
      '            </div>\n' +
      '          </a>';
  }

  function newGrid(html, id) {
    var g = document.createElement('div');
    g.className = 'category-grid';
    if (id) g.id = id;
    g.innerHTML = html;
    return g;
  }

  // Replace a grid node (not just its children) so the pages' old date-sorting
  // MutationObservers stay attached to the detached node and never re-sort admin order.
  function swapGrid(oldGrid, html) {
    var g = newGrid(html, oldGrid.id);
    oldGrid.parentNode.replaceChild(g, oldGrid);
    return g;
  }

  function injectStyles() {
    if (document.getElementById('bs-live-styles')) return;
    var st = document.createElement('style');
    st.id = 'bs-live-styles';
    st.textContent =
      '.bs-subsection{margin-top:34px}' +
      '.bs-sub-title{font-family:"Playfair Display",serif;font-size:1.5rem;margin:0 0 4px}' +
      '.bs-sub-desc{color:var(--muted,#7a6b70);font-size:.92rem;margin:0}' +
      '.bs-empty{grid-column:1/-1;text-align:center;padding:40px 16px;color:var(--muted,#7a6b70)}' +
      '.bs-preview-highlight{outline:3px solid #E31C6E;outline-offset:4px;border-radius:12px;animation:bsPulse 1.6s ease 2}' +
      '@keyframes bsPulse{50%{outline-color:rgba(227,28,110,.25)}}';
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------ index page
  function applyIndex() {
    if (typeof MAIN_SERVICES === 'undefined' || typeof renderGallery !== 'function') return;
    var tops = (state.data.categories || []).filter(function (c) { return !c.parent; }).sort(byOrder);
    if (!tops.length) return;
    var list = tops.map(function (t) {
      return {
        id: t.slug,
        name: t.name,
        thumbnail: thumbFor(t).src || 'Asset 1.png',
        url: t.pageUrl || ('collection.html?c=' + encodeURIComponent(t.slug)),
      };
    });
    MAIN_SERVICES.splice.apply(MAIN_SERVICES, [0, MAIN_SERVICES.length].concat(list)); // eslint-disable-line no-undef
    renderGallery(); // eslint-disable-line no-undef
  }

  // ------------------------------------------------- flat category pages
  function applyFlat(top) {
    var gridSel = FLAT_GRIDS[top.slug];
    var grid = gridSel && document.querySelector(gridSel);
    if (!grid) return false;
    var direct = samplesOf(top.slug, null);
    var g = swapGrid(grid, direct.map(function (s) { return renderSampleCard(s, top); }).join('\n          '));

    // Remove sections from a previous render, then add subcategory sections (if the admin created any).
    Array.prototype.forEach.call(document.querySelectorAll('.bs-subsection'), function (n) { n.remove(); });
    var anchor = g;
    subsOf(top.slug).forEach(function (sub) {
      var items = samplesOf(top.slug, sub.slug);
      if (!items.length) return;
      var sec = document.createElement('section');
      sec.className = 'bs-subsection';
      sec.id = sub.viewId || ('view-' + sub.slug);
      sec.innerHTML = '<h2 class="bs-sub-title">' + (sub.icon ? '<span>' + esc(sub.icon) + '</span> ' : '') + esc(sub.name) + '</h2>' +
        (sub.description ? '<p class="bs-sub-desc">' + esc(sub.description) + '</p>' : '');
      sec.appendChild(newGrid(items.map(function (s) { return renderSampleCard(s, top); }).join('\n          ')));
      anchor.parentNode.insertBefore(sec, anchor.nextSibling);
      anchor = sec;
    });
    setHero(top.pageTitle, top.pageDescription, '.page-hero');
    return true;
  }

  function setHero(title, desc, scope) {
    var h1 = document.querySelector((scope || '') + ' h1');
    var p = document.querySelector((scope || '') + ' h1 + p');
    if (title && h1) h1.textContent = title;
    if (desc && p) p.textContent = desc;
  }

  // ----------------------------------------------- nested category pages
  var nested = { top: null, subs: [] };

  function ensureNestedShell() {
    var wrap = document.querySelector('main .wrap');
    if (!wrap) return null;
    var cats = document.getElementById('view-categories');
    if (!cats) {
      cats = document.createElement('section');
      cats.id = 'view-categories';
      cats.className = 'view-panel active';
      cats.appendChild(newGrid(''));
      wrap.appendChild(cats);
    }
    return wrap;
  }

  function applyNested(top) {
    var wrap = ensureNestedShell();
    if (!wrap) return false;
    var subs = subsOf(top.slug);
    nested.top = top;
    nested.subs = subs;

    // 1) Category overview: subcategory cards (+ any samples placed directly in the category)
    var catsView = document.getElementById('view-categories');
    var grids = catsView.querySelectorAll('.category-grid');
    for (var i = 1; i < grids.length; i++) grids[i].remove();
    var cardsHtml = subs.map(function (sub) { return renderSubCard(sub, top); }).join('\n          ');
    var direct = samplesOf(top.slug, null);
    swapGrid(catsView.querySelector('.category-grid'), cardsHtml + (direct.length ? '\n          ' : '') +
      direct.map(function (s) { return renderSampleCard(s, top); }).join('\n          '));
    if (!subs.length && !direct.length) {
      catsView.querySelector('.category-grid').innerHTML = '<div class="bs-empty">New designs are coming soon.</div>';
    }

    // 2) One panel per subcategory, in admin order.
    Array.prototype.forEach.call(wrap.querySelectorAll('.view-panel'), function (p) {
      if (p.id !== 'view-categories') p.remove();
    });
    subs.forEach(function (sub) {
      var sec = document.createElement('section');
      sec.id = sub.viewId || ('view-' + sub.slug);
      sec.className = 'view-panel';
      sec.innerHTML =
        '<div class="showcase-header">' +
        (sub.icon ? '<h2><span>' + esc(sub.icon) + '</span> ' + esc(sub.name) + '</h2>' : '') +
        '<button class="back-btn" onclick="showCategories()">&larr; Back to Categories</button>' +
        '</div>';
      sec.appendChild(newGrid(samplesOf(top.slug, sub.slug).map(function (s) { return renderSampleCard(s, top); }).join('\n          ')));
      wrap.appendChild(sec);
    });

    // 3) Take over routing so new/renamed subcategories work without code changes.
    if (typeof window.renderViewFromHash === 'function' && window.renderViewFromHash !== route) {
      window.removeEventListener('hashchange', window.renderViewFromHash);
    }
    window.removeEventListener('hashchange', route);
    window.addEventListener('hashchange', route);
    window.renderViewFromHash = route;
    window.showCategory = window.showSample = open;
    if (typeof window.showCategories !== 'function') {
      window.showCategories = function () { window.location.hash = 'categories'; };
    }
    route(true);
    return true;
  }

  function findSub(key) {
    key = String(key || '').toLowerCase();
    key = HASH_ALIASES[key] || key;
    for (var i = 0; i < nested.subs.length; i++) {
      var s = nested.subs[i];
      if (key === String(s.hash || '').toLowerCase() || key === s.slug) return s;
    }
    return null;
  }

  function open(key) {
    var s = findSub(key);
    if (s) window.location.hash = s.hash || s.slug;
  }

  function route(initial) {
    var top = nested.top;
    if (!top) return;
    var hash = window.location.hash.replace('#', '');
    var crumb = document.getElementById('heroBreadcrumb') || document.querySelector('.breadcrumb');
    var h1 = document.getElementById('heroTitle') || document.querySelector('.hero-sec h1, .page-hero h1');
    var p = document.getElementById('heroDesc') || document.querySelector('.hero-sec p, .page-hero p');
    Array.prototype.forEach.call(document.querySelectorAll('.view-panel'), function (panel) { panel.classList.remove('active'); });
    var sub = findSub(hash);
    var panel = sub && document.getElementById(sub.viewId || ('view-' + sub.slug));
    if (sub && panel) {
      panel.classList.add('active');
      if (crumb) {
        crumb.innerHTML = '\n          <a href="index.html">Home</a>\n          <span>/</span>\n          ' +
          '<a href="#categories" onclick="showCategories(); return false;">' + esc(top.name) + '</a>\n          <span>/</span>\n          ' +
          '<span>' + esc(sub.name) + '</span>\n        ';
      }
      if (h1) h1.textContent = sub.name;
      if (p) p.textContent = sub.description || '';
      if (initial !== true) window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      var cats = document.getElementById('view-categories');
      if (cats) cats.classList.add('active');
      if (crumb) {
        crumb.innerHTML = '\n          <a href="index.html">Home</a>\n          <span>/</span>\n          <span>' + esc(top.name) + '</span>\n        ';
      }
      if (h1 && top.pageTitle) h1.textContent = top.pageTitle;
      if (p && top.pageDescription) p.textContent = top.pageDescription;
    }
  }

  // --------------------------------------------------------------- render
  function renderAll() {
    if (!state.data) return false;
    injectStyles();
    if (PAGE === 'index') { applyIndex(); return true; }
    var top = topBySlug(TOP_SLUG);
    if (!top) {
      if (PAGE === 'collection') showMissing();
      return false;
    }
    if (PAGE === 'collection') {
      document.title = top.name + ' | Bright Screen Invites';
    }
    if (FLAT_GRIDS[top.slug] && PAGE !== 'collection') return applyFlat(top);
    return applyNested(top);
  }

  function showMissing() {
    var wrap = ensureNestedShell();
    var h1 = document.getElementById('heroTitle');
    if (h1) h1.textContent = 'Collection not found';
    if (wrap) {
      var g = document.querySelector('#view-categories .category-grid');
      if (g) g.innerHTML = '<div class="bs-empty">This collection is not available. <a href="index.html">Browse all designs →</a></div>';
    }
  }

  function load() {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
    var url = API + (PREVIEW ? (API.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now() : '');
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        clearTimeout(timer);
        if (d && d.ok && Array.isArray(d.categories) && Array.isArray(d.samples) && d.categories.length) {
          state.data = d;
          state.live = true;
          return true;
        }
        return false;
      })
      .catch(function () { clearTimeout(timer); return false; });
  }

  // Index: the page's own thumbnail-sync scrapes the static pages; skip it once live data is in.
  if (PAGE === 'index' && typeof window.syncMainServicesLiveThumbnails === 'function') {
    var originalSync = window.syncMainServicesLiveThumbnails;
    window.syncMainServicesLiveThumbnails = function () {
      return ready.then(function (ok) { if (!ok) return originalSync(); });
    };
  }

  var ready = load().then(function (ok) {
    return new Promise(function (resolve) {
      onReady(function () {
        var rendered = false;
        if (ok) {
          try { rendered = renderAll(); } catch (e) { if (window.console) console.warn('[bs-live] render failed, keeping static content', e); }
        } else if (PAGE === 'collection') {
          showMissing();
        }
        resolve(ok && rendered !== false);
      });
    });
  });

  // ------------------------------------------------- admin live preview
  // Used by the Admin Panel "Preview" (same-origin iframe): shows a draft card exactly as it will look.
  function previewSample(draft, categories) {
    return ready.then(function () {
      if (!state.data) state.data = { categories: [], samples: [] };
      // The admin passes its own category list so drafts in hidden/new categories preview correctly.
      if (Array.isArray(categories) && categories.length) state.data.categories = categories;
      state.draft = draft;
      renderAll();
      if (draft.subcategory) open(draft.subcategory);
      setTimeout(function () {
        var el = document.querySelector('[data-bs-id="' + (window.CSS && CSS.escape ? CSS.escape(draft.id) : draft.id) + '"]');
        if (el) {
          el.classList.add('bs-preview-highlight');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 350);
      return true;
    });
  }

  window.BSLive = {
    ready: ready,
    open: open,
    imgFallback: imgFallback,
    renderSampleCard: renderSampleCard,
    previewSample: previewSample,
    get live() { return state.live; },
    get data() { return state.data; },
  };
})();
