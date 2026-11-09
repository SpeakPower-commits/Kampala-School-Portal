/* =========================================================================
   parent.js — the parent portal (online edition only).

   A guardian signs in with a 6-digit code sent by SMS to the number the
   school holds for them, then sees each child's fees and receipts, published
   report cards, attendance this term and the school's notices for parents.

   Everything comes from one database function, parent_portal(), which
   returns only the caller's own children (migration 0002). Its rows become
   the same in-memory school the staff app uses (SYNC.stateFromRows), so
   balances, receipts and report cards come from the very code the school
   prints with (billing.js, academics.js). Nothing about the children is
   stored on the phone; only the sign-in session is.
   ========================================================================= */
'use strict';

/* The staff app's permission check. Parents have no staff permissions. */
function can() { return false; }

(function () {
  const $ = el;
  let sb = null;
  let schools = [];      // [{ id, name, state, positions }]
  let kids = [];         // [{ school, s }]
  let current = null;    // the child on screen
  let ptab = 'fees';
  let phoneSent = '';

  const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? '' : 'none'; };
  function error(msg) { const e = $('pError'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
  function friendly(err) {
    const m = String((err && (err.message || err.msg)) || err || '');
    if (/fetch|network|load failed/i.test(m)) return 'No internet connection. Check your data or Wi-Fi and try again.';
    if (/expired|invalid/i.test(m) && /token|otp|code/i.test(m)) return 'That code is wrong or has expired. Ask for a new one.';
    if (/rate limit|security purposes|seconds|too many/i.test(m)) return 'Too many tries. Please wait a minute and try again.';
    return m || 'Something went wrong. Please try again.';
  }
  /* Run with one school's records as the current state. */
  function withSchool(school, fn) {
    const prev = state;
    state = school.state;
    try { return fn(); } finally { state = prev; }
  }
  const publishedTerms = k => withSchool(k.school, () => termsWithMarks(k.s).filter(id => { const t = termById(id); return t && t.resultsPublished; }));
  const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  /* ── Loading ─────────────────────────────────────────────────────────── */
  async function load() {
    const { data, error: err } = await sb.rpc('parent_portal');
    if (err) throw err;
    schools = ((data && data.schools) || []).map(raw => {
      const settings = Object.assign({}, raw.school.settings || {});
      if (!settings.schoolName) settings.schoolName = raw.school.name;
      const st = SYNC.stateFromRows(Object.assign({ school_docs: [] }, raw), settings);
      state = st; recomputePaid(); recomputeGrades();
      const positions = {};
      (raw.term_results || []).forEach(r => { positions[r.learner_id + '|' + r.term_id] = r; });
      return { id: raw.school.id, name: settings.schoolName, state: st, positions };
    });
    kids = schools.flatMap(school => school.state.students.map(s => ({ school, s })));
  }

  /* ── Screens ─────────────────────────────────────────────────────────── */
  function renderHome() {
    current = null;
    show('pChild', false); show('pHome', true);
    const box = $('pChildren');
    if (!kids.length) {
      box.innerHTML = `<div class="card card-pad p-card"><div class="card-title">No children found for this number</div>
        <p class="card-desc">Ask the school to check the guardian phone number they have for your child.</p></div>`;
      return;
    }
    box.innerHTML = kids.map((k, i) => withSchool(k.school, () => {
      const a = studentAccount(k.s);
      return `<button class="card card-pad p-kid" type="button" data-kid="${i}">
        <div class="p-kid-name">${escapeHtml(k.s.name)}</div>
        <div class="card-desc">${escapeHtml(k.school.name)} · ${escapeHtml(k.s.class)}${k.s.stream ? ' ' + escapeHtml(k.s.stream) : ''}</div>
        <div class="p-kid-row"><span class="p-bal ${a.balance > 0 ? 'owe' : 'clear'}">${a.balance > 0 ? 'Balance ' + fmtMoney(a.balance) : 'Fees cleared'}</span>
        ${publishedTerms(k).length ? '<span class="badge badge-success">Results available</span>' : ''}</div>
      </button>`;
    })).join('');
  }
  function openKid(i) {
    current = kids[i];
    state = current.school.state;
    ptab = 'fees';
    renderChild();
  }
  function renderChild() {
    show('pHome', false); show('pChild', true);
    show('pBack', kids.length > 1);
    const { s, school } = current;
    $('pChildHead').innerHTML = `<div class="p-kid-name">${escapeHtml(s.name)}</div>
      <div class="card-desc">${escapeHtml(school.name)} · ${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''} · Admission no. ${escapeHtml(s.id)}</div>`;
    document.querySelectorAll('#pTabs [data-ptab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ptab === ptab)));
    $('pTabBody').innerHTML = { fees: feesHtml, results: resultsHtml, attendance: attendanceHtml, notices: noticesHtml }[ptab]();
    window.scrollTo(0, 0);
  }

  function feesHtml() {
    const s = current.s, a = studentAccount(s), ct = getCurrentTerm();
    const row = ct ? a.rows.find(r => r.inv.termId === ct.id) : null;
    const pays = state.payments.filter(p => p.studentId === s.id && !p.void).sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const inst = (row && row.inv.installments) || [];
    return `<div class="card card-pad p-card">
        <div class="stat-label">Balance owed</div>
        <div class="stat-value" id="pBalance" style="color:${a.balance > 0 ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(a.balance)}</div>
        ${a.arrears ? `<p class="card-desc">Including ${fmtMoney(a.arrears)} from earlier terms.</p>` : ''}
      </div>
      ${row ? `<div class="card card-pad p-card"><div class="card-title">${escapeHtml(termLabel(ct))} bill</div>
        <table class="p-table">${row.inv.lines.map(l => `<tr><td>${escapeHtml(l.name)}</td><td class="t-num">${fmtMoney(l.amount)}</td></tr>`).join('')}
        ${row.inv.discount ? `<tr><td>Bursary (${Number(row.inv.bursaryPct)}%)</td><td class="t-num">−${fmtMoney(row.inv.discount)}</td></tr>` : ''}
        <tr class="p-total"><td>Total for the term</td><td class="t-num">${fmtMoney(row.inv.total)}</td></tr>
        <tr><td>Paid towards it</td><td class="t-num">${fmtMoney(row.paid)}</td></tr></table>
        ${inst.length ? `<div class="form-label" style="margin-top:12px">Instalments</div><table class="p-table">${inst.map(i => `<tr><td>Due ${escapeHtml(i.dueDate)}</td><td class="t-num">${fmtMoney(i.amount)}</td></tr>`).join('')}</table>` : ''}
      </div>` : ''}
      <div class="card card-pad p-card"><div class="card-title">Payments</div>
        ${pays.length ? `<table class="p-table">${pays.map(p => `<tr><td>${escapeHtml(p.date)}<div class="card-desc">${escapeHtml(p.method || '')}${p.reference ? ' · ' + escapeHtml(p.reference) : ''}</div></td>
          <td class="t-num">${fmtMoney(p.amount)}<div><button class="btn btn-outline btn-xs" type="button" data-act="pReceipt" data-id="${escapeHtml(p.id)}">Receipt</button></div></td></tr>`).join('')}</table>`
          : '<p class="card-desc">No payments recorded yet.</p>'}
      </div>`;
  }

  function resultsHtml() {
    const ids = publishedTerms(current).slice().reverse();
    if (!ids.length) return `<div class="card card-pad p-card"><p class="card-desc">No results published yet. The school publishes each term's results when the report cards are ready.</p></div>`;
    return ids.map(id => {
      const t = termById(id), r = studentTermResult(current.s, id), p = current.school.positions[current.s.id + '|' + id];
      return `<div class="card card-pad p-card"><div class="card-title">${escapeHtml(termLabel(t))}</div>
        <p class="card-desc">${escapeHtml(r.label)}${p && p.position ? ` · Position ${ordinal(p.position)} of ${Number(p.out_of)}` : ''} · Average ${r.avg}%</p>
        <table class="p-table" style="margin-top:8px">${r.results.map(x => `<tr><td>${escapeHtml(x.subject)}</td><td class="t-num">${x.final} <span class="badge badge-neutral">${escapeHtml(x.grade)}</span></td></tr>`).join('')}</table>
        <button class="btn btn-primary btn-sm" type="button" data-act="pReport" data-term="${escapeHtml(id)}" style="margin-top:12px">View / print report card</button></div>`;
    }).join('');
  }

  function attendanceHtml() {
    const s = current.s, t = getCurrentTerm();
    const days = state.registers.map(r => ({ date: r.date, rec: (r.records || []).find(x => x.studentId === s.id) }))
      .filter(x => x.rec).sort((a, b) => b.date.localeCompare(a.date));
    if (!days.length) return `<div class="card card-pad p-card"><p class="card-desc">No class registers recorded for ${escapeHtml(s.name)} this term yet.</p></div>`;
    const n = st => days.filter(x => x.rec.status === st).length;
    const absent = days.filter(x => x.rec.status === 'A');
    return `<div class="card card-pad p-card"><div class="card-title">${escapeHtml(termLabel(t))}</div>
      <div class="p-att"><div><strong>${n('P') + n('L')}</strong><span>of ${days.length} days present</span></div><div><strong id="pAbsent">${n('A')}</strong><span>absent</span></div>
        <div><strong>${n('L')}</strong><span>late</span></div><div><strong>${n('E')}</strong><span>excused</span></div></div>
      ${n('L') ? '<p class="card-desc" style="margin-top:8px">Days marked late count as days present, as on the report card.</p>' : ''}
      ${absent.length ? `<div class="form-label" style="margin-top:14px">Days absent</div><p style="margin:4px 0 0">${absent.map(x => escapeHtml(x.date)).join(', ')}</p>`
        : '<p class="card-desc" style="margin-top:12px">No absences this term.</p>'}</div>`;
  }

  function noticesHtml() {
    const list = state.notices;
    if (!list.length) return `<div class="card card-pad p-card"><p class="card-desc">No notices from ${escapeHtml(current.school.name)} at the moment.</p></div>`;
    return list.map(n => `<div class="card card-pad p-card"><div class="card-desc">${escapeHtml(n.category || 'General')} · ${escapeHtml(fmtDate(n.postedAt))}</div>
      <div class="card-title" style="margin-top:4px">${escapeHtml(n.title)}</div>${n.body ? `<p style="white-space:pre-wrap;margin:6px 0 0">${escapeHtml(n.body)}</p>` : ''}</div>`).join('');
  }

  function openReport(termId) {
    const s = current.s, t = termById(termId), p = current.school.positions[s.id + '|' + termId];
    const html = reportCardHtml(s, termId, Object.assign(reportOptions(), {
      position: p && p.position ? { pos: p.position, of: p.out_of } : null,
      streamPosition: p && p.stream_position ? { pos: p.stream_position, of: p.stream_out_of } : null,
    }));
    openModal({
      title: escapeHtml(`${s.name} — ${termLabel(t)}`), wide: true,
      bodyHtml: `<div class="p-report">${html}</div>`,
      footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button><button class="btn btn-primary" id="pPrintReport">Print or save as PDF</button>`,
      onOpen(root) { root.querySelector('#pPrintReport').addEventListener('click', () => printDoc(html)); },
    });
  }

  /* ── Signing in and out ──────────────────────────────────────────────── */
  async function sendCode(e) {
    e.preventDefault(); error('');
    const phone = normalizePhone($('pPhone').value.trim());
    if (phone.replace(/\D/g, '').length < 11) return error('Enter your phone number, for example 0772 123 456.');
    $('pSendCode').disabled = true;
    const { error: err } = await sb.auth.signInWithOtp({ phone });
    $('pSendCode').disabled = false;
    if (err) return error(friendly(err));
    phoneSent = phone;
    $('pCodeNote').textContent = `We sent a code to ${phone}. It can take a minute to arrive.`;
    show('pPhoneForm', false); show('pCodeForm', true);
    $('pCode').focus();
  }
  async function verify(e) {
    e.preventDefault(); error('');
    const token = $('pCode').value.replace(/\D/g, '');
    if (token.length !== 6) return error('Type the 6-digit code from the SMS.');
    $('pVerify').disabled = true;
    const { error: err } = await sb.auth.verifyOtp({ phone: phoneSent, token, type: 'sms' });
    $('pVerify').disabled = false;
    if (err) return error(friendly(err));
    $('pCode').value = '';
    await enter();
  }
  async function enter() {
    try { await load(); }
    catch (err) { show('pSignIn', true); return error(friendly(err)); }
    show('pSignIn', false); show('pSignOut', true); error('');
    const { data } = await sb.auth.getSession();
    const phone = data.session && data.session.user && data.session.user.phone;
    $('pWho').textContent = phone ? 'Signed in as +' + String(phone).replace(/^\+/, '') : 'Signed in';
    if (kids.length === 1) openKid(0); else renderHome();
  }
  async function signOut() {
    await sb.auth.signOut().catch(() => {});
    schools = []; kids = []; current = null; state = freshState();
    show('pHome', false); show('pChild', false); show('pSignOut', false);
    $('pWho').textContent = 'Fees, report cards and attendance';
    $('pPhone').value = ''; $('pCode').value = '';
    show('pCodeForm', false); show('pPhoneForm', true); show('pSignIn', true);
  }

  Object.assign(ACTIONS, {
    pReceipt: d => printPaymentReceipt(d.id),
    pReport: d => openReport(d.term),
  });

  document.addEventListener('DOMContentLoaded', async () => {
    if ($('pCrest')) $('pCrest').innerHTML = crestSVG();
    if (!window.PORTAL || !PORTAL.online || !window.supabase) { show('pOffline', true); return; }
    // Its own session key, so a parent and a member of staff can share a phone.
    sb = window.supabase.createClient(PORTAL.config.supabaseUrl, PORTAL.config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ksa-parent-auth' },
    });
    $('pPhoneForm').addEventListener('submit', sendCode);
    $('pCodeForm').addEventListener('submit', verify);
    $('pChangeNumber').addEventListener('click', () => { error(''); show('pCodeForm', false); show('pPhoneForm', true); });
    $('pSignOut').addEventListener('click', signOut);
    $('pBack').addEventListener('click', renderHome);
    document.addEventListener('click', e => {
      const kid = e.target.closest('[data-kid]'); if (kid) return openKid(Number(kid.dataset.kid));
      const tab = e.target.closest('[data-ptab]'); if (tab && current) { ptab = tab.dataset.ptab; return renderChild(); }
      if (e.target.closest('[data-modal-close]')) return closeModal();
      const act = e.target.closest('[data-act]');
      if (act && ACTIONS[act.dataset.act]) { e.preventDefault(); ACTIONS[act.dataset.act](act.dataset, act); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    const { data } = await sb.auth.getSession();
    if (data.session) await enter(); else show('pSignIn', true);
  });
})();
