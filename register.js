/* =========================================================================
   register.js — the daily class register.

   One register per class (and optional stream) per day:
   { id, class, stream, date, records: [{ studentId, status: P|A|L|E }], markedBy }
   P = present, A = absent, L = late (counts as present), E = excused.
   ========================================================================= */
'use strict';

const REGISTER_STATUSES = [
  { id: 'P', label: 'Present' },
  { id: 'A', label: 'Absent' },
  { id: 'L', label: 'Late' },
  { id: 'E', label: 'Excused' },
];

function findRegister(cls, stream, date) {
  return (state.registers || []).find(r => r.class === cls && (r.stream || '') === (stream || '') && r.date === date) || null;
}
function registerLearners(cls, stream) {
  return visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream)).sort((a, b) => a.name.localeCompare(b.name));
}

function renderRegisterControls() {
  if (!el('regClass')) return;
  fillSelect('regClass', '<option value="">Choose class…</option>' + visibleClasses().map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  fillSelect('regStream', '<option value="">All streams</option>' + streamsFor(el('regClass').value).map(x => `<option>${escapeHtml(x)}</option>`).join(''));
  if (!el('regDate').value) el('regDate').value = todayISO();
}

function renderRegisterRoster() {
  const box = el('registerRoster'); if (!box) return;
  const cls = el('regClass').value, stream = el('regStream').value, date = el('regDate').value;
  if (!cls) { box.innerHTML = '<div class="empty">Choose a class to call the register.</div>'; renderRegisterHistory(); return; }
  const learners = registerLearners(cls, stream);
  if (!learners.length) { box.innerHTML = '<div class="empty">No learners in this class.</div>'; renderRegisterHistory(); return; }
  const existing = findRegister(cls, stream, date);
  const map = {};
  if (existing) existing.records.forEach(r => { map[r.studentId] = r.status; });
  box.innerHTML = learners.map(s => {
    const status = map[s.id] || 'P';
    return `<div class="roster-item reg-row" data-student="${escapeHtml(s.id)}" data-status="${status}">
      <div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.id)}${s.stream ? ' · ' + escapeHtml(s.stream) : ''}</div></div>
      <div class="seg" role="radiogroup" aria-label="Attendance for ${escapeHtml(s.name)}">${REGISTER_STATUSES.map(st => `<button type="button" role="radio" aria-checked="${st.id === status}" class="${st.id === status ? 'on-' + st.id : ''}" data-set-status="${st.id}" title="${st.label}">${st.id}</button>`).join('')}</div>
    </div>`;
  }).join('');
  const note = el('registerNote');
  if (note) note.textContent = existing ? `Saved earlier by ${existing.markedBy || '—'} — changes will update it.` : 'Everyone starts as present. Tap A, L or E to change a learner.';
  renderRegisterHistory();
}

function setRowStatus(row, status) {
  row.dataset.status = status;
  row.querySelectorAll('[data-set-status]').forEach(b => {
    const on = b.dataset.setStatus === status;
    b.className = on ? 'on-' + status : '';
    b.setAttribute('aria-checked', on);
  });
}

function saveRegister() {
  if (!can('canMarkRegister')) return toast('You do not have permission to mark the register.', 'error');
  const cls = el('regClass').value, stream = el('regStream').value, date = el('regDate').value || todayISO();
  if (!cls) return toast('Choose a class first.', 'error');
  if (date > todayISO()) return toast('You cannot mark a register for a future date.', 'error');
  const rows = [...document.querySelectorAll('#registerRoster .reg-row')];
  if (!rows.length) return toast('No learners to mark.', 'error');
  const records = rows.map(r => ({ studentId: r.dataset.student, status: r.dataset.status || 'P' }));
  state.registers = state.registers || [];
  const existing = findRegister(cls, stream, date);
  if (existing) { existing.records = records; existing.markedBy = currentSession.displayName; existing.updatedAt = nowISO(); }
  else state.registers.push({ id: 'REG' + uid().slice(0, 6), class: cls, stream: stream || '', date, records, markedBy: currentSession.displayName, createdAt: nowISO() });
  saveState(); renderAll();
  const absent = records.filter(r => r.status === 'A').length;
  toast(`Register saved for ${cls}${stream ? ' ' + stream : ''} on ${date}: ${records.length - absent} present, ${absent} absent.`, 'success');
  showAbsentees(cls, stream, date);
}

function showAbsentees(cls, stream, date) {
  const box = el('registerAbsentees'); if (!box) return;
  const reg = findRegister(cls, stream, date);
  const absent = reg ? reg.records.filter(r => r.status === 'A').map(r => state.students.find(s => s.id === r.studentId)).filter(Boolean) : [];
  // Online, all of them can be told at once by SMS through the school's account.
  const textAll = ONLINE_EDITION && absent.length
    ? `<button class="btn btn-primary btn-sm" style="margin-bottom:10px" data-act="smsAbsentees" data-class="${escapeHtml(cls)}" data-date="${escapeHtml(date)}">${icon('message', 14)} Text all ${absent.length} guardian${absent.length === 1 ? '' : 's'}</button>`
    : '';
  box.innerHTML = absent.length
    ? `<div class="card-title" style="margin-bottom:8px">Absent today — tell their guardians</div>${textAll}${absent.map(s => `<div class="roster-item"><div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.guardian || 'No phone on file')}</div></div>
      <div class="row-actions"><button class="btn btn-outline btn-xs" data-act="smsAbsence" data-id="${escapeHtml(s.id)}" data-date="${escapeHtml(date)}">${icon('message', 14)} SMS</button><button class="btn btn-outline btn-xs" data-act="waAbsence" data-id="${escapeHtml(s.id)}" data-date="${escapeHtml(date)}">WhatsApp</button></div></div>`).join('')}`
    : '';
}

