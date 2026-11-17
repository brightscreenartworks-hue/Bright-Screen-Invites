// Bright Screen Invites — Admin Panel shell: auth, routing, navigation, idle logout.
import { data } from './data.js';
import { html, raw, icon, toast, esc, errMsg, initials, $, on } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as samples from './views/samples.js';
import * as editor from './views/editor.js';
import * as categories from './views/categories.js';
import * as submissions from './views/submissions.js';
import * as whatsapp from './views/whatsapp.js';
import * as access from './views/access.js';
import * as settings from './views/settings.js';

const app = document.getElementById('app');
const NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: 'dashboard', view: dashboard },
  { path: 'samples', label: 'Manage Samples', icon: 'samples', view: samples },
  { path: 'upload', label: 'Upload New Sample', icon: 'upload', view: editor },
  { path: 'categories', label: 'Categories', icon: 'categories', view: categories },
  { path: 'submissions', label: 'Client Submissions', icon: 'inbox', view: submissions, count: 'fresh' },
  { path: 'whatsapp', label: 'WhatsApp Settings', icon: 'whatsapp', view: whatsapp },
  { path: 'access', label: 'Admin Access', icon: 'shield', view: access },
  { path: 'settings', label: 'Settings', icon: 'settings', view: settings },
];
const ROUTES = { ...Object.fromEntries(NAV.map((n) => [n.path, n.view])), edit: editor };

const state = { me: null, idleTimer: null, idleMinutes: 120, leaveGuard: null };

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    await data.init();
  } catch (e) {
    app.innerHTML = String(html`<div class="auth-wrap"><div class="auth-card">
      <img class="auth-logo" src="../Asset 1.png" alt="Bright Screen Invites">
      <h1>Admin Panel</h1><p class="sub">Setup required</p>
      <div class="auth-msg err">${errMsg(e)}</div>
      <p class="small muted">See <strong>ADMIN_SETUP.md</strong> in the website repository for the 10-minute setup.</p></div></div>`);
    return;
  }
  let recovering = /type=recovery/.test(location.hash);
  data.onAuth((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; renderRecovery(); }
    if (event === 'SIGNED_OUT') { state.me = null; renderLogin(); }
    if (event === 'TOKEN_REFRESHED' && !session) renderLogin('Your session expired — please sign in again.');
  });
  if (recovering) return; // onAuth will render the reset form
  const session = await data.session();
  if (!session) return renderLogin();
  await enter(session);
}

async function enter(session) {
  let ok = false;
  try { ok = await data.isAdmin(); } catch { ok = false; }
  if (!ok) {
    await data.signOut();
    return renderLogin('This account is not authorized to access the admin panel.');
  }
  state.me = { email: session.user.email, id: session.user.id };
  try {
    const g = await data.setting('general');
    state.idleMinutes = Number(g.idle_timeout_minutes) || 120;
  } catch { /* defaults */ }
  renderShell();
  startIdleTimer();
  window.addEventListener('hashchange', route);
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/dashboard';
  else route();
}

// ---------------------------------------------------------------- login
function renderLogin(message = '') {
  window.removeEventListener('hashchange', route);
  stopIdleTimer();
  app.innerHTML = String(html`<div class="auth-wrap"><form class="auth-card" id="loginForm" novalidate>
      <img class="auth-logo" src="../Asset 1.png" alt="Bright Screen Invites">
      <h1>Admin Panel</h1>
      <p class="sub">Sign in to manage Bright Screen Invites</p>
      <div id="loginMsg">${message ? html`<div class="auth-msg err">${message}</div>` : ''}</div>
      <label class="field"><span class="label">Email</span>
        <input class="input" type="email" name="email" autocomplete="username" required autofocus></label>
      <label class="field"><span class="label">Password</span>
        <input class="input" type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn primary block" style="margin-top:18px;padding:11px" type="submit">Sign in</button>
      <p class="auth-foot"><a href="#" id="forgot">Forgot password?</a> · Only authorized admin accounts can sign in.</p>
    </form></div>`);
  const form = $('#loginForm');
  const msg = (t, kind = 'err') => { $('#loginMsg').innerHTML = t ? String(html`<div class="auth-msg ${kind}">${t}</div>`) : ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;
    if (!email || !password) return msg('Enter your email and password.');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const session = await data.signIn(email, password);
      await enter(session);
    } catch (err) {
      msg(errMsg(err));
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
  $('#forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    if (!email) return msg('Type your email above first, then click “Forgot password?”.');
    try { await data.sendReset(email); } catch { /* do not reveal whether the email exists */ }
    msg('If that email belongs to an admin, a password-reset link has been sent.', 'ok');
  });
}

