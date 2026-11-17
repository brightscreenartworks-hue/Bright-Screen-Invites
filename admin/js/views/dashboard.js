import { html, icon, timeAgo, siteUrl, statusPill, STATUS, esc } from '../ui.js';

const ACT_ICON = { sample: '🖼️', category: '🗂️', submission: '📩', admin: '🛡️', settings: '⚙️' };

export async function render(ctx) {
  ctx.setTitle('Dashboard', 'Overview');
  ctx.setActions(html`<a class="btn primary" href="#/upload">${icon('plus')} Upload sample</a>`);
  const [stats, activity, latest, recent, cats] = await Promise.all([
    ctx.data.stats(), ctx.data.activity(12), ctx.data.latestSamples(6), ctx.data.recentSubmissions(5), ctx.data.categories(),
  ]);
  if (!ctx.isCurrent()) return;
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));

  ctx.el.innerHTML = String(html`
    ${stats.failed ? html`<div class="alert warn">⚠️ <span>${stats.failed} submission${stats.failed > 1 ? 's' : ''} could not be delivered to WhatsApp (they are safely saved).</span>
      <span class="spacer"></span><a class="btn sm" href="#/submissions?wa=failed">Review</a></div>` : ''}
    <div class="stats">
      <a class="card stat" href="#/samples"><div class="ico">${icon('samples')}</div><div class="k">Total Samples</div><div class="v">${stats.samples}</div><div class="s">${stats.published} published</div></a>
      <a class="card stat" href="#/categories"><div class="ico">${icon('categories')}</div><div class="k">Total Categories</div><div class="v">${stats.categories}</div><div class="s">+ ${stats.subs} subcategories</div></a>
      <a class="card stat" href="#/submissions"><div class="ico">${icon('inbox')}</div><div class="k">Client Submissions</div><div class="v">${stats.total}</div><div class="s">Stored permanently</div></a>
      <a class="card stat ${stats.fresh ? 'hot' : ''}" href="#/submissions?status=new"><div class="ico">${icon('sparkle')}</div><div class="k">New Submissions</div><div class="v">${stats.fresh}</div><div class="s">${stats.fresh ? 'Waiting for you' : 'All caught up'}</div></a>
    </div>
    <div class="split wide-side">
      <div class="stack">
        <div class="card">
          <div class="card-h"><h2>Latest Uploaded Samples</h2><span class="spacer"></span><a class="btn sm ghost" href="#/samples">View all</a></div>
          ${latest.length ? html`<div class="latest">${latest.map((s) => html`
            <a href="#/edit/${s.id}"><div class="th"><img loading="lazy" src="${siteUrl(s.custom_thumbnail_url || s.auto_thumbnail_url)}" alt=""></div>
              <div class="tt">${s.title}</div><div class="cc">${catName[s.subcategory_id] || catName[s.category_id] || ''} · ${timeAgo(s.created_at)}</div></a>`)}</div>`
            : html`<div class="empty-state">No samples yet. <a href="#/upload">Upload the first one →</a></div>`}
        </div>
        <div class="card">
          <div class="card-h"><h2>Recent Submissions</h2><span class="spacer"></span><a class="btn sm ghost" href="#/submissions">Open inbox</a></div>
          ${recent.length ? html`<div class="table-wrap"><table class="tbl"><tbody>${recent.map((r) => html`
            <tr class="clickable ${r.status === 'new' ? 'is-new' : ''}" data-href="#/submissions/${r.id}">
              <td><div class="t-strong">${r.client_name || 'Client'}</div><div class="small muted">${r.ref}</div></td>
              <td class="hide-sm">${r.sample_name || '—'}</td>
              <td>${statusPill(STATUS, r.status)}</td>
              <td class="small muted hide-sm">${timeAgo(r.created_at)}</td></tr>`)}</tbody></table></div>`
            : html`<div class="empty-state">No submissions yet — they will appear here as clients fill in their details.</div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Recent Activity</h2></div>
        ${activity.length ? html`<ul class="activity">${activity.map((a) => html`
          <li><div class="dot">${ACT_ICON[a.entity] || '•'}</div>
            <div><div class="t"><strong>${a.actor === 'client' ? 'A client' : a.actor === 'system' ? 'System' : a.actor.split('@')[0]}</strong> ${a.action} ${a.entity} <strong>${a.summary || ''}</strong></div>
            <div class="w">${timeAgo(a.created_at)}</div></div></li>`)}</ul>`
          : html`<div class="empty-state">No activity yet.</div>`}
      </div>
    </div>`);
  ctx.el.querySelectorAll('[data-href]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate(tr.dataset.href)));
  void esc;
}
