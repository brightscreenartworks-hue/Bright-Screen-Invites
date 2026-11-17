// Categories: add / edit / delete / reorder top-level categories and their subcategories.
// Changes are read by the website through /api/catalog, so they appear on the live site automatically.
import { html, icon, toast, modal, confirmDialog, errMsg, siteUrl, slugify, esc } from '../ui.js';

/** Opens the add/edit dialog. Resolves with the saved row, or null. */
export async function editCategory(ctx, cats, existing, parentId) {
  const isSub = existing ? !!existing.parent_id : !!parentId;
  const parent = cats.find((c) => c.id === (existing ? existing.parent_id : parentId));
  const c = existing ? { ...existing } : { name: '', slug: '', description: '', badge: '', icon: '', is_visible: true, parent_id: parentId || null };
  const legacyPage = !isSub && c.page_url && !c.page_url.startsWith('collection.html');
  const body = String(html`
    <form id="catForm" novalidate>
      ${isSub ? html`<p class="small muted" style="margin:0 0 12px">Subcategory of <strong>${parent ? parent.name : ''}</strong></p>` : ''}
      <label class="field"><span class="label">Name <span class="req">*</span></span>
        <input class="input" name="cname" maxlength="120" required value="${c.name}"></label>
      <label class="field"><span class="label">URL name (slug)</span>
        <input class="input mono" name="slug" maxlength="62" value="${c.slug}" ${existing ? '' : 'data-auto="1"'}>
        <div class="hint">${isSub ? 'Used in the page link, e.g. video-invites.html#' : 'Used in the page link'}<span data-slug-preview>${isSub ? (c.hash || c.slug) : c.slug}</span>.
          ${existing ? html`<strong>Changing it breaks links people already shared.</strong>` : ''}</div></label>
      ${isSub ? html`<label class="field"><span class="label">Badge text <span class="muted">(optional, shown under the card name)</span></span>
        <input class="input" name="badge" maxlength="80" value="${c.badge || ''}" placeholder="e.g. Custom Couple & Family"></label>` : ''}
      <label class="field"><span class="label">${isSub ? 'Description (shown at the top of the subcategory page)' : 'Page description'}</span>
        <textarea class="textarea" name="description" maxlength="600" rows="3">${isSub ? (c.description || '') : (c.page_description || c.description || '')}</textarea></label>
      ${!isSub ? html`<label class="field"><span class="label">Page heading</span>
        <input class="input" name="page_title" maxlength="120" value="${c.page_title || ''}" placeholder="e.g. ${c.name || 'Wedding Cards'} Collection"></label>` : ''}
      <div class="grid-2" style="margin-top:14px">
        <label class="field"><span class="label">Icon <span class="muted">(optional emoji)</span></span>
          <input class="input" name="icon" maxlength="8" value="${c.icon || ''}" placeholder="👑"></label>
        <div class="field"><span class="label">Card thumbnail</span>
          <div class="row"><img data-thumb src="${siteUrl(c.custom_thumbnail_url)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;background:#f6edf1;${c.custom_thumbnail_url ? '' : 'display:none'}">
          <label class="btn sm">${icon('upload')} Upload<input type="file" accept="image/*" data-file hidden></label>
          <button type="button" class="btn sm ghost" data-clear ${c.custom_thumbnail_url ? '' : 'hidden'}>Use newest sample</button></div>
          <div class="hint">Leave empty to use the newest sample’s thumbnail automatically.</div></div>
      </div>
      <label class="switch" style="margin-top:16px"><input type="checkbox" name="is_visible" ${c.is_visible !== false ? 'checked' : ''}><span class="track"></span><span>Visible on the website</span></label>
      ${legacyPage ? html`<p class="hint" style="margin-top:12px">Website page: <span class="mono">${c.page_url}</span></p>` : !isSub ? html`<p class="hint" style="margin-top:12px">New categories get their own page automatically (collection.html?c=…), styled like the existing ones.</p>` : ''}
      <p class="small" data-err style="color:var(--red);margin:12px 0 0"></p>
    </form>`);

  let thumb = c.custom_thumbnail_url || null;
  return modal({
    title: existing ? `Edit ${isSub ? 'subcategory' : 'category'}` : `New ${isSub ? 'subcategory' : 'category'}`,
    body,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: existing ? 'Save changes' : 'Create', kind: 'primary',
        handler: async (root) => {
          const f = root.querySelector('#catForm');
          const err = (m) => { root.querySelector('[data-err]').textContent = m; return false; };
          const name = f.cname.value.trim();
          const slug = slugify(f.slug.value || name);
          if (!name) return err('Please enter a name.');
          if (!slug) return err('Please enter a URL name using letters or numbers.');
          const dup = cats.find((x) => x.slug === slug && x.id !== c.id && (x.parent_id || null) === (c.parent_id || null));
          if (dup) return err(`“${dup.name}” already uses the URL name “${slug}”.`);
          const row = {
            ...(c.id ? { id: c.id } : {}),
            parent_id: c.parent_id || null,
            name, slug,
            icon: f.icon.value.trim() || null,
            custom_thumbnail_url: thumb,
            is_visible: f.is_visible.checked,
          };
          if (isSub) {
            row.description = f.description.value.trim() || null;
            row.badge = f.badge.value.trim() || null;
            if (existing && existing.slug !== slug) { row.hash = slug; row.view_id = existing.view_id; row.card_id = existing.card_id; }
          } else {
            row.page_description = f.description.value.trim() || null;
            row.page_title = f.page_title.value.trim() || null;
          }
          if (!existing) row.sort_order = cats.filter((x) => (x.parent_id || null) === (row.parent_id || null)).length;
          try {
            const saved = await ctx.data.saveCategory(row);
            toast(existing ? 'Category saved — the website is updated' : 'Category created', 'ok');
            return saved;
          } catch (e) { return err(errMsg(e)); }
        },
      },
    ],
    onMount(root) {
      const f = root.querySelector('#catForm');
      const preview = root.querySelector('[data-slug-preview]');
      f.cname.addEventListener('input', () => {
        if (f.slug.dataset.auto) { f.slug.value = slugify(f.cname.value); preview.textContent = f.slug.value; }
      });
      f.slug.addEventListener('input', () => { delete f.slug.dataset.auto; preview.textContent = slugify(f.slug.value); });
      const img = root.querySelector('[data-thumb]');
      const clear = root.querySelector('[data-clear]');
      root.querySelector('[data-file]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          toast('Uploading thumbnail…');
          thumb = await ctx.data.uploadThumbnail(file);
          img.src = thumb; img.style.display = ''; clear.hidden = false;
        } catch (er) { toast(errMsg(er), 'err'); }
      });
      clear.addEventListener('click', () => { thumb = null; img.style.display = 'none'; clear.hidden = true; });
    },
  });
}