function renderRecovery() {
  app.innerHTML = String(html`<div class="auth-wrap"><form class="auth-card" id="resetForm">
      <img class="auth-logo" src="../Asset 1.png" alt="Bright Screen Invites">
      <h1>Set a new password</h1><p class="sub">At least 10 characters, with letters and numbers.</p>
      <div id="resetMsg"></div>
      <label class="field"><span class="label">New password</span><input class="input" type="password" name="p1" autocomplete="new-password" required></label>
      <label class="field"><span class="label">Repeat password</span><input class="input" type="password" name="p2" autocomplete="new-password" required></label>
      <button class="btn primary block" style="margin-top:18px;padding:11px" type="submit">Save password</button></form></div>`);
  const f = $('#resetForm');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = f.p1.value;
    const bad = p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Use at least 10 characters with letters and numbers.' : p !== f.p2.value ? 'Passwords do not match.' : '';
    if (bad) { $('#resetMsg').innerHTML = String(html`<div class="auth-msg err">${bad}</div>`); return; }
    try {
      await data.updatePassword(p);
      history.replaceState(null, '', '/admin/');
      const s = await data.session();
      if (s) await enter(s); else renderLogin();
      toast('Password updated', 'ok');
    } catch (err) { $('#resetMsg').innerHTML = String(html`<div class="auth-msg err">${errMsg(err)}</div>`); }
  });
}

// ---------------------------------------------------------------- shell
function renderShell() {
  app.innerHTML = String(html`<div class="shell" id="shell">
    <aside class="sidebar" aria-label="Admin navigation">
      <div class="sb-brand"><img src="../Asset 1.png" alt="Bright Screen Invites"><small class="pill-tag">Admin</small></div>
      <nav class="sb-nav">
        <div class="sb-section">Overview</div>
        ${navLink(NAV[0])}
        <div class="sb-section">Website</div>
        ${NAV.slice(1, 4).map(navLink)}
        <div class="sb-section">Clients</div>
        ${NAV.slice(4, 6).map(navLink)}
        <div class="sb-section">System</div>
        ${NAV.slice(6).map(navLink)}
        <button class="sb-link logout" id="logoutBtn" type="button">${icon('logout')}<span>Logout</span></button>
      </nav>
      <div class="sb-foot">
        <div class="sb-user"><div class="avatar">${initials(state.me.email)}</div><div class="email" title="${state.me.email}">${state.me.email}</div></div>
        <a href="../index.html" target="_blank" rel="noopener">View live website ↗</a>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="btn ghost icon menu-btn" id="menuBtn" aria-label="Open menu">${icon('menu')}</button>
        <div class="titles"><div class="crumbs" id="crumbs">Bright Screen Invites</div><h1 id="pageTitle">Dashboard</h1></div>
        <span class="spacer"></span>
        <div id="topActions" class="row"></div>
      </header>
      <section class="content" id="content" tabindex="-1"></section>
    </div>
    <nav class="bottom-nav" aria-label="Quick navigation">
      <a href="#/dashboard" data-nav="dashboard">${icon('dashboard')}<span>Home</span></a>
      <a href="#/samples" data-nav="samples">${icon('samples')}<span>Samples</span></a>
      <a href="#/upload" data-nav="upload" class="fab" aria-label="Upload new sample"><span class="circle">${icon('plus')}</span></a>
      <a href="#/submissions" data-nav="submissions">${icon('inbox')}<span>Clients</span><span class="dot" data-count="fresh" hidden></span></a>
      <button type="button" id="moreBtn">${icon('menu')}<span>More</span></button>
    </nav>
  </div>`);
  $('#logoutBtn').addEventListener('click', logout);
  $('#menuBtn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#moreBtn').addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => $('#shell').classList.remove('nav-open'));
  refreshCounts();
}

