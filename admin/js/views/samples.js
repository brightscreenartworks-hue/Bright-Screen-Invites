// Manage Samples: search/filter, publish/hide, delete, preview, and drag-to-reorder per display group.
import { html, icon, toast, confirmDialog, errMsg, siteUrl, statusPill, SAMPLE_STATUS, PROVIDER_LABEL, debounce, timeAgo } from '../ui.js';
import { openPreview } from './preview.js';

const F = { q: '', cat: '', sub: '', status: '' }; // remembered while the admin navigates

export async function render(ctx) {
  ctx.setTitle('Manage Samples', 'Website');
  ctx.setActions(html`<a class="btn primary" href="#/upload">${icon('plus')} Upload sample</a>`);
  if (ctx.query.get('cat')) { F.cat = ctx.query.get('cat'); F.sub = ctx.query.get('sub') || ''; }

  let [cats, samples] = await Promise.all([ctx.data.categories(), ctx.data.samples()]);
  if (!ctx.isCurrent()) return;
  const byId = () => Object.fromEntries(cats.map((c) => [c.id, c]));
  let reorder = null; // array of ids while reordering

  const tops = () => cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const subsOf = (id) => cats.filter((c) => c.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const groupSelected = () => F.cat && (F.sub || !subsOf(F.cat).length);

  function filtered() {
    const q = F.q.toLowerCase();
    const map = byId();
    return samples.filter((s) => {
      if (F.cat && s.category_id !== F.cat) return false;
      if (F.sub === '__none') { if (s.subcategory_id) return false; } else if (F.sub && s.subcategory_id !== F.sub) return false;
      if (F.status && s.status !== F.status) return false;
      if (q) {
        const hay = `${s.title} ${s.description || ''} ${(map[s.category_id] || {}).name || ''} ${(map[s.subcategory_id] || {}).name || ''} ${s.media_url || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ca = map[a.category_id] || {}, cb = map[b.category_id] || {};
      const sa = map[a.subcategory_id] || { sort_order: -1 }, sb = map[b.subcategory_id] || { sort_order: -1 };
      return (ca.sort_order - cb.sort_order) || (sa.sort_order - sb.sort_order) || (a.sort_order - b.sort_order) || (new Date(b.uploaded_at) - new Date(a.uploaded_at));
    });
  }

  function paint() {
    const map = byId();
    const list = reorder ? reorder.map((id) => samples.find((s) => s.id === id)) : filtered();
    const subs = F.cat ? subsOf(F.cat) : [];
    ctx.el.innerHTML = String(html`
      <div class="toolbar">
        <label class="search"><span class="sr-only">Search samples</span>${icon('search')}<input class="input" id="fq" placeholder="Search title, link, category…" value="${F.q}" ${reorder ? 'disabled' : ''}></label>
        <select class="select" id="fcat" ${reorder ? 'disabled' : ''} aria-label="Category"><option value="">All categories</option>
          ${tops().map((c) => html`<option value="${c.id}" ${F.cat === c.id ? 'selected' : ''}>${c.name}</option>`)}</select>
        ${subs.length ? html`<select class="select" id="fsub" ${reorder ? 'disabled' : ''} aria-label="Subcategory"><option value="">All subcategories</option>
          ${subs.map((c) => html`<option value="${c.id}" ${F.sub === c.id ? 'selected' : ''}>${c.name}</option>`)}
          <option value="__none" ${F.sub === '__none' ? 'selected' : ''}>(No subcategory)</option></select>` : ''}
        <select class="select" id="fstatus" ${reorder ? 'disabled' : ''} aria-label="Status"><option value="">Any status</option>
          ${Object.entries(SAMPLE_STATUS).map(([k, v]) => html`<option value="${k}" ${F.status === k ? 'selected' : ''}>${v.label}</option>`)}</select>
        ${reorder ? '' : html`<button class="btn" id="reorderBtn" ${groupSelected() && F.sub !== '__none' && !F.q && !F.status ? '' : 'disabled'}
          title="${groupSelected() ? 'Change the order shown on the website' : 'Pick a category (and subcategory) first'}">${icon('grip')} Change order</button>`}
      </div>
      <div class="card">
        ${reorder ? html`<div class="reorder-bar">${icon('grip')} <span><strong>Drag rows</strong> (or use ↑ ↓) to set the order visitors see on the website.</span>
          <span style="flex:1"></span><button class="btn sm" id="cancelOrder">Cancel</button><button class="btn sm primary" id="saveOrder">Save order</button></div>` : ''}
        <div class="card-h"><h2>${list.length} sample${list.length === 1 ? '' : 's'}</h2><span class="spacer"></span>
          ${!reorder && !groupSelected() ? html`<span class="small muted">Tip: choose a category to change display order</span>` : ''}</div>
        ${list.length ? html`<div class="s-list" id="slist">${list.map((s, i) => row(s, i, list.length, map))}</div>`
          : html`<div class="empty-state"><div class="big">🖼️</div>No samples match these filters.<br><br><a class="btn primary" href="#/upload">${icon('plus')} Upload sample</a></div>`}
      </div>`);
    bind();
  }

  function row(s, i, n, map) {
    const thumb = s.custom_thumbnail_url || s.auto_thumbnail_url;
    const cat = map[s.category_id], sub = map[s.subcategory_id];
    return html`<div class="s-row" data-id="${s.id}" ${reorder ? 'draggable="true"' : ''}>
      <div class="handle ${reorder ? '' : 'off'}" aria-hidden="true">${icon('grip')}</div>
      <div class="th">${thumb ? html`<img loading="lazy" src="${siteUrl(thumb)}" alt="">` : ''}</div>
      <div class="meta"><div class="tt">${s.title}</div>
        <div class="cc">${cat ? cat.name : '—'}${sub ? ` › ${sub.name}` : ''} · ${PROVIDER_LABEL[s.media_provider] || 'Link'} · ${s.custom_thumbnail_url ? 'custom thumbnail' : 'auto thumbnail'} · ${timeAgo(s.updated_at)}</div></div>
      <div class="st">${statusPill(SAMPLE_STATUS, s.status)}</div>
      <div class="acts">${reorder ? html`
          <button class="btn sm icon" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="btn sm icon" data-move="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>` : html`
          <a class="btn sm" href="#/edit/${s.id}" title="Edit">${icon('edit')}<span class="hide-sm">Edit</span></a>
          <button class="btn sm icon" data-act="preview" title="Preview on website" aria-label="Preview">${icon('eye')}</button>
          ${s.status === 'published'
            ? html`<button class="btn sm" data-act="hide" title="Hide from website">${icon('eyeOff')}<span class="hide-sm">Hide</span></button>`
            : html`<button class="btn sm" data-act="publish" title="Publish to website">${icon('check')}<span class="hide-sm">Publish</span></button>`}
          <button class="btn sm icon danger" data-act="delete" title="Delete" aria-label="Delete">${icon('trash')}</button>`}</div>
    </div>`;
  }

  function bind() {
    const el = ctx.el;
    const q = el.querySelector('#fq');
    if (q) q.addEventListener('input', debounce(() => { if (!ctx.isCurrent()) return; F.q = q.value; paint(); el.querySelector('#fq').focus(); const v = el.querySelector('#fq'); v.setSelectionRange(v.value.length, v.value.length); }, 200));
    const fc = el.querySelector('#fcat');
    if (fc) fc.addEventListener('change', () => { F.cat = fc.value; F.sub = ''; paint(); });
    const fs = el.querySelector('#fsub');
    if (fs) fs.addEventListener('change', () => { F.sub = fs.value; paint(); });
    const st = el.querySelector('#fstatus');
    if (st) st.addEventListener('change', () => { F.status = st.value; paint(); });
    const rb = el.querySelector('#reorderBtn');
    if (rb) rb.addEventListener('click', () => { reorder = filtered().map((s) => s.id); paint(); });
    const cancel = el.querySelector('#cancelOrder');
    if (cancel) cancel.addEventListener('click', () => { reorder = null; paint(); });
    const save = el.querySelector('#saveOrder');
    if (save) save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await ctx.data.reorder('samples', reorder);
        reorder.forEach((id, i) => { const s = samples.find((x) => x.id === id); if (s) s.sort_order = i; });
        reorder = null;
        toast('Order saved — the website now shows this order', 'ok');
        paint();
      } catch (e) { toast(errMsg(e), 'err'); save.disabled = false; }
    });

    el.querySelectorAll('.s-row').forEach((r) => {
      const id = r.dataset.id;
      const s = samples.find((x) => x.id === id);
      r.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
        const i = reorder.indexOf(id), j = i + Number(b.dataset.move);
        if (j < 0 || j >= reorder.length) return;
        [reorder[i], reorder[j]] = [reorder[j], reorder[i]];
        paint();
      }));
      r.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'preview') return openPreview(s, cats);
        if (act === 'delete') {
          const ok = await confirmDialog({ title: 'Delete sample?', message: `“${s.title}” will be permanently removed from the website and the admin panel.`, confirm: 'Delete', danger: true });
          if (!ok) return;
          try { await ctx.data.deleteSample(id); samples = samples.filter((x) => x.id !== id); toast('Sample deleted', 'ok'); paint(); } catch (e) { toast(errMsg(e), 'err'); }
          return;
        }
        const status = act === 'publish' ? 'published' : 'hidden';
        b.disabled = true;
        try { await ctx.data.setSampleStatus(id, status); s.status = status; s.updated_at = new Date().toISOString(); toast(status === 'published' ? 'Published — now live on the website' : 'Hidden from the website', 'ok'); paint(); }
        catch (e) { toast(errMsg(e), 'err'); b.disabled = false; }
      }));
      if (reorder) {
        r.addEventListener('dragstart', (e) => { r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
        r.addEventListener('dragend', () => r.classList.remove('dragging'));
        r.addEventListener('dragover', (e) => { e.preventDefault(); r.classList.add('drop-before'); });
        r.addEventListener('dragleave', () => r.classList.remove('drop-before'));
        r.addEventListener('drop', (e) => {
          e.preventDefault();
          r.classList.remove('drop-before');
          const from = e.dataTransfer.getData('text/plain');
          if (!from || from === id) return;
          reorder.splice(reorder.indexOf(from), 1);
          reorder.splice(reorder.indexOf(id), 0, from);
          paint();
        });
      }
    });
  }

  ctx.guardLeave((silent) => !reorder || (!silent && window.confirm('Discard the unsaved order?')));
  paint();
  cats = cats || [];
}
