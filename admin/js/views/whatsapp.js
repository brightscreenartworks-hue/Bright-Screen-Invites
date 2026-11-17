// WhatsApp Settings: where client submissions are forwarded. Secrets stay in Vercel env vars;
// only non-secret choices (provider, destination number, on/off) are stored here.
import { html, icon, toast, errMsg, fmtDate } from '../ui.js';

const PROVIDERS = {
  callmebot: {
    name: 'CallMeBot (free — easiest)',
    env: ['CALLMEBOT_API_KEY'],
    steps: [
      'Open callmebot.com → “WhatsApp API” and follow the activation steps from the business WhatsApp phone (you save their number and send them an activation message).',
      'You’ll receive a personal API key on WhatsApp. In Vercel → Settings → Environment Variables, add CALLMEBOT_API_KEY with that key, then redeploy.',
      'Set the destination below to that same business number and press “Send test message”.',
    ],
  },
  meta: {
    name: 'WhatsApp Cloud API (Meta — official)',
    env: ['META_WA_TOKEN', 'META_WA_PHONE_NUMBER_ID', 'META_WA_TEMPLATE (recommended)', 'META_WA_TEMPLATE_LANG (optional, default en)'],
    steps: [
      'Create a Meta developer app with the WhatsApp product and a sending phone number.',
      'Create a permanent System User access token with whatsapp_business_messaging permission.',
      'Create and get approval for a utility message template with ONE body variable, e.g. “New client submission: {{1}}”.',
      'Add META_WA_TOKEN, META_WA_PHONE_NUMBER_ID and META_WA_TEMPLATE in Vercel environment variables, then redeploy.',
    ],
  },
  twilio: {
    name: 'Twilio WhatsApp',
    env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'],
    steps: [
      'Enable a WhatsApp sender in Twilio (or the sandbox for testing).',
      'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM (the sender number) in Vercel, then redeploy.',
    ],
  },
};

export async function render(ctx) {
  ctx.setTitle('WhatsApp Settings', 'Clients');
  const [cfg, status, failedList] = await Promise.all([
    ctx.data.setting('whatsapp'),
    ctx.data.whatsappStatus().catch((e) => ({ error: errMsg(e), providers: {} })),
    ctx.data.submissions({ wa: 'failed', pageSize: 10 }).catch(() => ({ rows: [] })),
  ]);
  if (!ctx.isCurrent()) return;
  const s = { enabled: true, provider: 'callmebot', destination: '', include_admin_link: true, ...cfg };
  const failed = failedList.rows || [];

  const paint = () => {
    const prov = PROVIDERS[s.provider] || PROVIDERS.callmebot;
    const ready = !!(status.providers || {})[s.provider];
    ctx.el.innerHTML = String(html`
      <div class="split">
        <div class="stack">
          <form class="card" id="waForm">
            <div class="card-h"><h2>Forwarding</h2><span class="spacer"></span>
              ${s.enabled ? (ready ? html`<span class="pill green">Active</span>` : html`<span class="pill amber">Needs credentials</span>`) : html`<span class="pill grey">Off</span>`}</div>
            <div class="card-b">
              <label class="switch"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}><span class="track"></span>
                <span><strong>Send every new client submission to WhatsApp</strong><br><span class="small muted">Submissions are always saved to the database first, even if WhatsApp fails.</span></span></label>
              <div class="hr"></div>
              <label class="field"><span class="label">Business WhatsApp number (destination)</span>
                <input class="input" name="destination" inputmode="tel" value="${s.destination}" placeholder="e.g. 918745028722">
                <div class="hint">Country code + number, digits only (India: 91…).</div></label>
              <label class="field"><span class="label">Sending method</span>
                <select class="select" name="provider">${Object.entries(PROVIDERS).map(([k, v]) => html`<option value="${k}" ${s.provider === k ? 'selected' : ''}>${v.name}${(status.providers || {})[k] ? ' ✓ configured' : ''}</option>`)}</select></label>
              <label class="check" style="margin-top:14px"><input type="checkbox" name="include_admin_link" ${s.include_admin_link !== false ? 'checked' : ''}> Include a link to the submission in the admin panel</label>
              <div class="row" style="margin-top:18px">
                <button class="btn primary" type="submit">${icon('check')} Save settings</button>
                <button class="btn" type="button" id="testBtn">${icon('send')} Send test message</button>
              </div>
              <p class="small" id="testResult" style="margin:12px 0 0"></p>
            </div>
          </form>

          <div class="card"><div class="card-h"><h2>Recent delivery failures</h2></div>
            ${failed.length ? html`<div class="table-wrap"><table class="tbl"><tbody>${failed.map((r) => html`<tr class="clickable" data-id="${r.id}">
              <td><strong>${r.client_name || 'Client'}</strong><div class="small muted">${r.ref} · ${fmtDate(r.created_at)}</div></td>
              <td class="small muted">${r.whatsapp_error || ''}</td></tr>`)}</tbody></table></div>`
              : html`<div class="empty-state">No failed deliveries 🎉</div>`}
          </div>
        </div>

        <div class="card"><div class="card-h"><h2>Setup: ${prov.name}</h2></div><div class="card-b">
          <p class="small muted" style="margin-top:0">For security, credentials are never stored in the database or shown in the browser. They live only in your Vercel environment variables:</p>
          <ul class="small" style="padding-left:18px">${prov.env.map((e) => html`<li class="mono">${e}</li>`)}</ul>
          <p class="small" style="margin:10px 0 6px"><strong>Steps</strong></p>
          <ol class="small" style="padding-left:18px;margin:0">${prov.steps.map((st) => html`<li style="margin-bottom:6px">${st}</li>`)}</ol>
          <p class="small" style="margin-top:12px">Status: ${ready ? html`<span class="pill green">Credentials found</span>` : html`<span class="pill amber">Credentials missing</span>`}</p>
          ${status.error ? html`<p class="small" style="color:var(--red)">${status.error}</p>` : ''}
        </div></div>
      </div>`);
    bind();
  };

  function bind() {
    const f = ctx.el.querySelector('#waForm');
    f.provider.addEventListener('change', () => { s.provider = f.provider.value; s.destination = f.destination.value; s.enabled = f.enabled.checked; paint(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dest = f.destination.value.replace(/[^0-9]/g, '');
      if (f.enabled.checked && (dest.length < 10 || dest.length > 15)) { toast('Enter the destination number with country code, e.g. 918745028722', 'err'); return; }
      Object.assign(s, { enabled: f.enabled.checked, destination: dest, provider: f.provider.value, include_admin_link: f.include_admin_link.checked });
      try { await ctx.data.saveSetting('whatsapp', s); toast('WhatsApp settings saved', 'ok'); paint(); } catch (er) { toast(errMsg(er), 'err'); }
    });
    ctx.el.querySelector('#testBtn').addEventListener('click', async (e) => {
      const out = ctx.el.querySelector('#testResult');
      e.currentTarget.disabled = true;
      out.textContent = 'Sending… (uses the SAVED settings)';
      try {
        const r = await ctx.data.whatsappTest();
        out.innerHTML = r.ok ? '✅ Test message sent — check the business WhatsApp.' : String(html`<span style="color:var(--red)">⚠️ ${r.error || 'Sending failed'}</span>`);
      } catch (er) { out.innerHTML = String(html`<span style="color:var(--red)">⚠️ ${errMsg(er)}</span>`); }
      e.currentTarget && (e.currentTarget.disabled = false);
      ctx.el.querySelector('#testBtn').disabled = false;
    });
    ctx.el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate(`#/submissions/${tr.dataset.id}`)));
  }
  paint();
}
