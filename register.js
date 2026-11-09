/* =========================================================================
   register.js — the daily class register.

   One register per class and stream per day:
   { id, class, stream, date, records: [{ studentId, status: P|A|L|E }], markedBy }
   P = present, A = absent, L = late (counts as present), E = excused.
   A class with streams is called stream by stream, as on paper.

   Screens (under Students):
     Take register   — every child starts unmarked; the teacher taps Present,
                       Absent, Late or Excused for each one, and the register
                       is saved only when every child is marked.
     Who was absent  — every register taken, with the children's names.
     Term sheet      — the class as on the paper register: a line per child,
                       a column per day, totals per child and per day.
   The dashboard names the children absent today.
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
/* The learners on one register: a stream's learners, or, in a class without
   streams, the whole class. */
function registerLearners(cls, stream) {
  return visibleStudents().filter(s => s.class === cls && (s.stream || '') === (stream || '')).sort((a, b) => a.name.localeCompare(b.name));
}
const classLabel = (cls, stream) => cls + (stream ? ' ' + stream : '');
/* The stream picker uses "-" for "no stream", so a re-render keeps it chosen. */
const regStream = () => { const v = el('regStream') ? el('regStream').value : ''; return v === '-' ? '' : v; };
const learnerName = id => (state.students.find(s => s.id === id) || {}).name || '';

/* One learner's attendance, one entry per day (if two registers cover the
   same day, the later one counts). from/to are optional YYYY-MM-DD bounds. */
function learnerAttendance(s, from, to) {
  const byDate = {};
  (state.registers || []).filter(r => r.class === s.class && (!from || r.date >= from) && (!to || r.date <= to)).forEach(r => {
    const rec = (r.records || []).find(x => x.studentId === s.id); if (!rec) return;
    const prev = byDate[r.date];
    const at = r.updatedAt || r.createdAt || '';
    if (!prev || at >= prev.at) byDate[r.date] = { status: rec.status, at };
  });
  const days = Object.keys(byDate).sort().map(date => ({ date, status: byDate[date].status }));
  const list = st => days.filter(d => d.status === st).map(d => d.date);
  const absent = list('A'), late = list('L'), excused = list('E');
  const present = days.length - absent.length - excused.length;
  return { days, total: days.length, present, absent, late, excused, rate: days.length ? Math.round(present * 100 / days.length) : 0 };
}