function navLink(n) {
  return html`<a class="sb-link" href="#/${n.path}" data-nav="${n.path}">${icon(n.icon)}<span>${n.label}</span>${n.count ? html`<span class="count" data-count="${n.count}" hidden></span>` : ''}</a>`;
}

async function refreshCounts() {
  try {
    const s = await data.stats();
    document.querySelectorAll('[data-count="fresh"]').forEach((el) => {
      el.textContent = s.fresh;
      el.hidden = !s.fresh;
    });
    return s;
  } catch { return null; }
}

async function logout() {
  if (state.leaveGuard && !state.leaveGuard()) return;
  stopIdleTimer();
  await data.signOut();
  location.hash = '';
  renderLogin();
  toast('Signed out');
}

// ---------------------------------------------------------------- router
let routeSeq = 0;
async function route() {
  if (!state.me) return;
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').map(decodeURIComponent);
  const [path, ...rest] = parts;
  const view = ROUTES[path];
  if (!view) { location.hash = '#/dashboard'; return; }
  if (state.leaveGuard && !state.leaveGuard()) {
    history.replaceState(null, '', state.lastHash || '#/dashboard');
    return;
  }
  state.leaveGuard = null;
  state.lastHash = location.hash;
  const seq = ++routeSeq;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (path === 'edit' ? 'samples' : path)));
  $('#shell').classList.remove('nav-open');
  const content = $('#content');
  $('#topActions').innerHTML = '';
  content.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';
  const ctx = {
    el: content,
    data,
    me: state.me,
    params: rest,
    query: new URLSearchParams(location.hash.split('?')[1] || ''),
    setTitle(title, crumbs = 'Bright Screen Invites') {
      $('#pageTitle').textContent = title;
      $('#crumbs').textContent = crumbs;
      document.title = `${title} · Admin · Bright Screen Invites`;
    },
    setActions(markup) { $('#topActions').innerHTML = String(markup || ''); return $('#topActions'); },
    navigate(hash) { location.hash = hash; },
    refreshCounts,
    guardLeave(fn) { state.leaveGuard = fn; },
    isCurrent: () => seq === routeSeq,
  };
  try {
    await view.render(ctx);
    content.focus({ preventScroll: true });
  } catch (err) {
    if (seq !== routeSeq) return;
    console.error(err);
    content.innerHTML = String(html`<div class="card"><div class="empty-state"><div class="big">⚠️</div>
      <p><strong>Could not load this page.</strong></p><p>${errMsg(err)}</p>
      <button class="btn" id="retryBtn">${icon('refresh')} Try again</button></div></div>`);
    $('#retryBtn').addEventListener('click', route);
    if (/JWT|session|not authorized/i.test(String(err && err.message))) {
      const s = await data.session();
      if (!s) renderLogin('Your session expired — please sign in again.');
    }
  }
}

// ---------------------------------------------------------------- idle logout
function startIdleTimer() {
  stopIdleTimer();
  const reset = () => {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(async () => {
      await data.signOut();
      renderLogin('You were signed out after a period of inactivity.');
    }, state.idleMinutes * 60 * 1000);
  };
  state.idleReset = reset;
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((e) => window.addEventListener(e, reset, { passive: true }));
  reset();
}
function stopIdleTimer() {
  clearTimeout(state.idleTimer);
  if (state.idleReset) ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((e) => window.removeEventListener(e, state.idleReset));
}

window.addEventListener('beforeunload', (e) => {
  if (state.leaveGuard && !state.leaveGuard(true)) { e.preventDefault(); e.returnValue = ''; }
});

boot();
