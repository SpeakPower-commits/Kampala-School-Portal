/* =========================================================================
   sms.js — SMS to guardians in the online edition, through the school's own
   Africa's Talking account: fee reminders, absence alerts and notices, plus
   the account settings and the log under Administration → SMS.

   The database decides who may send what and writes every message
   (sms_create_campaign in migration 0002); the Cloudflare Worker sends them
   in batches. The browser never sees the school's Africa's Talking key.
   In the offline edition none of this runs; the tap-to-SMS links stay.
   ========================================================================= */
'use strict';

const SMS = (function () {
  let cache = null;   // the school's SMS status for this sign-in

  const apiBase = () => (window.PORTAL && PORTAL.config && PORTAL.config.apiUrl) || '/api';
  const db = () => ONLINE.client();
  async function token() {
    const { data } = await db().auth.getSession();
    return data && data.session ? data.session.access_token : '';
  }
  /* Call the Worker as the signed-in member of staff. */
  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(apiBase() + path, {
        method, body: body ? JSON.stringify(body) : undefined,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token() },
      });
    } catch (_) { throw new Error('No connection to the SMS service. Check the internet and try again.'); }
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok) throw new Error((data && data.error) || 'The SMS service did not answer. Please try again.');
    return data;
  }

  /* Is SMS set up for this school, and what is the balance? */
  async function status(force) {
    if (!ONLINE_EDITION || !SYNC.schoolId()) return { configured: false };
    if (cache && !force) return cache;
    try { cache = await call('/sms/balance?school=' + encodeURIComponent(SYNC.schoolId())); }
    catch (e) { return { configured: false, error: e.message }; }
    return cache;
  }
  // Africa's Talking gives the balance as e.g. "UGX 5000.0000".
  const balanceText = b => {
    const m = /^([A-Z]{3})\s*(-?\d+(?:\.\d+)?)$/.exec(String(b || '').trim());
    return m ? m[1] + ' ' + Number(m[2]).toLocaleString('en-US', { maximumFractionDigits: 2 }) : (b || 'unknown');
  };
  const accountLine = st => [
    st.sandbox ? "Africa's Talking <strong>sandbox</strong> (test only: nothing reaches real phones)" : "Africa's Talking account " + escapeHtml(st.username),
    st.sender_id ? 'sender ' + escapeHtml(st.sender_id) : '',
    'balance ' + escapeHtml(balanceText(st.balance)),
  ].filter(Boolean).join(' · ');

  async function prepare(kind, options) {
    const { data, error } = await db().rpc('sms_create_campaign', { p_school: SYNC.schoolId(), p_kind: kind, p_options: options });
    if (error) throw new Error(ONLINE.friendly(error));
    return data;
  }
  const dropDraft = id => db().rpc('sms_cancel_campaign', { p_campaign: id }).then(() => {}, () => {});

  /* Prepare a message run, show what will go out, then send it in batches.
     kind: 'fees' | 'absence' | 'broadcast'. fallback(): what to offer when
     SMS is not set up (e.g. the tap-to-SMS list). */
  async function openRun(kind, options, title, fallback) {
    const st = await status();
    if (!st.configured) {
      openModal({
        title: escapeHtml(title),
        bodyHtml: `<p>${st.error ? escapeHtml(st.error) : 'SMS is not set up for this school yet.'}</p>
          <p class="card-desc" style="margin-top:8px">${can('canManageSettings')
            ? "Add your school's Africa's Talking account under Administration → SMS."
            : 'Ask the Executive Director to add the school\'s Africa\'s Talking account under Administration → SMS.'}</p>`,
        footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>${fallback ? '<button class="btn btn-outline" id="smsFallback">Tap-to-SMS list instead</button>' : ''}${can('canManageSettings') ? '<button class="btn btn-primary" id="smsSetUp">Set up SMS</button>' : ''}`,
        onOpen(root) {
          const f = root.querySelector('#smsFallback'); if (f) f.addEventListener('click', () => { closeModal(); fallback(); });
          const s = root.querySelector('#smsSetUp'); if (s) s.addEventListener('click', () => { closeModal(); switchTab('admin', 'sms'); });
        },
      });
      return;
    }
    // Today's register, payments and notices must reach the school database
    // first: the messages are written from what is there.
    const saved = await SYNC.flush();
    if (!saved.ok) return toast('Your latest changes have not reached the school database yet. Check the connection and try again.', 'error');

    let both = !!options.both, preview;
    try { preview = await prepare(kind, { ...options, both }); }
    catch (e) { return toast(e.message, 'error'); }
    if (!preview.recipients) {
      dropDraft(preview.campaign_id);
      return toast(preview.skipped ? `Nobody to message: ${preview.skipped} learner(s) have no valid guardian number.` : 'Nobody to message.', 'info');
    }
    let sending = false;
    const summary = p => `<strong>${p.recipients}</strong> message${p.recipients === 1 ? '' : 's'} · ${p.parts} SMS page${p.parts === 1 ? '' : 's'}${p.skipped ? ` · ${p.skipped} learner${p.skipped === 1 ? ' has' : 's have'} no valid guardian number and ${p.skipped === 1 ? 'is' : 'are'} left out` : ''}`;
    openModal({
      title: escapeHtml(title), wide: true, locked: false,
      bodyHtml: `<p id="smsSummary">${summary(preview)}</p>
        <label class="check" style="margin:10px 0"><input type="checkbox" id="smsBoth" ${both ? 'checked' : ''}> Also send to the second guardian where there is one</label>
        <div class="form-label" style="margin-top:6px">First message</div>
        <div class="tile" id="smsSample" style="white-space:pre-wrap;font-size:13px">${escapeHtml(preview.sample)}</div>
        <p class="card-desc" style="margin-top:8px">${accountLine(st)}</p>
        <div id="smsProgressWrap" style="display:none;margin-top:12px"><div class="bar"><span id="smsProgress" style="width:0%"></span></div><p class="card-desc" id="smsProgressText" style="margin-top:6px"></p></div>`,
      footHtml: `<button class="btn btn-ghost" id="smsCancel">Cancel</button><button class="btn btn-primary" id="smsSend">Send ${preview.recipients} SMS</button>`,
      onOpen(root) {
        const sendBtn = root.querySelector('#smsSend'), cancelBtn = root.querySelector('#smsCancel');
        root.querySelector('#smsBoth').addEventListener('change', async e => {
          sendBtn.disabled = true;
          const old = preview.campaign_id;
          try {
            both = e.target.checked;
            preview = await prepare(kind, { ...options, both });
            dropDraft(old);
            root.querySelector('#smsSummary').innerHTML = summary(preview);
            root.querySelector('#smsSample').textContent = preview.sample || '';
            sendBtn.textContent = `Send ${preview.recipients} SMS`;
          } catch (err) { toast(err.message, 'error'); }
          sendBtn.disabled = !preview.recipients;
        });
        cancelBtn.addEventListener('click', () => { if (!sending) dropDraft(preview.campaign_id); closeModal(); });
        sendBtn.addEventListener('click', async () => {
          sending = true; sendBtn.disabled = true; cancelBtn.textContent = 'Close';
          root.querySelector('#smsBoth').disabled = true;
          root.querySelector('#smsProgressWrap').style.display = '';
          const bar = root.querySelector('#smsProgress'), text = root.querySelector('#smsProgressText');
          let totals = { sent: 0, failed: 0 };
          try {
            for (let i = 0; i < 500; i++) {
              const r = await call(`/sms/campaigns/${preview.campaign_id}/send`, { method: 'POST' });
              totals = r.totals || totals;
              const done = totals.sent + totals.failed;
              bar.style.width = Math.min(100, Math.round(done * 100 / preview.recipients)) + '%';
              text.textContent = `${done} of ${preview.recipients} handled…`;
              if (r.done) break;
            }
            text.textContent = `${totals.sent} sent${totals.failed ? `, ${totals.failed} could not be delivered (see Administration → SMS)` : ''}.`;
            toast(`SMS: ${totals.sent} sent${totals.failed ? `, ${totals.failed} failed` : ''}.`, totals.failed ? 'warn' : 'success');
            cache = null;   // the balance has changed
          } catch (err) {
            text.textContent = err.message + ' Press Send again to continue where it stopped.';
            sendBtn.disabled = false; sendBtn.textContent = 'Send again';
            sending = false;
          }
        });
      },
    });
  }

  /* ── Administration → SMS ──────────────────────────────────────────── */
  async function renderAdmin() {
    const box = el('smsStatus'); if (!box) return;
    box.innerHTML = '<span class="card-desc">Checking…</span>';
    const st = await status(true);
    box.innerHTML = st.configured
      ? `${icon('check', 15)} <strong>SMS is set up.</strong> <span class="card-desc">${accountLine(st)}${st.reachable === false ? ' · <span style="color:var(--danger)">Africa\'s Talking did not answer just now</span>' : ''}</span>`
      : `<strong>SMS is not set up.</strong> <span class="card-desc">${st.error ? escapeHtml(st.error) : "Fee reminders, absence alerts and notices can go out as SMS once the director adds the school's Africa's Talking account."}</span>`;
    const form = el('smsSettingsForm');
    if (form && st.configured) {
      el('smsUsername').value = st.username || '';
      el('smsSender').value = st.sender_id || '';
      el('smsSandbox').checked = !!st.sandbox;
      el('smsApiKey').placeholder = 'Saved — type a new key only to change it';
    }
    if (el('smsRemoveBtn')) el('smsRemoveBtn').style.display = st.configured ? '' : 'none';
    if (el('smsTestRow')) el('smsTestRow').style.display = st.configured && can('canManageSettings') ? '' : 'none';
    loadLog();
  }
  const KIND = { fees: 'Fee reminders', absence: 'Absence messages', broadcast: 'Notice to guardians' };
  const STATUS = { draft: 'Not sent', sending: 'Sending', done: 'Done', cancelled: 'Stopped' };
  async function loadLog() {
    const body = el('smsLogBody'); if (!body) return;
    const { data, error } = await db().from('sms_campaigns').select('created_at,kind,options,created_by_name,recipients,sent,failed,status')
      .eq('school_id', SYNC.schoolId()).neq('status', 'draft')   // a preview not yet sent is not a run
      .order('created_at', { ascending: false }).limit(30);
    if (error) { body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(ONLINE.friendly(error))}</td></tr>`; return; }
    const runs = data || [];
    body.innerHTML = runs.length ? runs.map(c => `<tr><td class="t-muted">${escapeHtml(fmtWhen(c.created_at))}</td>
      <td>${escapeHtml(KIND[c.kind] || c.kind)}${c.options && c.options.class ? ' · ' + escapeHtml(c.options.class) : ''}</td><td>${escapeHtml(c.created_by_name || '—')}</td>
      <td class="t-center">${Number(c.recipients)}</td><td class="t-center" style="color:var(--success)">${Number(c.sent)}</td>
      <td class="t-center" style="color:${c.failed ? 'var(--danger)' : 'var(--muted)'}">${Number(c.failed)}</td><td>${escapeHtml(STATUS[c.status] || c.status)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No SMS sent yet.</td></tr>';
  }
  async function saveSettings(e) {
    e.preventDefault();
    const key = el('smsApiKey').value.trim();
    if (!key) return toast("Type the API key from your Africa's Talking account.", 'error');
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
      const r = await call('/sms/settings', { method: 'POST', body: {
        school_id: SYNC.schoolId(), username: el('smsUsername').value.trim(), api_key: key,
        sender_id: el('smsSender').value.trim(), sandbox: el('smsSandbox').checked,
      } });
      el('smsApiKey').value = '';
      toast(`SMS account saved. Balance: ${balanceText(r.balance)}.`, 'success');
      renderAdmin();
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  }
  async function sendTest() {
    const to = el('smsTestTo').value.trim();
    if (!to) return toast('Type the phone number to send the test to.', 'error');
    try {
      const r = await call('/sms/test', { method: 'POST', body: { school_id: SYNC.schoolId(), to } });
      toast(r.ok ? 'Test SMS sent.' : `The test SMS was not accepted: ${r.error || 'unknown reason'}.`, r.ok ? 'success' : 'error');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function removeSettings() {
    if (!await confirmDialog({ title: 'Remove the SMS account', message: 'SMS and parent sign-in codes will stop until an account is added again. Continue?', confirmLabel: 'Remove', danger: true })) return;
    const { error } = await db().rpc('sms_remove_settings', { p_school: SYNC.schoolId() });
    if (error) return toast(ONLINE.friendly(error), 'error');
    cache = null;
    toast('SMS account removed.', 'success');
    renderAdmin();
  }

  return { status, openRun, renderAdmin, saveSettings, sendTest, removeSettings, forget() { cache = null; } };
})();

Object.assign(ACTIONS, {
  smsAbsentees: d => SMS.openRun('absence', { class: d.class, date: d.date }, `Tell the guardians of absent learners — ${d.class}`),
});
MODULES.push({
  name: 'sms',
  setup() {
    if (!ONLINE_EDITION) return;
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('smsSettingsForm', 'submit', SMS.saveSettings);
    on('smsTestBtn', 'click', SMS.sendTest);
    on('smsRemoveBtn', 'click', SMS.removeSettings);
    on('smsLogRefresh', 'click', SMS.renderAdmin);
  },
  onSub(tab, sub) { if (ONLINE_EDITION && tab === 'admin' && sub === 'sms') SMS.renderAdmin(); },
});
