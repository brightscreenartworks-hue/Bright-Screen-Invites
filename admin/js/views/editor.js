// Upload New Sample / Edit Sample.
// Auto-fetches thumbnails from media links; a custom uploaded thumbnail always overrides the automatic one.
import { html, icon, toast, errMsg, siteUrl, providerOf, youtubeId, PROVIDER_LABEL, SAMPLE_STATUS, confirmDialog, debounce, fmtDate } from '../ui.js';
import { editCategory } from './categories.js';
import { openPreview } from './preview.js';

const EMPTY = {
  title: '', description: '', media_url: '', media_provider: 'other', share_url: '', auto_thumbnail_url: '', custom_thumbnail_url: '',
  thumbnail_fallbacks: [], alt_text: '', vertical_thumb: false, fill_label: '', fill_category: '', status: 'published',
  category_id: '', subcategory_id: '',
};

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function render(ctx) {
  const id = ctx.params[0];
  const editing = !!id;
  ctx.setTitle(editing ? 'Edit Sample' : 'Upload New Sample', editing ? 'Manage Samples' : 'Website');
  let [cats, allSamples, original] = await Promise.all([
    ctx.data.categories(), ctx.data.samples(), editing ? ctx.data.sample(id) : Promise.resolve(null),
  ]);
  if (!ctx.isCurrent()) return;
  if (editing && !original) throw new Error('Sample not found — it may have been deleted.');

  const s = { ...EMPTY, ...(original || {}) };
  if (!editing) {
    s.category_id = ctx.query.get('cat') || '';
    s.subcategory_id = ctx.query.get('sub') || '';
  }
  const startJson = JSON.stringify(s);
  let busy = false;
  let fetchSeq = 0;
  const dirty = () => JSON.stringify(s) !== startJson;
  ctx.guardLeave((silent) => busy || !dirty() || (!silent && window.confirm('You have unsaved changes. Leave without saving?')));

  const tops = () => cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const subsOf = (cid) => cats.filter((c) => c.parent_id === cid).sort((a, b) => a.sort_order - b.sort_order);

  ctx.setActions(editing ? html`<button class="btn" id="tPreview">${icon('eye')} Preview</button>` : '');

  ctx.el.innerHTML = String(html`
    <form id="sForm" class="split wide-side" novalidate>
      <div class="stack">
        <div class="card"><div class="card-h"><h2>1 · Media link</h2></div><div class="card-b">
          <label class="field"><span class="label">YouTube, Instagram, Vimeo, Google Photos or website link</span>
            <div class="input-group"><input class="input" name="media_url" type="url" inputmode="url" placeholder="https://www.youtube.com/shorts/…" value="${s.media_url}">
            <button class="btn" type="button" id="fetchBtn">${icon('refresh')} Fetch thumbnail</button></div>
            <div class="hint" id="mediaHint">Paste a link — the thumbnail is fetched automatically where supported.</div></label>
        </div></div>

        <div class="card"><div class="card-h"><h2>2 · Details</h2></div><div class="card-b">
          <label class="field"><span class="label">Sample title <span class="req">*</span></span>
            <input class="input" name="title" maxlength="200" required value="${s.title}" placeholder="e.g. Bhavya & Adarsh · CI 74">
            <div class="hint">Shown on the card, exactly like the existing samples.</div></label>
          <label class="field"><span class="label">Description <span class="muted">(internal, helps search)</span></span>
            <textarea class="textarea" name="description" maxlength="2000" rows="3">${s.description || ''}</textarea></label>
          <div class="grid-2" style="margin-top:14px">
            <div class="field"><span class="label">Category <span class="req">*</span></span>
              <div class="input-group"><select class="select" name="category_id" required><option value="">Choose…</option>
                ${tops().map((c) => html`<option value="${c.id}" ${s.category_id === c.id ? 'selected' : ''}>${c.name}${c.is_visible ? '' : ' (hidden)'}</option>`)}</select>
              <button class="btn icon" type="button" id="newCat" title="New category" aria-label="New category">${icon('plus')}</button></div></div>
            <div class="field"><span class="label">Subcategory</span>
              <div class="input-group"><select class="select" name="subcategory_id" id="subSel"></select>
              <button class="btn icon" type="button" id="newSub" title="New subcategory" aria-label="New subcategory">${icon('plus')}</button></div></div>
          </div>
        </div></div>

        <div class="card"><div class="card-h"><h2>3 · Display</h2></div><div class="card-b">
          <span class="label">Status</span>
          <div class="segmented" id="statusSeg" role="radiogroup">${Object.entries(SAMPLE_STATUS).map(([k, v]) => html`<button type="button" data-status="${k}" class="${s.status === k ? 'on' : ''}" role="radio" aria-checked="${s.status === k}">${v.label}</button>`)}</div>
          <div class="hint">Published samples appear on the website. Hidden and draft samples are only visible here.</div>
          <label class="check" style="margin-top:14px"><input type="checkbox" name="vertical_thumb" ${s.vertical_thumb ? 'checked' : ''}> Vertical video crop (YouTube Shorts / Reels style thumbnail)</label>
          <details class="adv" style="margin-top:16px"><summary>Advanced options</summary>
            <div class="stack" style="margin-top:12px">
              <label class="field"><span class="label">Image alt text</span><input class="input" name="alt_text" maxlength="300" value="${s.alt_text || ''}" placeholder="Defaults to the title"></label>
              <label class="field"><span class="label">Share link</span><input class="input" name="share_url" type="url" value="${s.share_url || ''}" placeholder="Defaults to the media link"></label>
              <div class="grid-2">
                <label class="field"><span class="label">“Fill Details” sample name</span><input class="input" name="fill_label" value="${s.fill_label || ''}" placeholder="Defaults to the title"></label>
                <label class="field"><span class="label">“Fill Details” category</span><input class="input" name="fill_category" value="${s.fill_category || ''}" placeholder="Defaults to the category name"></label>
              </div>
              <label class="field"><span class="label">Upload date</span><input class="input" name="uploaded_at" type="datetime-local" value="${toLocalInput(s.uploaded_at)}"></label>
            </div>
          </details>
        </div></div>
      </div>

      <div class="stack" style="position:sticky;top:78px">
        <div class="card"><div class="card-h"><h2>Thumbnail</h2><span class="spacer"></span><span id="thumbTag"></span></div><div class="card-b">
          <div class="thumb-box" id="thumbBox"></div>
          <div class="dropzone" id="drop" style="margin-top:12px" tabindex="0" role="button" aria-label="Upload custom thumbnail">
            ${icon('upload')} <strong>Upload custom thumbnail</strong><div class="small muted">JPG, PNG or WebP up to 5 MB — overrides the automatic thumbnail</div>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" id="fileIn" hidden></div>
          <button type="button" class="btn sm ghost block" id="clearCustom" style="margin-top:8px" hidden>Remove custom thumbnail (use automatic)</button>
        </div></div>
        <div class="card"><div class="card-b stack">
          <button class="btn primary block" type="submit" id="saveBtn">${icon('check')} ${editing ? 'Save changes' : 'Save sample'}</button>
          <div class="row"><button class="btn" type="button" id="previewBtn" style="flex:1">${icon('eye')} Preview on website</button>
            ${editing ? '' : html`<button class="btn" type="button" id="saveAnother" style="flex:1">Save & add another</button>`}</div>
          ${editing ? html`<div class="row between small muted"><span>Created ${fmtDate(original.created_at)}${original.created_by ? ` by ${original.created_by}` : ''}</span>
            <button class="btn sm danger" type="button" id="delBtn">${icon('trash')} Delete</button></div>` : ''}
          <p class="small" id="formErr" style="color:var(--red);margin:0"></p>
        </div></div>
      </div>
    </form>`);

  const f = ctx.el.querySelector('#sForm');
  const $ = (sel) => ctx.el.querySelector(sel);

  function fillSubs() {
    const subs = subsOf(s.category_id);
    $('#subSel').innerHTML = String(html`<option value="">${subs.length ? '(None — show on the category page)' : '(No subcategories)'}</option>
      ${subs.map((c) => html`<option value="${c.id}" ${s.subcategory_id === c.id ? 'selected' : ''}>${c.name}${c.is_visible ? '' : ' (hidden)'}</option>`)}`);
    $('#subSel').disabled = !s.category_id;
    $('#newSub').disabled = !s.category_id;
    if (!subs.find((c) => c.id === s.subcategory_id)) s.subcategory_id = '';
  }

  function paintThumb() {
    if (!ctx.isCurrent() || !$('#thumbBox')) return;
    const src = s.custom_thumbnail_url || s.auto_thumbnail_url;
    $('#thumbBox').innerHTML = src
      ? String(html`<img src="${siteUrl(src)}" alt="Thumbnail preview" style="${s.vertical_thumb && !s.custom_thumbnail_url ? 'transform:scale(1.9)' : ''}">`)
      : '<div class="empty">No thumbnail yet — paste a media link or upload a custom image.</div>';
    $('#thumbTag').innerHTML = String(s.custom_thumbnail_url ? html`<span class="pill pink">Custom (overrides auto)</span>`
      : s.auto_thumbnail_url ? html`<span class="pill green">Auto · ${PROVIDER_LABEL[s.media_provider] || 'Link'}</span>` : '');
    $('#clearCustom').hidden = !s.custom_thumbnail_url;
  }

  async function fetchThumb(force) {
    if (!ctx.isCurrent()) return;
    const url = s.media_url.trim();
    const hint = $('#mediaHint');
    if (!url) { hint.textContent = 'Paste a link — the thumbnail is fetched automatically where supported.'; return; }
    if (!/^https?:\/\/\S+\.\S+/.test(url)) { hint.textContent = '⚠️ That does not look like a full link (it should start with https://).'; return; }
    const provider = providerOf(url);
    s.media_provider = provider;
    const seq = ++fetchSeq;
    if (provider === 'youtube') {
      const vid = youtubeId(url);
      if (!vid) { hint.textContent = '⚠️ Could not read the YouTube video id from this link.'; return; }
      s.auto_thumbnail_url = `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
      s.thumbnail_fallbacks = [`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`];
      if (force || !editing) { s.vertical_thumb = /\/shorts\//.test(url); f.vertical_thumb.checked = s.vertical_thumb; }
      hint.textContent = `✓ YouTube video detected${s.vertical_thumb ? ' (Shorts)' : ''} — thumbnail fetched.`;
      paintThumb();
      return;
    }
    hint.textContent = `Fetching ${PROVIDER_LABEL[provider] || 'link'} preview…`;
    try {
      const r = await ctx.data.fetchThumbnail(url);
      if (seq !== fetchSeq || !ctx.isCurrent()) return;
      if (r.thumbnail) {
        s.auto_thumbnail_url = r.thumbnail;
        s.thumbnail_fallbacks = r.fallbacks || [];
        if (force || !editing) { s.vertical_thumb = !!r.vertical; f.vertical_thumb.checked = s.vertical_thumb; }
        if (!s.title && r.title) { s.title = r.title.slice(0, 200); f.title.value = s.title; }
        hint.textContent = `✓ ${PROVIDER_LABEL[provider] || 'Link'} preview found${r.persisted ? ' and saved permanently' : ''}.`;
      } else {
        hint.textContent = `ℹ️ ${r.message || 'No preview image found — please upload a custom thumbnail.'}`;
      }
    } catch (e) {
      if (!ctx.isCurrent()) return;
      if (seq === fetchSeq) hint.textContent = `⚠️ ${errMsg(e)} — you can upload a custom thumbnail instead.`;
    }
    paintThumb();
  }

  async function uploadFile(file) {
    if (!file) return;
    const drop = $('#drop');
    drop.style.opacity = '.6';
    try {
      s.custom_thumbnail_url = await ctx.data.uploadThumbnail(file);
      toast('Custom thumbnail uploaded', 'ok');
      paintThumb();
    } catch (e) { toast(errMsg(e), 'err'); } finally { drop.style.opacity = ''; }
  }

  // --- bindings
  const sync = () => {
    s.title = f.title.value.trim();
    s.description = f.description.value.trim();
    s.alt_text = f.alt_text.value.trim();
    s.share_url = f.share_url.value.trim();
    s.fill_label = f.fill_label.value.trim();
    s.fill_category = f.fill_category.value.trim();
    s.vertical_thumb = f.vertical_thumb.checked;
  };
  f.addEventListener('input', sync);
  f.media_url.addEventListener('input', debounce(() => { s.media_url = f.media_url.value.trim(); fetchThumb(false); }, 700));
  f.media_url.addEventListener('paste', () => setTimeout(() => { s.media_url = f.media_url.value.trim(); fetchThumb(true); }, 0));
  $('#fetchBtn').addEventListener('click', () => { s.media_url = f.media_url.value.trim(); fetchThumb(true); });
  f.vertical_thumb.addEventListener('change', () => { sync(); paintThumb(); });
  f.category_id.addEventListener('change', () => { s.category_id = f.category_id.value; s.subcategory_id = ''; fillSubs(); });
  $('#subSel').addEventListener('change', () => { s.subcategory_id = $('#subSel').value; });
  $('#statusSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    s.status = b.dataset.status;
    $('#statusSeg').querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
  });
  $('#newCat').addEventListener('click', async () => {
    const saved = await editCategory(ctx, cats, null, null);
    if (!saved) return;
    cats.push(saved);
    f.category_id.insertAdjacentHTML('beforeend', String(html`<option value="${saved.id}">${saved.name}</option>`));
    f.category_id.value = saved.id; s.category_id = saved.id; s.subcategory_id = '';
    fillSubs();
  });
  $('#newSub').addEventListener('click', async () => {
    if (!s.category_id) return;
    const saved = await editCategory(ctx, cats, null, s.category_id);
    if (!saved) return;
    cats.push(saved);
    s.subcategory_id = saved.id;
    fillSubs();
  });
  const drop = $('#drop');
  drop.addEventListener('click', () => $('#fileIn').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileIn').click(); } });
  $('#fileIn').addEventListener('change', (e) => uploadFile(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); uploadFile(e.dataTransfer.files[0]); });
  $('#clearCustom').addEventListener('click', () => { s.custom_thumbnail_url = ''; paintThumb(); });

  function buildRow() {
    sync();
    const err = (m) => { $('#formErr').textContent = m; return null; };
    $('#formErr').textContent = '';
    if (!s.title) { f.title.focus(); return err('Please enter a sample title.'); }
    if (!s.category_id) { f.category_id.focus(); return err('Please choose a category.'); }
    if (s.media_url && !/^https?:\/\/\S+\.\S+/.test(s.media_url)) return err('The media link must start with https://');
    if (s.share_url && !/^https?:\/\/\S+\.\S+/.test(s.share_url)) return err('The share link must start with https://');
    if (!s.media_url && !s.custom_thumbnail_url) return err('Add a media link or upload a custom thumbnail.');
    if (!s.custom_thumbnail_url && !s.auto_thumbnail_url) return err('No thumbnail yet — upload a custom thumbnail (this link has no automatic preview).');
    const up = f.uploaded_at.value ? new Date(f.uploaded_at.value) : null;
    const row = {
      ...(editing ? { id } : {}),
      title: s.title,
      description: s.description || null,
      media_url: s.media_url || null,
      media_provider: s.media_url ? providerOf(s.media_url) : 'image',
      share_url: s.share_url || null,
      auto_thumbnail_url: s.auto_thumbnail_url || null,
      custom_thumbnail_url: s.custom_thumbnail_url || null,
      thumbnail_fallbacks: s.thumbnail_fallbacks || [],
      alt_text: s.alt_text || null,
      vertical_thumb: !!s.vertical_thumb,
      fill_label: s.fill_label || null,
      fill_category: s.fill_category || null,
      status: s.status,
      category_id: s.category_id,
      subcategory_id: s.subcategory_id || null,
      uploaded_at: up && !Number.isNaN(up.getTime()) ? up.toISOString() : (original && original.uploaded_at) || new Date().toISOString(),
    };
    const groupChanged = !editing || original.category_id !== row.category_id || (original.subcategory_id || null) !== row.subcategory_id;
    if (groupChanged) {
      // New/moved samples go first in their group, like the website's "newest first" ordering.
      const group = allSamples.filter((x) => x.category_id === row.category_id && (x.subcategory_id || null) === row.subcategory_id && x.id !== id);
      row.sort_order = group.length ? Math.min(...group.map((x) => x.sort_order)) - 1 : 0;
    }
    if (editing && original.legacy_id) {
      // Keep the original link/tooltip text of imported cards unless the link changed.
      if (original.media_url !== row.media_url) { row.link_title = null; row.tag_title = null; }
    }
    return row;
  }

  async function save(another) {
    const row = buildRow();
    if (!row) return;
    busy = true;
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      const saved = await ctx.data.saveSample(row);
      toast(saved.status === 'published' ? 'Saved — live on the website within ~15 seconds' : `Saved as ${saved.status}`, 'ok');
      if (another) {
        const target = '#/upload?cat=' + encodeURIComponent(saved.category_id) + (saved.subcategory_id ? `&sub=${saved.subcategory_id}` : '');
        if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else ctx.navigate(target);
      } else if (editing) {
        ctx.navigate('#/samples');
      } else {
        ctx.navigate(`#/edit/${saved.id}`);
      }
    } catch (e) {
      $('#formErr').textContent = errMsg(e);
      btn.disabled = false;
      busy = false;
    }
  }

  f.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  if ($('#saveAnother')) $('#saveAnother').addEventListener('click', () => save(true));
  const preview = () => {
    sync();
    if (!s.category_id) { $('#formErr').textContent = 'Choose a category to preview where the card will appear.'; return; }
    openPreview({ ...s, id: id || 'draft-preview', media_provider: s.media_url ? providerOf(s.media_url) : 'image' }, cats);
  };
  $('#previewBtn').addEventListener('click', preview);
  if (document.getElementById('tPreview')) document.getElementById('tPreview').addEventListener('click', preview);
  if ($('#delBtn')) $('#delBtn').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete sample?', message: `“${original.title}” will be permanently removed from the website.`, confirm: 'Delete', danger: true });
    if (!ok) return;
    busy = true;
    try { await ctx.data.deleteSample(id); toast('Sample deleted', 'ok'); ctx.navigate('#/samples'); }
    catch (e) { busy = false; toast(errMsg(e), 'err'); }
  });

  fillSubs();
  paintThumb();
  if (!editing && s.media_url) fetchThumb(true);
}