export async function render(ctx) {
  ctx.setTitle('Categories', 'Website');
  let cats = await ctx.data.categories();
  let samples = await ctx.data.samples();
  if (!ctx.isCurrent()) return;

  const counts = () => {
    const m = {};
    samples.forEach((s) => { m[s.category_id] = (m[s.category_id] || 0) + 1; if (s.subcategory_id) m[s.subcategory_id] = (m[s.subcategory_id] || 0) + 1; });
    return m;
  };
  const sorted = (list) => list.slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const thumbOf = (c) => {
    if (c.custom_thumbnail_url) return c.custom_thumbnail_url;
    const s = sorted(samples.filter((x) => x.status === 'published' && (x.subcategory_id === c.id || (!c.parent_id && x.category_id === c.id))))[0];
    return s ? s.custom_thumbnail_url || s.auto_thumbnail_url : '';
  };

  ctx.setActions(html`<button class="btn primary" id="addTop">${icon('plus')} New category</button>`);
  document.getElementById('addTop').addEventListener('click', async () => {
    const saved = await editCategory(ctx, cats, null, null);
    if (saved) { cats.push(saved); paint(); }
  });

  function rowHtml(c, i, n, isSub) {
    const cnt = counts()[c.id] || 0;
    const t = thumbOf(c);
    const top = isSub ? cats.find((x) => x.id === c.parent_id) : c;
    const link = top ? (top.page_url || `collection.html?c=${top.slug}`) + (isSub ? `#${c.hash || c.slug}` : '') : '';
    return html`<div class="cat-row ${isSub ? 'sub' : ''}" data-id="${c.id}">
      <div class="ord"><button data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button data-move="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></div>
      <div class="th">${t ? html`<img src="${siteUrl(t)}" alt="" loading="lazy">` : (c.icon || '🗂️')}</div>
      <div><div class="nm">${c.icon && t ? `${c.icon} ` : ''}${c.name}</div>
        <div class="sl"><a href="../${link}" target="_blank" rel="noopener">${link}</a>${c.badge ? ` · ${c.badge}` : ''}</div></div>
      <div class="pills row">
        <a class="pill plain pink" href="#/samples?cat=${isSub ? c.parent_id : c.id}${isSub ? `&sub=${c.id}` : ''}">${cnt} sample${cnt === 1 ? '' : 's'}</a>
        ${c.is_visible ? '' : html`<span class="pill grey">Hidden</span>`}</div>
      <div class="acts row">
        ${!isSub ? html`<button class="btn sm" data-act="addsub" title="Add subcategory">${icon('plus')}<span class="hide-sm">Sub</span></button>` : ''}
        <button class="btn sm" data-act="vis" title="${c.is_visible ? 'Hide from website' : 'Show on website'}">${icon(c.is_visible ? 'eyeOff' : 'eye')}</button>
        <button class="btn sm" data-act="edit" title="Edit">${icon('edit')}</button>
        <button class="btn sm danger" data-act="delete" title="Delete">${icon('trash')}</button></div>
    </div>`;
  }

  function paint() {
    const tops = sorted(cats.filter((c) => !c.parent_id));
    ctx.el.innerHTML = String(html`
      <div class="alert info">ℹ️ <span>Order, names, visibility and thumbnails here are what visitors see on the website (updates appear within ~15 seconds).</span></div>
      <div class="card">
        ${tops.length ? tops.map((t, i) => {
          const subs = sorted(cats.filter((c) => c.parent_id === t.id));
          return html`<div class="cat-top">${rowHtml(t, i, tops.length, false)}${subs.map((s, j) => rowHtml(s, j, subs.length, true))}</div>`;
        }) : html`<div class="empty-state">No categories yet.</div>`}
      </div>`);
    ctx.el.querySelectorAll('.cat-row').forEach((r) => {
      const c = cats.find((x) => x.id === r.dataset.id);
      r.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => move(c, Number(b.dataset.move))));
      r.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(c, b.dataset.act, b)));
    });
  }

  async function move(c, dir) {
    const siblings = sorted(cats.filter((x) => (x.parent_id || null) === (c.parent_id || null)));
    const i = siblings.indexOf(c), j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    try {
      await ctx.data.reorder('categories', siblings.map((x) => x.id));
      siblings.forEach((x, k) => { x.sort_order = k; });
      paint();
      toast('Order updated', 'ok');
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  async function act(c, a, btn) {
    if (a === 'edit') {
      const saved = await editCategory(ctx, cats, c);
      if (saved) { Object.assign(c, saved); paint(); }
    } else if (a === 'addsub') {
      const saved = await editCategory(ctx, cats, null, c.id);
      if (saved) { cats.push(saved); paint(); }
    } else if (a === 'vis') {
      btn.disabled = true;
      try { const saved = await ctx.data.saveCategory({ id: c.id, is_visible: !c.is_visible }); Object.assign(c, saved); toast(c.is_visible ? 'Now visible on the website' : 'Hidden from the website', 'ok'); paint(); }
      catch (e) { toast(errMsg(e), 'err'); btn.disabled = false; }
    } else if (a === 'delete') {
      const subs = cats.filter((x) => x.parent_id === c.id);
      const n = counts()[c.id] || 0;
      if (subs.length || n) {
        await modal({
          title: 'Category is not empty',
          body: String(html`<p>“${c.name}” still has ${subs.length ? `${subs.length} subcategor${subs.length === 1 ? 'y' : 'ies'}` : ''}${subs.length && n ? ' and ' : ''}${n ? `${n} sample${n === 1 ? '' : 's'}` : ''}.</p>
            <p class="muted">To protect your data, move or delete those first — or simply <strong>hide</strong> the category instead.</p>`),
          actions: [{ label: 'OK', kind: 'primary', value: true }],
        });
        return;
      }
      const ok = await confirmDialog({ title: 'Delete category?', message: `“${c.name}” will be removed from the website.`, confirm: 'Delete', danger: true });
      if (!ok) return;
      try { await ctx.data.deleteCategory(c.id); cats = cats.filter((x) => x.id !== c.id); toast('Category deleted', 'ok'); paint(); }
      catch (e) { toast(errMsg(e), 'err'); }
    }
  }

  paint();
  void esc;
}