function absenceMessage(s, date) {
  return `Dear Parent/Guardian, ${s.name} (${s.class}) was absent from school on ${date}. Please contact the school if you were not aware. — ${schoolName()}`;
}
function messageAbsence(studentId, date, channel) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const phone = normalizePhone(s.guardian);
  if (!phone) return toast('No valid guardian phone number on file.', 'error');
  const body = absenceMessage(s, date);
  if (channel === 'wa') window.open('https://wa.me/' + phone.replace('+', '') + '?text=' + encodeURIComponent(body), '_blank');
  else window.open('sms:' + phone + '?body=' + encodeURIComponent(body), '_blank');
}

function renderRegisterHistory() {
  const body = el('registerHistoryBody'); if (!body) return;
  const cls = el('regClass') && el('regClass').value;
  const allowed = visibleClasses();
  const list = (state.registers || []).filter(r => allowed.includes(r.class) && (!cls || r.class === cls))
    .sort((a, b) => b.date.localeCompare(a.date) || a.class.localeCompare(b.class)).slice(0, 30);
  body.innerHTML = list.length ? list.map(r => {
    const present = r.records.filter(x => x.status === 'P' || x.status === 'L').length;
    const absent = r.records.filter(x => x.status === 'A').length;
    const rate = r.records.length ? Math.round(present * 100 / r.records.length) : 0;
    return `<tr><td>${escapeHtml(r.date)}</td><td style="font-weight:600">${escapeHtml(r.class)}${r.stream ? ' ' + escapeHtml(r.stream) : ''}</td><td class="t-center">${present}/${r.records.length}</td><td class="t-center" style="color:${absent ? 'var(--danger)' : 'var(--muted)'}">${absent}</td><td class="t-center" style="font-weight:700;color:${rate >= 90 ? 'var(--success)' : rate >= 75 ? 'var(--warn)' : 'var(--danger)'}">${rate}%</td><td class="card-desc">${escapeHtml(r.markedBy || '—')}</td>
      <td><button class="btn btn-outline btn-xs" data-act="openRegister" data-class="${escapeHtml(r.class)}" data-stream="${escapeHtml(r.stream || '')}" data-date="${escapeHtml(r.date)}">Open</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No registers saved yet.</td></tr>';

  // Which classes still need today's register?
  const todayBox = el('registerToday');
  if (todayBox) {
    const today = todayISO();
    const classes = visibleClasses();
    const done = classes.filter(c => (state.registers || []).some(r => r.class === c && r.date === today));
    todayBox.innerHTML = classes.length ? `<span class="card-desc">Today:</span> ${classes.map(c => `<span class="badge ${done.includes(c) ? 'badge-success' : 'badge-warn'}">${escapeHtml(c)} ${done.includes(c) ? '✓' : '—'}</span>`).join(' ')}` : '';
  }
}

/* Dashboard: today's registers across the classes this person can see. */
function renderAttendanceToday() {
  const box = el('attTodayBody'); if (!box) return;
  const today = todayISO();
  const classes = visibleClasses();
  if (!classes.length) { box.innerHTML = '<p class="card-desc">Admit learners to start calling the register.</p>'; return; }
  const regs = (state.registers || []).filter(r => r.date === today && classes.includes(r.class));
  const done = classes.filter(c => regs.some(r => r.class === c));
  const records = regs.flatMap(r => r.records || []);
  const count = st => records.filter(x => x.status === st).length;
  const present = count('P') + count('L');
  const rate = records.length ? Math.round(present * 100 / records.length) : 0;
  const tile = (label, value, color) => `<div class="tile"><div class="stat-label">${label}</div><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div></div>`;
  const waiting = classes.filter(c => !done.includes(c));
  box.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;gap:11px">
      ${tile('Registers marked', `${done.length} / ${classes.length}`, waiting.length ? 'var(--warn)' : 'var(--success)')}
      ${tile('Present', records.length ? `${present} <span class="card-desc">(${rate}%)</span>` : '—', records.length ? 'var(--success)' : '')}
      ${tile('Absent', records.length ? count('A') : '—', count('A') ? 'var(--danger)' : '')}
      ${tile('Late', records.length ? count('L') : '—', '')}
    </div>
    ${waiting.length
      ? `<div class="pill-list" style="margin-top:12px;align-items:center"><span class="card-desc">Not marked yet:</span> ${waiting.map(c => `<span class="badge badge-warn">${escapeHtml(c)}</span>`).join(' ')}</div>`
      : '<p class="card-desc" style="margin-top:12px">Every class has been marked today.</p>'}`;
}

Object.assign(ACTIONS, {
  smsAbsence: d => messageAbsence(d.id, d.date, 'sms'),
  waAbsence: d => messageAbsence(d.id, d.date, 'wa'),
  openRegister: d => {
    el('regClass').value = d.class;
    renderRegisterControls();
    el('regStream').value = d.stream || '';
    el('regDate').value = d.date;
    renderRegisterRoster();
    showAbsentees(d.class, d.stream, d.date);
    el('registerRoster').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});
MODULES.push({
  name: 'register',
  setup() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('regClass', 'change', () => { renderRegisterControls(); renderRegisterRoster(); el('registerAbsentees').innerHTML = ''; });
    on('regStream', 'change', renderRegisterRoster);
    on('regDate', 'change', () => { renderRegisterRoster(); showAbsentees(el('regClass').value, el('regStream').value, el('regDate').value); });
    on('regAllPresentBtn', 'click', () => document.querySelectorAll('#registerRoster .reg-row').forEach(r => setRowStatus(r, 'P')));
    on('regSaveBtn', 'click', saveRegister);
    on('registerRoster', 'click', e => {
      const b = e.target.closest('[data-set-status]'); if (!b) return;
      setRowStatus(b.closest('.reg-row'), b.dataset.setStatus);
    });
  },
  render() { renderRegisterControls(); renderRegisterHistory(); renderAttendanceToday(); },
});