/* ── Take register ─────────────────────────────────────────────────────── */
function renderRegisterControls() {
  if (!el('regClass')) return;
  fillSelect('regClass', '<option value="">Choose class…</option>' + visibleClasses().map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  const cls = el('regClass').value;
  const streams = streamsFor(cls);
  const unstreamed = streams.length && visibleStudents().some(s => s.class === cls && !s.stream);
  // Registers taken for the whole class before streams were called separately.
  const earlier = streams.length && (state.registers || []).some(r => r.class === cls && !r.stream);
  fillSelect('regStream', streams.map(x => `<option>${escapeHtml(x)}</option>`).join('')
    + (unstreamed ? '<option value="-">No stream</option>' : earlier ? '<option value="-">Whole class (earlier registers)</option>' : ''));
  // A class without streams has nothing to choose.
  const wrap = el('regStreamWrap'); if (wrap) wrap.style.display = streams.length ? '' : 'none';
  if (!el('regDate').value) el('regDate').value = todayISO();
  renderTodayPills();
}

function renderRegisterRoster() {
  const box = el('registerRoster'); if (!box) return;
  const cls = el('regClass').value, stream = regStream(), date = el('regDate').value;
  const note = el('registerNote');
  if (!cls) { box.innerHTML = '<div class="empty">Choose a class to call the register.</div>'; renderRegisterSummary(); return; }
  const existing = findRegister(cls, stream, date);
  // Everyone on a register already taken stays on it (e.g. a whole-class register).
  let learners = registerLearners(cls, stream);
  if (existing) existing.records.forEach(r => { const s = visibleStudents().find(x => x.id === r.studentId); if (s && !learners.includes(s)) learners.push(s); });
  learners = learners.sort((a, b) => a.name.localeCompare(b.name));
  if (!learners.length) { box.innerHTML = '<div class="empty">No learners in this class.</div>'; renderRegisterSummary(); return; }
  const map = {};
  if (existing) existing.records.forEach(r => { map[r.studentId] = r.status; });
  // Nobody is assumed present: a child is marked only when the teacher marks them.
  box.innerHTML = learners.map(s => {
    const status = map[s.id] || '';
    return `<div class="roster-item reg-row${status ? '' : ' is-unmarked'}" data-student="${escapeHtml(s.id)}" data-status="${status}">
      <div class="reg-name"><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.id)}<span class="reg-unmarked"> · Not marked</span></div></div>
      <div class="seg seg-words" role="radiogroup" aria-label="Attendance for ${escapeHtml(s.name)}">${REGISTER_STATUSES.map(st => `<button type="button" role="radio" aria-checked="${st.id === status}" class="${st.id === status ? 'on-' + st.id : ''}" data-set-status="${st.id}">${st.label}</button>`).join('')}</div>
    </div>`;
  }).join('');
  if (note) note.textContent = existing
    ? `Already taken by ${existing.markedBy || '—'}. Change anyone below and press Save register to update it.`
    : '1 Choose the class · 2 tap Present, Absent, Late or Excused for every child · 3 press Save register. Nobody is counted present until you mark them.';
  renderRegisterSummary();
}

/* The running line above the list: who is absent, late or excused, by name. */
function renderRegisterSummary() {
  const box = el('regSummary'); if (!box) return;
  const rows = [...document.querySelectorAll('#registerRoster .reg-row')];
  if (!rows.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const names = st => rows.filter(r => (r.dataset.status || '') === st).map(r => escapeHtml(learnerName(r.dataset.student)));
  const unmarked = names(''), absent = names('A'), late = names('L'), excused = names('E');
  const present = rows.filter(r => r.dataset.status === 'P').length;
  box.style.display = '';
  box.innerHTML = `<strong>${rows.length}</strong> learner${rows.length === 1 ? '' : 's'}`
    + (unmarked.length ? ` · <span class="t-warn">${unmarked.length} not marked yet: ${unmarked.join(', ')}</span>` : ' · <span class="t-ok">everyone marked</span>')
    + ` · <span class="t-ok">${present} present</span>`
    + (absent.length ? ` · <span class="t-bad">${absent.length} absent: ${absent.join(', ')}</span>` : '')
    + (late.length ? ` · <span class="t-warn">${late.length} late: ${late.join(', ')}</span>` : '')
    + (excused.length ? ` · ${excused.length} excused: ${excused.join(', ')}` : '');
}

function setRowStatus(row, status) {
  row.dataset.status = status;
  row.classList.remove('is-unmarked', 'needs-mark');
  row.querySelectorAll('[data-set-status]').forEach(b => {
    const on = b.dataset.setStatus === status;
    b.className = on ? 'on-' + status : '';
    b.setAttribute('aria-checked', on);
  });
  renderRegisterSummary();
}

function saveRegister() {
  if (!can('canMarkRegister')) return toast('You do not have permission to mark the register.', 'error');
  const cls = el('regClass').value, stream = regStream(), date = el('regDate').value || todayISO();
  if (!cls) return toast('Choose a class first.', 'error');
  if (date > todayISO()) return toast('You cannot mark a register for a future date.', 'error');
  const rows = [...document.querySelectorAll('#registerRoster .reg-row')];
  if (!rows.length) return toast('No learners to mark.', 'error');
  if (refuseUnmarked(rows, 'child')) return;
  const records = rows.map(r => ({ studentId: r.dataset.student, status: r.dataset.status }));
  state.registers = state.registers || [];
  const existing = findRegister(cls, stream, date);
  if (existing) { existing.records = records; existing.markedBy = currentSession.displayName; existing.updatedAt = nowISO(); }
  else state.registers.push({ id: newId('REG'), class: cls, stream: stream || '', date, records, markedBy: currentSession.displayName, createdAt: nowISO() });
  saveState(); renderAll();
  const absent = records.filter(r => r.status === 'A').map(r => learnerName(r.studentId));
  toast(`Register saved for ${classLabel(cls, stream)}, ${fmtDay(date)}: ${records.length - absent.length} here${absent.length ? ', absent: ' + absent.join(', ') : ', nobody absent'}.`, 'success');
  showAbsentees(cls, stream, date);
}

/* A register is saved only when every child on it has been marked. Returns
   true (and names them, highlights their rows and scrolls to the first)
   when some are not. Also used by Sports training attendance. */
function refuseUnmarked(rows, noun) {
  const left = rows.filter(r => !r.dataset.status);
  rows.forEach(r => r.classList.toggle('needs-mark', !r.dataset.status));
  if (!left.length) return false;
  const names = left.map(r => learnerName(r.dataset.student));
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` and ${names.length - 6} more` : '');
  toast(`Not saved: ${left.length} ${noun}${left.length === 1 ? ' is' : (noun === 'child' ? 'ren are' : 's are')} not marked yet (${shown}). Mark each one, then save.`, 'error');
  if (left[0].scrollIntoView) left[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

function showAbsentees(cls, stream, date) {
  const box = el('registerAbsentees'); if (!box) return;
  const reg = findRegister(cls, stream, date);
  const absent = reg ? reg.records.filter(r => r.status === 'A').map(r => state.students.find(s => s.id === r.studentId)).filter(Boolean) : [];
  // Online, all of them can be told at once by SMS through the school's account.
  const textAll = ONLINE_EDITION && absent.length
    ? `<button class="btn btn-primary btn-sm" style="margin-bottom:10px" data-act="smsAbsentees" data-class="${escapeHtml(cls)}" data-date="${escapeHtml(date)}">${icon('message', 14)} Text all ${absent.length} guardian${absent.length === 1 ? '' : 's'}</button>`
    : '';
  const when = date === todayISO() ? `today (${fmtDay(date, false)})` : 'on ' + fmtDay(date);
  box.innerHTML = absent.length
    ? `<div class="card-title" style="margin-bottom:8px">Absent ${escapeHtml(when)} — tell their guardians</div>${textAll}${absent.map(s => `<div class="roster-item"><div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.guardian || 'No phone on file')}</div></div>
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

/* Which classes still need today's register? (shown on Take register) */
function renderTodayPills() {
  const todayBox = el('registerToday'); if (!todayBox) return;
  const today = todayISO();
  const classes = visibleClasses();
  const done = classes.filter(c => (state.registers || []).some(r => r.class === c && r.date === today));
  todayBox.innerHTML = classes.length ? `<span class="card-desc">Today:</span> ${classes.map(c => `<span class="badge ${done.includes(c) ? 'badge-success' : 'badge-warn'}">${escapeHtml(c)} ${done.includes(c) ? '✓' : '—'}</span>`).join(' ')}` : '';
}

/* ── Who was absent ────────────────────────────────────────────────────── */
function renderAbsenceList() {
  const box = el('absenceList'); if (!box) return;
  const allowed = visibleClasses();
  fillSelect('absClass', '<option value="">All classes</option>' + allowed.map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  if (!el('absTo').value) el('absTo').value = todayISO();
  if (!el('absFrom').value) el('absFrom').value = addDaysISO(el('absTo').value, -6);
  const cls = el('absClass').value, from = el('absFrom').value, to = el('absTo').value;
  const list = (state.registers || []).filter(r => allowed.includes(r.class) && (!cls || r.class === cls) && (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => b.date.localeCompare(a.date) || a.class.localeCompare(b.class) || (a.stream || '').localeCompare(b.stream || ''));
  const people = (r, st) => (r.records || []).filter(x => x.status === st && learnerName(x.studentId)).map(x => learnerLink(x.studentId, learnerName(x.studentId)));

  // Who was absent most in these dates (one count per day).
  const counts = {};
  list.forEach(r => (r.records || []).forEach(x => { if (x.status === 'A') (counts[x.studentId] = counts[x.studentId] || new Set()).add(r.date); }));
  const top = Object.entries(counts).map(([id, d]) => [id, d.size]).filter(([id]) => learnerName(id)).sort((a, b) => b[1] - a[1] || learnerName(a[0]).localeCompare(learnerName(b[0]))).slice(0, 6);
  el('absTop').innerHTML = top.length
    ? `<div class="tile"><div class="form-label" style="margin-bottom:4px">Absent most in these dates</div>${top.map(([id, n]) => `${learnerLink(id, learnerName(id))} <span class="card-desc">(${n} day${n === 1 ? '' : 's'})</span>`).join(' · ')}</div>`
    : '';

  box.innerHTML = list.length ? list.map(r => {
    const absent = people(r, 'A'), late = people(r, 'L'), excused = people(r, 'E');
    const here = (r.records || []).filter(x => x.status === 'P' || x.status === 'L').length;
    const change = can('canMarkRegister')
      ? `<button class="btn btn-outline btn-xs" type="button" data-act="openRegister" data-class="${escapeHtml(r.class)}" data-stream="${escapeHtml(r.stream || '')}" data-date="${escapeHtml(r.date)}">Change this register</button>` : '';
    return `<div class="abs-item">
      <div class="abs-head"><div><strong>${escapeHtml(fmtDay(r.date))}</strong> · <strong>${escapeHtml(classLabel(r.class, r.stream))}</strong> · <span class="card-desc">${here} of ${(r.records || []).length} present</span></div>${change}</div>
      <div class="abs-names">${absent.length ? `<span class="abs-label t-bad">Absent:</span> ${absent.join(', ')}` : '<span class="t-ok">Nobody was absent.</span>'}</div>
      ${late.length ? `<div class="abs-names"><span class="abs-label">Late:</span> ${late.join(', ')}</div>` : ''}
      ${excused.length ? `<div class="abs-names"><span class="abs-label">Excused:</span> ${excused.join(', ')}</div>` : ''}
      <div class="card-desc" style="margin-top:4px">Taken by ${escapeHtml(r.markedBy || '—')}</div>
    </div>`;
  }).join('') : '<div class="empty">No registers were taken in these dates.</div>';
}

/* ── Term sheet: the class register as on paper ─────────────────────────── */
/* stream: a stream name, '' for a class without streams (or no stream), '*' for all. */
function termSheetData(cls, stream, from, to) {
  const learners = visibleStudents().filter(s => s.class === cls && (stream === '*' || (s.stream || '') === stream)).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set(learners.map(s => s.id));
  const cell = {}, dates = new Set();
  (state.registers || []).filter(r => r.class === cls && (!from || r.date >= from) && (!to || r.date <= to)).forEach(r => {
    const at = r.updatedAt || r.createdAt || '';
    (r.records || []).forEach(x => {
      if (!ids.has(x.studentId)) return;
      const m = cell[x.studentId] = cell[x.studentId] || {};
      if (!m[r.date] || at >= m[r.date].at) m[r.date] = { status: x.status, at };
      dates.add(r.date);
    });
  });
  return { learners, dates: [...dates].sort(), cell };
}
const monthLabel = ym => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/* The months of this term that have registers for the class, and this month. */
function termSheetMonths(cls) {
  const t = getCurrentTerm();
  const regs = (state.registers || []).filter(r => r.class === cls && (!t || !t.startDate || r.date >= t.startDate) && (!t || !t.endDate || r.date <= t.endDate));
  return [...new Set(regs.map(r => r.date.slice(0, 7)).concat(todayISO().slice(0, 7)))].sort();
}
function termSheetTable(d, print) {
  const sym = { P: '✓', A: '✗', L: 'L', E: 'E' };
  const months = new Set(d.dates.map(x => x.slice(0, 7)));
  const head = d.dates.map(x => {
    const dt = new Date(x + 'T00:00:00Z');
    return `<th class="ts-c">${DAY_NAMES[dt.getUTCDay()].slice(0, 2)}<br>${dt.getUTCDate()}${months.size > 1 ? ' ' + MONTH_NAMES[dt.getUTCMonth()] : ''}</th>`;
  }).join('');
  const rows = d.learners.map(s => {
    const m = d.cell[s.id] || {};
    let present = 0, absent = 0, days = 0;
    const cells = d.dates.map(x => {
      const c = m[x];
      if (!c) return '<td class="ts-c ts-none">·</td>';
      days++;
      if (c.status === 'A') absent++; else if (c.status !== 'E') present++;
      return `<td class="ts-c ts-${escapeHtml(c.status)}">${sym[c.status] || ''}</td>`;
    }).join('');
    const rate = days ? Math.round(present * 100 / days) : 0;
    return `<tr class="${days && rate < 80 ? 'ts-low' : ''}"><td class="ts-name">${print ? escapeHtml(s.name) : learnerLink(s.id, s.name)}</td>${cells}<td class="ts-tot">${present}</td><td class="ts-tot${absent ? ' t-bad' : ''}">${absent}</td><td class="ts-tot">${days ? rate + '%' : '—'}</td></tr>`;
  }).join('');
  const foot = d.dates.map(x => {
    const n = d.learners.filter(s => (d.cell[s.id] || {})[x] && d.cell[s.id][x].status === 'A').length;
    return `<td class="ts-c${n ? ' t-bad' : ''}">${n || ''}</td>`;
  }).join('');
  return `<div class="ts-wrap"><table class="ts"><thead><tr><th class="ts-name">Learner</th>${head}<th class="ts-tot">Present</th><th class="ts-tot">Absent</th><th class="ts-tot">Rate</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td class="ts-name">Absent that day</td>${foot}<td class="ts-tot" colspan="3"></td></tr></tfoot></table></div>
    <p class="card-desc" style="margin-top:8px">✓ present · ✗ absent · L late (counts as present) · E excused · a grey dot means no register for that child that day. A red edge marks a child present on fewer than 80% of the days.</p>`;
}
/* What the term sheet shows now: the chosen class, stream and period. */
function termSheetChoice() {
  const cls = el('tsClass') ? el('tsClass').value : '';
  const streams = streamsFor(cls);
  const sv = el('tsStream') ? el('tsStream').value : '';
  const stream = !streams.length ? '' : sv === '*' ? '*' : sv === '-' ? '' : sv;
  const t = getCurrentTerm();
  const per = el('tsMonth') ? el('tsMonth').value : '';
  const range = per === 'term' || !per
    ? { from: (t && t.startDate) || '', to: (t && t.endDate) || '', period: t ? termLabel(t) : 'this term' }
    : { from: per + '-01', to: per + '-31', period: monthLabel(per) };
  return { cls, stream, label: cls + (stream === '*' ? ' (all streams)' : stream ? ' ' + stream : ''), ...range };
}
function renderTermSheet() {
  const box = el('termSheet'); if (!box) return;
  fillSelect('tsClass', '<option value="">Choose class…</option>' + visibleClasses().map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  const cls = el('tsClass').value;
  const streams = streamsFor(cls);
  const unstreamed = streams.length && visibleStudents().some(s => s.class === cls && !s.stream);
  fillSelect('tsStream', streams.map(x => `<option>${escapeHtml(x)}</option>`).join('')
    + (streams.length ? '<option value="*">All streams</option>' : '') + (unstreamed ? '<option value="-">No stream</option>' : ''));
  el('tsStreamWrap').style.display = streams.length ? '' : 'none';
  const months = cls ? termSheetMonths(cls) : [todayISO().slice(0, 7)];
  const sel = el('tsMonth');
  fillSelect('tsMonth', months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('') + '<option value="term">Whole term</option>');
  if (!sel.dataset.chosen && months.includes(todayISO().slice(0, 7))) sel.value = todayISO().slice(0, 7);
  if (!cls) { box.innerHTML = '<div class="empty">Choose a class to see its attendance sheet.</div>'; return; }
  const c = termSheetChoice();
  const d = termSheetData(c.cls, c.stream, c.from, c.to);
  if (!d.learners.length) { box.innerHTML = '<div class="empty">No learners in this class.</div>'; return; }
  box.innerHTML = d.dates.length ? termSheetTable(d, false) : `<div class="empty">No registers were taken for ${escapeHtml(c.label)} in ${escapeHtml(c.period)}.</div>`;
}
function printTermSheet() {
  const c = termSheetChoice();
  if (!c.cls) return toast('Choose a class first.', 'error');
  const d = termSheetData(c.cls, c.stream, c.from, c.to);
  if (!d.dates.length) return toast('There are no registers to print for these choices.', 'error');
  printDoc('<style>@page { size: A4 landscape; margin: 10mm; }</style>' + docHeader(`Class attendance — ${escapeHtml(c.label)} — ${escapeHtml(c.period)}`) + termSheetTable(d, true));
}

/* ── Dashboard: today's registers, with the names of absent children ───── */
function renderAttendanceToday() {
  const box = el('attTodayBody'); if (!box) return;
  const today = todayISO();
  const classes = visibleClasses();
  if (!classes.length) { box.innerHTML = '<p class="card-desc">Admit learners to start calling the register.</p>'; return; }
  const regs = (state.registers || []).filter(r => r.date === today && classes.includes(r.class))
    .sort((a, b) => classes.indexOf(a.class) - classes.indexOf(b.class) || (a.stream || '').localeCompare(b.stream || ''));
  const done = classes.filter(c => regs.some(r => r.class === c));
  const records = regs.flatMap(r => r.records || []);
  const count = st => records.filter(x => x.status === st).length;
  const present = count('P') + count('L');
  const rate = records.length ? Math.round(present * 100 / records.length) : 0;
  const tile = (label, value, color) => `<div class="tile"><div class="stat-label">${label}</div><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div></div>`;
  const waiting = classes.filter(c => !done.includes(c));

  // Absent today, by name, class by class (the first 12, then a link).
  const MAX = 12; let shown = 0, total = 0;
  const groups = regs.map(r => {
    const ids = (r.records || []).filter(x => x.status === 'A' && learnerName(x.studentId)).map(x => x.studentId);
    total += ids.length;
    const take = ids.slice(0, Math.max(0, MAX - shown)); shown += take.length;
    return take.length ? `<div class="abs-names"><strong>${escapeHtml(classLabel(r.class, r.stream))}:</strong> ${take.map(id => learnerLink(id, learnerName(id))).join(', ')}</div>` : '';
  }).join('');
  const absentBlock = regs.length
    ? `<div class="form-label" style="margin:14px 0 2px">Absent today</div>${total ? groups : '<p class="card-desc t-ok">Nobody is absent in the registers taken so far.</p>'}${total > shown ? `<button class="btn btn-ghost btn-xs" type="button" data-act="absentToday" style="margin-top:6px">See all ${total} absent today</button>` : ''}`
    : '';

  box.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;gap:11px">
      ${tile('Registers marked', `${done.length} / ${classes.length}`, waiting.length ? 'var(--warn)' : 'var(--success)')}
      ${tile('Present', records.length ? `${present} <span class="card-desc">(${rate}%)</span>` : '—', records.length ? 'var(--success)' : '')}
      ${tile('Absent', records.length ? count('A') : '—', count('A') ? 'var(--danger)' : '')}
      ${tile('Late', records.length ? count('L') : '—', '')}
    </div>
    ${absentBlock}
    ${waiting.length
      ? `<div class="pill-list" style="margin-top:12px;align-items:center"><span class="card-desc">Not marked yet:</span> ${waiting.map(c => `<span class="badge badge-warn">${escapeHtml(c)}</span>`).join(' ')}</div>`
      : '<p class="card-desc" style="margin-top:12px">Every class has been marked today.</p>'}`;
}

Object.assign(ACTIONS, {
  smsAbsence: d => messageAbsence(d.id, d.date, 'sms'),
  waAbsence: d => messageAbsence(d.id, d.date, 'wa'),
  // From Who was absent: open that register on Take register, ready to change.
  openRegister: d => {
    switchTab('directory', 'daily');
    el('regClass').value = d.class;
    renderRegisterControls();
    el('regStream').value = d.stream || '-';
    el('regDate').value = d.date;
    renderRegisterRoster();
    showAbsentees(d.class, d.stream, d.date);
  },
  absentToday: () => {
    switchTab('directory', 'recent');
    el('absClass').value = '';
    el('absFrom').value = el('absTo').value = todayISO();
    renderAbsenceList();
  },
});
MODULES.push({
  name: 'register',
  setup() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('regClass', 'change', () => { renderRegisterControls(); renderRegisterRoster(); el('registerAbsentees').innerHTML = ''; });
    on('regStream', 'change', () => { renderRegisterRoster(); el('registerAbsentees').innerHTML = ''; });
    on('regDate', 'change', () => { renderRegisterRoster(); showAbsentees(el('regClass').value, regStream(), el('regDate').value); });
    on('regSaveBtn', 'click', saveRegister);
    on('registerRoster', 'click', e => {
      const b = e.target.closest('[data-set-status]'); if (!b) return;
      setRowStatus(b.closest('.reg-row'), b.dataset.setStatus);
    });
    ['absClass', 'absFrom', 'absTo'].forEach(id => on(id, 'change', renderAbsenceList));
    ['tsClass', 'tsStream'].forEach(id => on(id, 'change', renderTermSheet));
    on('tsMonth', 'change', () => { el('tsMonth').dataset.chosen = '1'; renderTermSheet(); });
    on('tsPrintBtn', 'click', printTermSheet);
  },
  render() { renderRegisterControls(); renderAbsenceList(); renderTermSheet(); renderAttendanceToday(); },
});
