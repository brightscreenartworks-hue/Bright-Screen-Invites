// Client Submissions: permanent inbox with search, filters, status, notes, history, export, WhatsApp resend.
import { html, icon, toast, errMsg, fmtDate, timeAgo, statusPill, STATUS, WA_STATUS, debounce, download, toCsv, confirmDialog, esc } from '../ui.js';

const F = { search: '', status: '', category: '', from: '', to: '', page: 1, wa: '' };
const PAGE_SIZE = 25;

const CSV_COLS = [
  { label: 'Reference', get: (r) => r.ref },
  { label: 'Submitted', get: (r) => new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
  { label: 'Status', get: (r) => (STATUS[r.status] || {}).label || r.status },
  { label: 'Client name', get: (r) => r.client_name },
  { label: 'WhatsApp', get: (r) => r.client_whatsapp },
  { label: 'Email', get: (r) => r.client_email },
  { label: 'Category', get: (r) => r.category },
  { label: 'Selected design', get: (r) => r.sample_name },
  { label: 'Design link', get: (r) => r.sample_link },
  { label: 'Bride', get: (r) => (r.payload.couple || {}).brideName || r.payload.bride },
  { label: 'Groom', get: (r) => (r.payload.couple || {}).groomName || r.payload.groom },
  { label: 'Events', get: (r) => (r.payload.events || []).map((e) => [e.name, e.date, e.time, e.venue].filter(Boolean).join(' · ')).join(' | ') },
  { label: 'Notes from client', get: (r) => r.payload.notes },
  { label: 'Drive link', get: (r) => r.payload.cloudLink },
  { label: 'WhatsApp delivery', get: (r) => r.whatsapp_status },
  { label: 'Source', get: (r) => r.source },
  { label: 'Full details (JSON)', get: (r) => r.payload },
];

export async function render(ctx) {
  if (ctx.params[0]) return renderDetail(ctx, ctx.params[0]);
  ctx.setTitle('Client Submissions', 'Clients');
  if (ctx.query.get('status') !== null) { F.status = ctx.query.get('status') || ''; F.page = 1; }
  F.wa = ctx.query.get('wa') || '';

  const cats = await ctx.data.submissionCategories().catch(() => []);
  if (!ctx.isCurrent()) return;

  ctx.setActions(html`<button class="btn" id="exportCsv">${icon('download')} Export CSV</button><button class="btn" id="exportJson">${icon('download')} JSON</button>`);

  ctx.el.innerHTML = String(html`
    <div class="toolbar">
      <label class="search"><span class="sr-only">Search</span>${icon('search')}<input class="input" id="q" placeholder="Search name, phone, email, design or reference…" value="${F.search}"></label>
      <select class="select" id="fs" aria-label="Status"><option value="">All statuses</option>
        ${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${F.status === k ? 'selected' : ''}>${v.label}</option>`)}</select>
      <select class="select" id="fc" aria-label="Category"><option value="">All categories</option>
        ${cats.map((c) => html`<option ${F.category === c ? 'selected' : ''}>${c}</option>`)}</select>
      <label class="row small muted" style="gap:6px">From <input class="input" type="date" id="ff" value="${F.from}" style="min-width:0;width:150px"></label>
      <label class="row small muted" style="gap:6px">To <input class="input" type="date" id="ft" value="${F.to}" style="min-width:0;width:150px"></label>
      <button class="btn ghost sm" id="clr">Clear</button>
    </div>
    ${F.wa ? html`<div class="alert warn">Showing submissions whose WhatsApp delivery failed. <span class="spacer"></span><a class="btn sm" href="#/submissions">Show all</a></div>` : ''}
    <div class="card" id="list"><div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div></div>`);

  const $ = (s) => ctx.el.querySelector(s);
  const load = async () => {
    if (!ctx.isCurrent()) return;
    const box = $('#list');
    try {
      const { rows, count } = await ctx.data.submissions({ ...F, pageSize: PAGE_SIZE });
      if (!ctx.isCurrent() || !box.isConnected) return;
      const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
      box.innerHTML = String(rows.length ? html`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Client</th><th class="hide-sm">Design</th><th class="hide-sm">Category</th><th>Status</th><th class="hide-sm">Submitted</th><th class="hide-sm" title="WhatsApp delivery">WA</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr class="clickable ${r.status === 'new' ? 'is-new' : ''}" data-id="${r.id}" tabindex="0">
            <td><div class="t-strong">${r.client_name || '—'}</div><div class="small muted">${r.client_whatsapp || r.client_email || ''} · <span class="mono">${r.ref}</span></div></td>
            <td class="hide-sm">${r.sample_name || '—'}</td>
            <td class="hide-sm">${r.category || '—'}</td>
            <td>${statusPill(STATUS, r.status)}</td>
            <td class="hide-sm" title="${fmtDate(r.created_at)}">${timeAgo(r.created_at)}</td>
            <td class="hide-sm">${r.whatsapp_status === 'sent' ? '✅' : r.whatsapp_status === 'failed' ? html`<span title="${r.whatsapp_error || ''}">⚠️</span>` : '—'}</td></tr>`)}</tbody></table></div>
        <div class="pager"><span>${count} submission${count === 1 ? '' : 's'}</span>
          <button class="btn sm" data-pg="-1" ${F.page <= 1 ? 'disabled' : ''}>← Prev</button><span>Page ${F.page} / ${pages}</span>
          <button class="btn sm" data-pg="1" ${F.page >= pages ? 'disabled' : ''}>Next →</button></div>`
        : html`<div class="empty-state"><div class="big">📭</div>${F.search || F.status || F.category || F.from || F.to ? 'No submissions match these filters.' : 'No submissions yet. They appear here as soon as a client submits details on the website.'}</div>`);
      box.querySelectorAll('tr[data-id]').forEach((tr) => {
        const go = () => ctx.navigate(`#/submissions/${tr.dataset.id}`);
        tr.addEventListener('click', go);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      });
      box.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => { F.page += Number(b.dataset.pg); load(); }));
    } catch (e) { box.innerHTML = String(html`<div class="empty-state">⚠️ ${errMsg(e)}</div>`); }
  };

  $('#q').addEventListener('input', debounce(() => { F.search = $('#q').value; F.page = 1; load(); }, 300));
  $('#fs').addEventListener('change', () => { F.status = $('#fs').value; F.page = 1; load(); });
  $('#fc').addEventListener('change', () => { F.category = $('#fc').value; F.page = 1; load(); });
  $('#ff').addEventListener('change', () => { F.from = $('#ff').value; F.page = 1; load(); });
  $('#ft').addEventListener('change', () => { F.to = $('#ft').value; F.page = 1; load(); });
  $('#clr').addEventListener('click', () => { Object.assign(F, { search: '', status: '', category: '', from: '', to: '', page: 1, wa: '' }); ctx.navigate('#/submissions'); render(ctx); });

  const exportAll = async (kind) => {
    try {
      toast('Preparing export…');
      const { rows } = await ctx.data.submissions({ ...F, all: true });
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'csv') download(`bright-screen-submissions-${stamp}.csv`, toCsv(rows, CSV_COLS), 'text/csv;charset=utf-8');
      else download(`bright-screen-submissions-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
      toast(`Exported ${rows.length} submission${rows.length === 1 ? '' : 's'}`, 'ok');
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  document.getElementById('exportCsv').addEventListener('click', () => exportAll('csv'));
  document.getElementById('exportJson').addEventListener('click', () => exportAll('json'));
  load();
}

// ---------------------------------------------------------------- detail
function digits(v) { return String(v || '').replace(/[^0-9]/g, ''); }

function detailsBlock(p) {
  const c = p.couple || {};
  const rows = [];
  const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') rows.push([k, v]); };
  add('Bride', c.brideName || p.bride); add('Bride’s family', c.brideParents);
  add('Groom', c.groomName || p.groom); add('Groom’s family', c.groomParents);
  add('Event date', p.eventDate || p.weddingDate); add('Venue', p.venue); add('City', p.city);
  add('Format', p.orientation); add('Events', typeof p.eventsList === 'string' ? p.eventsList : '');
  add('Hashtag', p.hashtag); add('Quote / verse', p.quote); add('RSVP', p.rsvp);
  add('Client notes', p.notes); add('Drive link', p.cloudLink);
  add('Files mentioned', Array.isArray(p.files) && p.files.length ? p.files.join(', ') : '');
  const known = new Set(['couple', 'events', 'bride', 'groom', 'eventDate', 'weddingDate', 'venue', 'city', 'orientation', 'eventsList', 'hashtag', 'quote', 'rsvp', 'notes', 'cloudLink', 'files', 'fullName', 'phone', 'whatsapp', 'email', 'sampleId']);
  Object.entries(p).forEach(([k, v]) => { if (!known.has(k) && v !== null && typeof v !== 'object') add(k, v); });
  return rows;
}

const linkify = (v) => (/^https?:\/\/\S+$/.test(String(v)) ? html`<a href="${v}" target="_blank" rel="noopener noreferrer">${v}</a>` : v);

async function renderDetail(ctx, id) {
  ctx.setTitle('Submission', 'Client Submissions');
  let { row, notes, events } = await ctx.data.submission(id);
  if (!ctx.isCurrent()) return;
  if (!row) {
    ctx.el.innerHTML = String(html`<div class="card"><div class="empty-state"><div class="big">🔎</div>This submission no longer exists (it may have been deleted — check Settings → Recovery bin).<br><br><a class="btn" href="#/submissions">${icon('arrowLeft')} Back to submissions</a></div></div>`);
    return;
  }
  ctx.setTitle(row.client_name || 'Submission', `Client Submissions · ${row.ref}`);
  ctx.setActions(html`<a class="btn" href="#/submissions">${icon('arrowLeft')} All submissions</a>`);

  const paint = () => {
    const p = row.payload || {};
    const evs = Array.isArray(p.events) ? p.events : [];
    const wa = digits(row.client_whatsapp);
    ctx.el.innerHTML = String(html`
      <div class="split wide-side">
        <div class="stack">
          <div class="card"><div class="card-h"><h2>Contact</h2><span class="spacer"></span>${statusPill(STATUS, row.status)}</div><div class="card-b">
            <dl class="kv">
              <dt>Name</dt><dd><strong>${row.client_name || '—'}</strong></dd>
              <dt>WhatsApp</dt><dd>${row.client_whatsapp || '—'}</dd>
              <dt>Email</dt><dd>${row.client_email ? html`<a href="mailto:${row.client_email}">${row.client_email}</a>` : '—'}</dd>
              <dt>Submitted</dt><dd>${fmtDate(row.created_at)} <span class="muted">(${timeAgo(row.created_at)})</span></dd>
              <dt>Reference</dt><dd class="mono">${row.ref}</dd>
              <dt>Source</dt><dd>${row.source === 'fill-details' ? 'Fill Details form' : row.source === 'index-personalize' ? 'Home page personalisation form' : row.source}</dd>
            </dl>
            <div class="row" style="margin-top:14px">
              ${wa ? html`<a class="btn wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Chat on WhatsApp</a>` : ''}
              ${row.client_email ? html`<a class="btn" href="mailto:${row.client_email}?subject=${encodeURIComponent(`Your Bright Screen Invites order ${row.ref}`)}">${icon('mail')} Email</a>` : ''}
              ${wa ? html`<a class="btn" href="tel:+${wa}">${icon('phone')} Call</a>` : ''}
            </div>
          </div></div>

          <div class="card"><div class="card-h"><h2>Selected design</h2></div><div class="card-b">
            <dl class="kv"><dt>Design</dt><dd><strong>${row.sample_name || 'Custom request'}</strong></dd>
              <dt>Category</dt><dd>${row.category || '—'}</dd>
              <dt>Link</dt><dd>${row.sample_link ? linkify(row.sample_link) : '—'}</dd></dl>
          </div></div>

          <div class="card"><div class="card-h"><h2>Wedding details</h2></div><div class="card-b">
            ${(() => { const r = detailsBlock(p); return r.length ? html`<dl class="kv">${r.map(([k, v]) => html`<dt>${k}</dt><dd>${linkify(v)}</dd>`)}</dl>` : html`<p class="muted" style="margin:0">No extra details.</p>`; })()}
            ${evs.length ? html`<h3 style="font-size:13px;margin:18px 0 8px">Functions & schedule</h3><div class="table-wrap"><table class="tbl events-tbl">
              <thead><tr><th>#</th><th>Function</th><th>Date</th><th>Time</th><th>Venue</th><th>Attire</th></tr></thead>
              <tbody>${evs.map((e, i) => html`<tr><td>${i + 1}</td><td><strong>${e.name || ''}</strong></td><td>${e.date || ''}</td><td>${e.time || ''}</td><td>${e.venue || ''}</td><td>${e.dress || ''}</td></tr>`)}</tbody></table></div>` : ''}
          </div></div>

          ${Array.isArray(p.attachments) && p.attachments.length ? html`<div class="card"><div class="card-h"><h2>Caricature photos & files</h2><span class="spacer"></span><span class="small muted">${p.attachments.length} file${p.attachments.length === 1 ? '' : 's'}</span></div>
            <div class="card-b"><div class="att-grid" id="attGrid"><p class="small muted" style="margin:0">Loading photos…</p></div></div></div>` : ''}

          ${row.summary_text ? html`<div class="card"><div class="card-h"><h2>Message as sent</h2><span class="spacer"></span><button class="btn sm" id="copySummary">${icon('copy')} Copy</button></div>
            <div class="card-b"><div class="pre">${row.summary_text}</div></div></div>` : ''}
        </div>

        <div class="stack">
          <div class="card"><div class="card-h"><h2>Status</h2></div><div class="card-b">
            <div class="segmented" id="statusSeg" style="width:100%">${Object.entries(STATUS).map(([k, v]) => html`<button type="button" data-st="${k}" class="${row.status === k ? 'on' : ''}">${v.label}</button>`)}</div>
          </div></div>

          <div class="card"><div class="card-h"><h2>WhatsApp delivery</h2><span class="spacer"></span>${statusPill(WA_STATUS, row.whatsapp_status)}</div><div class="card-b">
            <p class="small muted" style="margin:0 0 10px">${row.whatsapp_status === 'sent' ? `Delivered to the business WhatsApp ${fmtDate(row.whatsapp_sent_at)}.` : row.whatsapp_status === 'failed' ? `Failed: ${row.whatsapp_error || 'unknown error'}. The submission itself is safely stored.` : row.whatsapp_status === 'disabled' ? 'WhatsApp forwarding was turned off when this arrived.' : 'Not sent yet.'}
              ${row.whatsapp_attempts ? ` (${row.whatsapp_attempts} attempt${row.whatsapp_attempts === 1 ? '' : 's'})` : ''}</p>
            <button class="btn sm" id="resend">${icon('send')} ${row.whatsapp_status === 'sent' ? 'Send again' : 'Retry sending'}</button>
          </div></div>

          <div class="card"><div class="card-h"><h2>Internal notes</h2><span class="small muted">Only admins see these</span></div><div class="card-b">
            ${notes.length ? notes.map((n) => html`<div class="note"><div style="white-space:pre-wrap">${n.body}</div><div class="w">${n.author} · ${fmtDate(n.created_at)}</div></div>`) : html`<p class="small muted" style="margin:0">No notes yet.</p>`}
            <form id="noteForm" style="margin-top:12px"><textarea class="textarea" name="body" rows="3" maxlength="4000" placeholder="Add a note (call outcome, quote, next step…)" required></textarea>
              <button class="btn sm primary" style="margin-top:8px" type="submit">Add note</button></form>
          </div></div>

          <div class="card"><div class="card-h"><h2>History</h2></div><div class="card-b">
            <ul class="timeline">${events.slice().reverse().map((e) => html`<li><div>${eventText(e)}</div><div class="w">${e.actor === 'client' ? 'Client' : e.actor === 'system' ? 'System' : e.actor} · ${fmtDate(e.created_at)}</div></li>`)}</ul>
          </div></div>

          <div class="card"><div class="card-b row between"><span class="small muted">Records are kept permanently unless you delete them.</span>
            <button class="btn sm danger" id="delSub">${icon('trash')} Delete</button></div></div>
        </div>
      </div>`);
    bind();
  };

  const eventText = (e) => {
    const d = e.detail || {};
    if (e.type === 'created') return 'Submission received from the website';
    if (e.type === 'status') return html`Status changed from <strong>${(STATUS[d.from] || {}).label || d.from}</strong> to <strong>${(STATUS[d.to] || {}).label || d.to}</strong>`;
    if (e.type === 'note') return html`Note added${d.preview ? html`: <em>“${d.preview}”</em>` : ''}`;
    if (e.type === 'whatsapp') return d.status === 'sent' ? 'Sent to business WhatsApp' : html`WhatsApp ${d.status}${d.error ? html` — <span class="muted">${d.error}</span>` : ''}`;
    if (e.type === 'restored') return 'Restored from the recovery bin';
    return e.type;
  };

  const reload = async () => { ({ row, notes, events } = await ctx.data.submission(id)); if (row && ctx.isCurrent()) paint(); };

  async function loadFiles() {
    const grid = ctx.el.querySelector('#attGrid');
    if (!grid) return;
    try {
      const { files } = await ctx.data.submissionFiles(id);
      if (!ctx.isCurrent() || !grid.isConnected) return;
      const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
      grid.innerHTML = String(html`${files.map((f) => {
        const isImg = /^image\//.test(f.type || '') && !/hei[cf]/i.test(f.type || '');
        const dl = f.url ? `${f.url}${f.url.includes('?') ? '&' : '?'}download=${encodeURIComponent(f.name || 'file')}` : '';
        return html`<div class="att">
          ${f.url && isImg ? html`<a class="att-img" href="${f.url}" target="_blank" rel="noopener"><img src="${f.url}" alt="${f.name}" loading="lazy"></a>`
            : html`<div class="att-img att-file">${icon('file')}<span>${(String(f.name || '').split('.').pop() || 'file').toUpperCase()}</span></div>`}
          <div class="att-meta"><div class="att-name" title="${f.name}">${f.name}</div><div class="small muted">${f.size ? kb(f.size) : ''}</div></div>
          ${f.url ? html`<div class="att-actions"><a class="btn sm" href="${f.url}" target="_blank" rel="noopener">Open</a><a class="btn sm" href="${dl}">Download</a></div>` : html`<div class="small muted">Unavailable</div>`}
        </div>`;
      })}`);
    } catch (er) {
      grid.innerHTML = String(html`<p class="small muted" style="margin:0">Could not load photos: ${errMsg(er)}</p>`);
    }
  }

  function bind() {
    const el = ctx.el;
    loadFiles();
    el.querySelector('#statusSeg').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-st]');
      if (!b || b.dataset.st === row.status) return;
      try { await ctx.data.setSubmissionStatus(id, b.dataset.st); toast(`Marked as ${STATUS[b.dataset.st].label}`, 'ok'); await reload(); ctx.refreshCounts(); }
      catch (er) { toast(errMsg(er), 'err'); }
    });
    el.querySelector('#noteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = e.target.body.value.trim();
      if (!body) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try { await ctx.data.addNote(id, body); toast('Note added', 'ok'); await reload(); }
      catch (er) { toast(errMsg(er), 'err'); btn.disabled = false; }
    });
    el.querySelector('#resend').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await ctx.data.resendWhatsApp(id);
        toast(r.ok ? 'Sent to WhatsApp' : 'WhatsApp sending failed — check WhatsApp Settings', r.ok ? 'ok' : 'err');
        await reload();
      } catch (er) { toast(errMsg(er), 'err'); btn.disabled = false; }
    });
    const copy = el.querySelector('#copySummary');
    if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(row.summary_text); toast('Copied', 'ok'); } catch { toast('Could not copy', 'err'); } });
    el.querySelector('#delSub').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete this submission?',
        message: `This removes ${row.client_name || 'this client'}’s submission (${row.ref}) from the inbox. A copy is kept in Settings → Recovery bin so it can be restored.`,
        confirm: 'Delete submission', danger: true, typeToConfirm: 'DELETE',
      });
      if (!ok) return;
      try { await ctx.data.deleteSubmission(id); toast('Submission deleted (recoverable from Settings)', 'ok'); ctx.refreshCounts(); ctx.navigate('#/submissions'); }
      catch (er) { toast(errMsg(er), 'err'); }
    });
  }

  paint();
  void esc;
}
