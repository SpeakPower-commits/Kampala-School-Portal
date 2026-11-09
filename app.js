/* =========================================================================
   School Management Portal — application logic
   Offline-first, role-aware. All data is stored locally on the device.
   ========================================================================= */
'use strict';

/* ── Constants ─────────────────────────────────────────────────────────── */

const DEFAULT_PROGRAMS = [
  { id: 'PRG001', name: 'Football', sport: 'Football', coach: 'To be assigned', days: ['Tuesday', 'Thursday'], requirements: ['Football boots', 'Team jersey', 'Shin guards'] },
  { id: 'PRG002', name: 'Netball', sport: 'Netball', coach: 'To be assigned', days: ['Monday', 'Wednesday'], requirements: ['Sports shoes', 'Team kit'] },
  { id: 'PRG003', name: 'Athletics', sport: 'Athletics', coach: 'To be assigned', days: ['Monday', 'Wednesday', 'Friday'], requirements: ['Running shoes', 'Track kit'] },
];
const SPORT_OPTIONS = ['Football', 'Basketball', 'Volleyball', 'Athletics', 'Swimming', 'Netball', 'Rugby', 'Cricket', 'Tennis', 'Handball'];
const PRIMARY_SUBJECTS = ['Mathematics', 'English Language', 'Science', 'Social Studies', 'Religious Education', 'Luganda', 'Kiswahili'];
const O_LEVEL_SUBJECTS = ['Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'CRE', 'Literature', 'Commerce', 'Agriculture', 'Entrepreneurship', 'Computer Studies', 'Fine Art', 'Music'];
const A_LEVEL_SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Economics', 'Literature', 'Divinity', 'Art', 'Music', 'General Paper', 'Sub-Mathematics', 'ICT'];
const PAYMENT_METHODS = ['Cash', 'Mobile Money (MTN)', 'Mobile Money (Airtel)', 'Bank Deposit', 'Cheque', 'Bank Transfer'];

/* ── State ─────────────────────────────────────────────────────────────── */
let currentSession = null;
let studentPage = 1;
let bindingsReady = false;

function can(permission) { return AUTH.can(permission); }
function hasTab(tab) { return AUTH.hasTabAccess(tab); }

/* ── Persistence ───────────────────────────────────────────────────────── */
/* Where the school's data lives: this device (offline edition) or the school
   database (online edition, through sync.js). Everything else is the same. */
const ONLINE_EDITION = !!(window.PORTAL && window.PORTAL.online);
const STORE = ONLINE_EDITION
  ? { read: () => SYNC.read(), write: () => SYNC.schedule() }
  : {
      read: () => localStorage.getItem('kampala_school_portal_state'),
      write: data => localStorage.setItem('kampala_school_portal_state', JSON.stringify(data)),
    };

function loadState() {
  try {
    const raw = STORE.read();
    state = raw ? migrate(JSON.parse(raw)) : freshState();
    if (!raw) state.programs = DEFAULT_PROGRAMS.map(p => ({ ...p }));
  } catch (_) {
    state = freshState();
    state.programs = DEFAULT_PROGRAMS.map(p => ({ ...p }));
  }
  ensureDefaultTerm(state);
  recomputePaid();
  recomputeGrades();
}
function saveState() {
  try {
    STORE.write(state);
    MODULES.forEach(m => { if (m.afterSave) try { m.afterSave(); } catch (_) {} });
    return true;
  } catch (err) {
    const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
    toast(quota ? 'Storage is full — export a backup and free up space.' : 'Could not save data on this device.', 'error');
    return false;
  }
}
/* Save and wait for the result. Offline this is immediate; online it waits
   until the school database has accepted the change. Used for money, where a
   receipt must never be shown for a payment that was not stored. */
async function persistNow() {
  if (!ONLINE_EDITION) return saveState() ? { ok: true } : { ok: false, error: 'Could not save on this device.' };
  saveState();
  return SYNC.flush();
}
/* Money needs a connection in the online edition, so every office sees the
   same balances. Returns true (and explains) when the action must wait. */
/* Multi-row billing changes online: save, and say so plainly if the school
   database did not take them (they are retried when the connection is back). */
async function saveOrWarn(what) {
  const saved = await persistNow();
  if (!saved.ok) toast(`${what} is not saved yet: ${saved.error} It will be retried automatically.`, 'error');
  return saved.ok;
}
function needsConnection(what) {
  if (!ONLINE_EDITION || navigator.onLine) return false;
  toast(`${what} needs an internet connection, so every office sees the same balances. Reconnect and try again.`, 'error');
  return true;
}

function migrate(data) {
  if (!data || typeof data !== 'object') return freshState();
  if (!data.version) data.version = 1;
  if (data.version < 2) {
    data.programs = data.programs || DEFAULT_PROGRAMS.map(p => ({ ...p }));
    data.conduct = data.conduct || [];
    data.version = 2;
  }
  if (data.version < 3) {
    data.competitions = data.competitions || [];
    data.squads = data.squads || [];
    data.notices = data.notices || [];
    data.terms = data.terms || [];
    data.feeComponents = data.feeComponents || [];
    (data.students || []).forEach(s => {
      s.gender = s.gender || ''; s.boardingStatus = s.boardingStatus || 'Day';
      s.unebIndexNo = s.unebIndexNo || ''; s.senFlag = s.senFlag || '';
      s.feeComponents = s.feeComponents || []; s.injuryLog = s.injuryLog || [];
      s.athleteProfile = s.athleteProfile || {};
    });
    data.version = 3;
  }
  if (data.version < 4) {
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    data.payments = data.payments || [];
    // Upgrade payment records with attribution fields.
    data.payments.forEach(p => {
      p.method = p.method || 'Cash';
      p.reference = p.reference || '';
      p.recordedBy = p.recordedBy || '-';
      p.recordedByName = p.recordedByName || 'System (migrated)';
      p.ts = p.ts || (p.date ? p.date + 'T00:00:00.000Z' : nowISO());
      if (typeof p.void !== 'boolean') p.void = false;
    });
    // Reconcile the balance cache against the ledger so the ledger becomes the
    // single source of truth. Any surplus becomes a recorded opening balance.
    (data.students || []).forEach(s => {
      s.academics = s.academics || []; s.performanceNotes = s.performanceNotes || [];
      const paidInLedger = data.payments
        .filter(p => p.studentId === s.id && !p.void)
        .reduce((a, p) => a + Number(p.amount || 0), 0);
      const cached = Number(s.paid || 0);
      if (cached > paidInLedger) {
        data.payments.push({
          id: 'P' + uid(), studentId: s.id, amount: cached - paidInLedger,
          method: 'Opening balance', reference: 'Migrated from previous version',
          date: s.createdAt || todayISO(), recordedBy: '-', recordedByName: 'System (migrated)',
          ts: nowISO(), void: false,
        });
      }
    });
    data.version = 4;
  }
  if (data.version < 5) migrateToV5(data);
  // Ensure collections always exist.
  ['students', 'payments', 'attendance', 'conduct', 'programs', 'competitions', 'squads', 'notices', 'terms', 'feeComponents', 'invoices', 'feeStructures', 'registers'].forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
  data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  return data;
}

/* ── Fees & bursary ────────────────────────────────────────────────────── */
/* effectiveFee(), studentBalance() and the invoice model live in billing.js. */

function studentAttendance(studentId) {
  let total = 0, present = 0;
  state.attendance.forEach(a => {
    const r = (a.records || []).find(x => x.studentId === studentId);
    if (r !== undefined) { total++; if (r.present) present++; }
  });
  return { total, present, rate: total ? Math.round((present / total) * 100) : 0 };
}
function bursaryScore(s) {
  const skillPoints = ['Advanced', 'Elite'].includes(s.skillLevel) ? 1 : 0;
  const att = studentAttendance(s.id).rate / 100;
  const evalPoints = Math.min((s.performanceNotes || []).length, 3) / 3;
  return Math.round((skillPoints * 40) + (att * 40) + (evalPoints * 20));
}
function bursaryEligible(s) { return s.sport && bursaryScore(s) >= 70; }
function skillBadge(level) {
  const m = { Beginner: 'badge-neutral', Intermediate: 'badge-info', Advanced: 'badge-success', Elite: 'badge-purple' };
  return `<span class="badge ${m[level] || 'badge-neutral'}">${escapeHtml(level || '—')}</span>`;
}
function phoneValid(raw) { return normalizePhone(raw).length >= 12; }
/* The second guardian number is optional, but when given it must be real:
   it lets that guardian sign in to the parent portal and receive SMS. */
function secondGuardianOk(raw) { return !String(raw || '').trim() || phoneValid(raw); }

/* =========================================================================
   Business logic
   ========================================================================= */
const ADMISSION_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,23}$/;

/* A short admission number for a learner admitted without one, never one in use. */
function newLearnerId() {
  let id;
  do { id = 'S' + uid().slice(0, 6); } while (state.students.some(s => s.id.toLowerCase() === id.toLowerCase()));
  return id;
}
async function registerStudent(f) {
  if (!can('canRegisterStudent')) return toast('You do not have permission to register students.', 'error');
  let id = (f.admissionNo || '').trim();
  if (id) {
    if (!ADMISSION_RE.test(id)) return toast('Admission number may only contain letters, numbers, / _ and -.', 'error');
    if (state.students.some(s => s.id.toLowerCase() === id.toLowerCase())) return toast('Admission number "' + id + '" is already in use.', 'error');
  } else {
    id = newLearnerId();
  }
  const name = (f.name || '').trim(), cls = (f.class || '').trim();
  if (!name) return toast('Type the child\'s full name.', 'error');
  if (!cls) return toast('Choose the class.', 'error');
  if (!phoneValid(f.guardian)) return toast('The guardian\'s phone is not a valid Ugandan number (for example 0772 123 456).', 'error');
  if (!secondGuardianOk(f.guardian2)) return toast('The second guardian number is not a valid Ugandan phone number.', 'error');
  const t = getCurrentTerm();
  if (!(Number(f.fee) > 0) && t && !structureFor({ class: cls, level: classifyLevel(cls) }, t.id)) {
    return toast(`Type the termly fees: no fee structure covers ${cls} yet (Fees → Terms & fee structures).`, 'error');
  }
  const same = state.students.find(s => s.class === cls && s.name.trim().toLowerCase() === name.toLowerCase());
  if (same && !(await confirmDialog({ title: 'Same name in this class', message: `${same.name} (${same.id}) is already in ${same.class}. Admit another child with the same name?`, confirmLabel: 'Admit anyway' }))) return null;
  const s = {
    id, name, class: cls, level: classifyLevel(cls),
    combination: (f.combination || '').split(',').map(x => x.trim()).filter(Boolean).join(', '),
    guardian: (f.guardian || '').trim(), guardian2: (f.guardian2 || '').trim(), fee: Number(f.fee) || 0, paid: 0, stream: (f.stream || '').trim(),
    sport: (f.sport || '').trim(), skillLevel: (f.skillLevel || '').trim(),
    gender: (f.gender || '').trim(), boardingStatus: (f.boardingStatus || 'Day').trim(),
    unebIndexNo: (f.unebIndexNo || '').trim(), senFlag: (f.senFlag || '').trim(),
    performanceNotes: [], academics: [], bursaryPct: 0, feeComponents: [], injuryLog: [],
    athleteProfile: {}, comments: {}, createdAt: todayISO(),
  };
  state.students.push(s);
  billStudentForCurrentTerm(s);
  saveState(); renderAll();
  AUTH.audit('STUDENT_REGISTER', `${name} (${id})`);
  toast('Registered ' + name + ' (' + id + ').', 'success');
  return s;
}
/* After admitting: say who, and offer their page or the next admission. */
function showAdmitDone(s) {
  const box = el('admitDone'); if (!box) return;
  box.style.display = '';
  box.innerHTML = `${icon('check', 16)} Admitted <strong>${escapeHtml(s.name)}</strong> (${escapeHtml(s.id)}) to ${escapeHtml(s.class + (s.stream ? ' ' + s.stream : ''))}.
    <div class="toolbar" style="margin-top:8px"><button class="btn btn-primary btn-sm" type="button" data-act="learner" data-id="${escapeHtml(s.id)}">Open their page</button><button class="btn btn-outline btn-sm" type="button" data-act="admitAnother">Admit another</button></div>`;
}

function updateStudent(id, f) {
  if (!can('canEditStudents')) return toast('You do not have permission to edit students.', 'error');
  const s = state.students.find(x => x.id === id);
  if (!s) return toast('Student not found.', 'error');
  if (!(f.name || '').trim()) return toast('The name cannot be empty.', 'error');
  if (!phoneValid(f.guardian)) return toast('The guardian\'s phone is not a valid Ugandan number (for example 0772 123 456).', 'error');
  if (!secondGuardianOk(f.guardian2)) return toast('The second guardian number is not a valid Ugandan phone number.', 'error');
  s.name = (f.name || '').trim() || s.name;
  s.class = (f.class || '').trim() || s.class;
  s.level = classifyLevel(s.class);
  s.combination = (f.combination || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');
  s.guardian = (f.guardian || '').trim();
  s.guardian2 = (f.guardian2 || '').trim();
  s.fee = Number(f.fee) || 0;
  s.gender = (f.gender || '').trim();
  s.boardingStatus = (f.boardingStatus || 'Day').trim();
  s.unebIndexNo = (f.unebIndexNo || '').trim();
  s.senFlag = (f.senFlag || '').trim();
  s.sport = (f.sport || '').trim();
  s.skillLevel = (f.skillLevel || '').trim();
  s.stream = (f.stream || '').trim();
  refreshCurrentInvoice(s);
  saveState(); renderAll();
  AUTH.audit('STUDENT_EDIT', `${s.name} (${s.id})`);
  toast('Updated ' + s.name + '.', 'success');
  return true;
}

/* Returns { payment, student, pending } when the payment is kept (pending:
   the connection dropped before the database confirmed it), or null when it
   was refused, so the form keeps what was typed. */
async function recordPayment(f) {
  const no = (msg) => { toast(msg, 'error'); return null; };
  if (!can('canRecordPayment')) return no('You do not have permission to record payments.');
  const s = state.students.find(x => x.id === f.studentId);
  if (!s) return no('Choose the learner first.');
  const amount = Number(f.amount);
  if (!amount || amount <= 0) return no('Type the amount received, e.g. 150000.');
  const date = f.date || todayISO();
  if (date > todayISO()) return no('The date paid cannot be in the future.');
  const method = f.method || 'Cash';
  const reference = (f.reference || '').trim();
  // The same money entered twice is the commonest mistake at the bursar's desk.
  const twin = state.payments.find(p => !p.void && p.studentId === s.id && Number(p.amount) === amount && p.date === date && (p.reference || '') === reference);
  if (twin && !await confirmDialog({
    title: 'Already recorded?',
    message: `${fmtMoney(amount)} for ${s.name} paid on ${fmtDay(date)}${reference ? ' with reference ' + reference : ''} is already recorded (receipt no. ${twin.id}). Record it a second time?`,
    confirmLabel: 'Yes, record it again',
  })) return null;
  if (needsConnection('Recording a payment')) return null;
  const payment = {
    id: 'P' + uid(), studentId: s.id, amount, method, reference, date,
    recordedBy: currentSession.userId, recordedByName: currentSession.displayName,
    ts: nowISO(), void: false,
  };
  state.payments.push(payment);
  recomputePaid();
  const saved = await persistNow();
  if (!saved.ok && saved.offline) {
    // The connection dropped mid-save, so the database may already have this
    // payment. Keep it, with the same id, so it is saved (or matched) when the
    // connection returns. Recording it again would count it twice.
    renderAll();
    toast(`Connection lost while saving ${fmtMoney(amount)} for ${s.name}. It is kept and will be saved automatically when the connection returns. Do not record it again.`, 'warn');
    return { payment, student: s, pending: true };
  }
  if (!saved.ok) {
    state.payments = state.payments.filter(x => x !== payment);
    recomputePaid(); renderAll();
    return no('The payment was NOT recorded. ' + saved.error);
  }
  renderAll();
  AUTH.audit('PAYMENT_RECORD', `${fmtMoney(amount)} · ${s.name} (${s.id}) · ${method}`);
  toast('Recorded ' + fmtMoney(amount) + ' for ' + s.name + '.', 'success');
  return { payment, student: s };
}

async function voidPayment(id, reason) {
  if (!can('canVoidPayment')) return toast('You do not have permission to reverse payments.', 'error');
  const p = state.payments.find(x => x.id === id);
  if (!p || p.void) return;
  if (!(reason || '').trim()) return toast('Write why the payment is being reversed. The payment was not reversed.', 'error');
  if (needsConnection('Reversing a payment')) return;
  p.void = true; p.voidReason = (reason || '').trim(); p.voidedBy = currentSession.displayName; p.voidedAt = nowISO();
  recomputePaid();
  const saved = await persistNow();
  if (!saved.ok && saved.offline) {
    // As with recording: the reversal may already be stored, and repeating it
    // is harmless, so keep it and let it be confirmed when the connection returns.
    renderAll();
    return toast('Connection lost while reversing the payment. The reversal is kept and will be saved automatically when the connection returns.', 'warn');
  }
  if (!saved.ok) {
    p.void = false; p.voidReason = ''; p.voidedBy = ''; p.voidedAt = '';
    recomputePaid(); renderAll();
    return toast('The payment was NOT reversed. ' + saved.error, 'error');
  }
  renderAll();
  const s = state.students.find(x => x.id === p.studentId);
  AUTH.audit('PAYMENT_VOID', `${p.id} · ${fmtMoney(p.amount)}${s ? ' · ' + s.name : ''} · ${p.voidReason}`);
  toast(`Payment reversed: ${fmtMoney(p.amount)}${s ? ' is back on what ' + s.name + ' owes' : ''}.`, 'warn');
}

async function deleteStudent(id) {
  if (!can('canDeleteStudents')) return toast('You do not have permission to remove students.', 'error');
  const s = state.students.find(x => x.id === id); if (!s) return;
  const ok = await confirmDialog({
    title: 'Remove student',
    message: ONLINE_EDITION
      ? `Remove ${s.name} (${s.id}) from the school's lists? Their bills and payments stay in the school's records.`
      : `Remove ${s.name} (${s.id}) and all related payments, attendance and conduct records? This cannot be undone.`,
    confirmLabel: 'Remove student', danger: true,
  });
  if (!ok) return;
  state.students = state.students.filter(x => x.id !== id);
  state.payments = state.payments.filter(p => p.studentId !== id);
  state.attendance.forEach(a => { a.records = (a.records || []).filter(r => r.studentId !== id); });
  state.conduct = state.conduct.filter(c => c.studentId !== id);
  state.squads.forEach(sq => { sq.members = (sq.members || []).filter(m => m !== id); });
  state.invoices = state.invoices.filter(i => i.studentId !== id);
  state.registers.forEach(r => { r.records = r.records.filter(x => x.studentId !== id); });
  recomputePaid(); saveState(); renderAll();
  AUTH.audit('STUDENT_DELETE', `${s.name} (${s.id})`);
  toast('Removed ' + s.name + '.', 'success');
}

async function resetAll() {
  if (!can('canReset')) return toast('You do not have permission to reset data.', 'error');
  const ok = await confirmDialog({ title: 'Erase all data', message: 'This permanently deletes every student, payment and record on this device. Export a backup first if you may need it.', confirmLabel: 'Erase everything', danger: true });
  if (!ok) return;
  const settings = state.settings;
  state = freshState();
  state.settings = settings;
  state.programs = DEFAULT_PROGRAMS.map(p => ({ ...p }));
  ensureDefaultTerm(state);
  saveState(); renderAll();
  AUTH.audit('DATA_RESET', '');
  toast('All data cleared.', 'success');
}

function addProgram(f) {
  if (!can('canAddProgram')) return toast('You do not have permission.', 'error');
  if (!f.name || !f.sport) return toast('Program name and sport are required.', 'error');
  state.programs.push({ id: newId('PRG'), name: f.name.trim(), sport: f.sport.trim(), coach: (f.coach || 'To be assigned').trim(), days: f.days || [], requirements: (f.requirements || '').split('\n').map(x => x.trim()).filter(Boolean) });
  saveState(); renderAll();
  toast('Program added: ' + f.name.trim() + '.', 'success');
}
async function deleteProgram(id) {
  if (!can('canAddProgram')) return toast('You do not have permission.', 'error');
  if (!await confirmDialog({ title: 'Remove program', message: 'Remove this program and its attendance sessions?', confirmLabel: 'Remove', danger: true })) return;
  state.programs = state.programs.filter(p => p.id !== id);
  state.attendance = state.attendance.filter(a => a.programId !== id);
  saveState(); renderAll();
  toast('Program removed.', 'success');
}

function logPerformance(f) {
  if (!can('canLogPerformance')) return toast('You do not have permission.', 'error');
  const s = state.students.find(x => x.id === f.studentId);
  if (!s) return toast('Choose an athlete first.', 'error');
  if (!f.note || !f.note.trim()) return toast('Add a coaching note.', 'error');
  s.skillLevel = f.skillLevel;
  if (!Array.isArray(s.performanceNotes)) s.performanceNotes = [];
  s.performanceNotes.push({ date: todayISO(), skillLevel: f.skillLevel, note: f.note.trim() });
  saveState(); renderAll();
  toast('Evaluation saved for ' + s.name + '.', 'success');
}

function saveAttendance(programId, date, records) {
  if (!can('canMarkAttendance')) return toast('You do not have permission.', 'error');
  if (!programId || !date) return toast('Choose a program and date.', 'error');
  state.attendance = state.attendance.filter(a => !(a.programId === programId && a.date === date));
  state.attendance.push({ id: newId('ATT'), programId, date, records });
  saveState(); renderAll();
  const missed = records.filter(r => !r.present).map(r => (state.students.find(s => s.id === r.studentId) || {}).name).filter(Boolean);
  toast(`Session saved for ${fmtDay(date)}: ${records.length - missed.length} came${missed.length ? ', missed: ' + missed.join(', ') : ', nobody missed'}.`, 'success');
}

/* Change a learner's bursary. This term's bill is rebuilt; online the change
   waits for the school database, and is undone on screen if it is refused. */
async function setBursary(studentId) {
  if (!can('canAwardBursary')) return toast('You do not have permission.', 'error');
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const pct = await bursaryDialog(s);
  if (pct === null) return;
  const old = Number(s.bursaryPct) || 0;
  if (pct === old) return toast(`${s.name} already has ${pct ? pct + '%' : 'no bursary'}. Nothing changed.`, 'info');
  if (needsConnection('Changing a bursary')) return;
  const t = getCurrentTerm();
  const inv = t && findInvoice(s.id, t.id);
  const before = inv ? JSON.parse(JSON.stringify(inv)) : null;
  s.bursaryPct = pct;
  refreshCurrentInvoice(s);
  const saved = await persistNow();
  if (!saved.ok && !saved.offline) {
    s.bursaryPct = old;
    const now = t && findInvoice(s.id, t.id);
    if (now && before) { Object.keys(now).forEach(k => delete now[k]); Object.assign(now, before); }
    else if (now) state.invoices = state.invoices.filter(i => i !== now);
    saveState(); renderAll();
    return toast('The bursary was NOT changed. ' + saved.error, 'error');
  }
  renderAll();
  AUTH.audit('BURSARY_AWARD', `${s.name} (${s.id}) ${old}% → ${pct}%`);
  if (!saved.ok) return toast(`Connection lost while saving the bursary for ${s.name}. It is kept and will be saved automatically when the connection returns.`, 'warn');
  toast(`${s.name}: ${pct ? pct + '% bursary' : 'bursary removed'}. This term's bill is now ${fmtMoney(studentAccount(s).currentBilled)}.`, 'success');
}

/* ── Messaging ─────────────────────────────────────────────────────────── */
function smsBalance(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const phone = normalizePhone(s.guardian);
  if (!phone) return toast('No valid guardian phone number on file.', 'error');
  const a = studentAccount(s);
  const body = a.balance > 0
    ? `Dear Parent/Guardian of ${s.name} (${s.class}), the outstanding school fees balance is ${fmtMoney(a.balance)}${a.arrears ? `, including ${fmtMoney(a.arrears)} from previous terms` : ''}. Kindly clear it at your earliest convenience. Thank you. — ${schoolName()}`
    : `Dear Parent/Guardian of ${s.name} (${s.class}), thank you for clearing the school fees. — ${schoolName()}`;
  window.open('sms:' + phone + '?body=' + encodeURIComponent(body), '_blank');
}
function whatsappBalance(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const phone = normalizePhone(s.guardian);
  if (!phone) return toast('No valid guardian phone number on file.', 'error');
  const a = studentAccount(s);
  const body = a.balance > 0
    ? `Dear Parent/Guardian of *${s.name}* (${s.class}), outstanding school fees balance: *${fmtMoney(a.balance)}*${a.arrears ? ` (including ${fmtMoney(a.arrears)} from previous terms)` : ''}. Kindly clear at your earliest convenience. Thank you. — ${schoolName()}`
    : `Dear Parent/Guardian of *${s.name}* (${s.class}), thank you for clearing the school fees. — ${schoolName()}`;
  window.open('https://wa.me/' + phone.replace('+', '') + '?text=' + encodeURIComponent(body), '_blank');
}
/* Fee reminders for the class chosen under Who owes (or every class): real
   SMS through the school's account in the online edition; elsewhere (or when
   SMS is not set up) a tap-to-SMS list. */
function openBulkSms() {
  const cls = (el('oweClass') || {}).value || '';
  if (ONLINE_EDITION) return SMS.openRun('fees', cls ? { class: cls } : {}, 'Fee reminders by SMS' + (cls ? ' — ' + cls : ''), () => openFeeReminderLinks(cls));
  openFeeReminderLinks(cls);
}
function openFeeReminderLinks(cls = '') {
  const debtors = state.students.filter(s => !cls || s.class === cls).map(s => ({ s, bal: studentBalance(s) })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
  const total = debtors.reduce((a, x) => a + x.bal, 0);
  const where = cls ? ' in ' + cls : '';
  const body = !debtors.length
    ? `<div class="banner banner-success">${icon('check')} Nobody${escapeHtml(where)} owes fees: no reminders needed.</div>`
    : `<p class="card-desc" style="margin-bottom:12px">${debtors.length} learner${debtors.length > 1 ? 's' : ''}${escapeHtml(where)} owe <strong style="color:var(--danger)">${fmtMoney(total)}</strong>. Tap SMS or WhatsApp to send each guardian a reminder from this phone.</p>
       <div class="scroll-box">${debtors.map(({ s, bal }) => `
         <div class="roster-item">
           <div><div style="font-weight:600">${learnerLink(s.id, s.name, 'fees')}</div>
           <div class="card-desc">${escapeHtml(s.class)} · ${escapeHtml(s.guardian)} · <span style="color:var(--danger);font-weight:600">owes ${fmtMoney(bal)}</span></div></div>
           <div style="display:flex;gap:6px">
             <button class="btn btn-outline btn-xs" data-act="smsBalance" data-id="${escapeHtml(s.id)}">SMS</button>
             <button class="btn btn-outline btn-xs" data-act="waBalance" data-id="${escapeHtml(s.id)}">WhatsApp</button>
           </div>
         </div>`).join('')}</div>`;
  openModal({ title: 'Fee reminders' + escapeHtml(cls ? ' — ' + cls : ''), bodyHtml: body, footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>` });
}

/* ── Backup / restore ──────────────────────────────────────────────────── */
function exportLedger() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'school-backup-' + todayISO() + '.json';
  a.click(); URL.revokeObjectURL(a.href);
  try { localStorage.setItem('ksa_last_backup', todayISO()); } catch (_) {}
  updateBackupBanner();
  toast('Backup exported.', 'success');
}
function importLedger(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    let data;
    try { data = JSON.parse(e.target.result); } catch (_) { return toast('That file is not valid JSON.', 'error'); }
    if (!data || !Array.isArray(data.students)) return toast('That file is not a valid backup.', 'error');
    const ok = await confirmDialog({ title: 'Restore backup', message: 'This replaces all current data on this device with the contents of the backup file. Continue?', confirmLabel: 'Restore', danger: true });
    if (!ok) return;
    state = migrate(data); recomputePaid(); recomputeGrades(); saveState(); applySettings(); renderAll();
    toast('Backup restored.', 'success');
  };
  reader.readAsText(file);
}

/* =========================================================================
   Rendering
   ========================================================================= */
function renderAll() {
  acctCache = new Map();
  try { renderAllNow(); } finally { acctCache = null; }
}
function renderAllNow() {
  const guard = (fn) => { try { fn(); } catch (err) { console.error(err); } };
  guard(updateMetrics);
  guard(renderStudentTable);
  guard(renderPaymentsTable);
  guard(renderPrograms);
  guard(renderSportFilter);
  guard(renderSportOptions);
  guard(renderPerformanceTable);
  guard(renderAttendanceProgramSelect);
  guard(renderAttendanceRoster);
  guard(renderAttendanceTable);
  guard(renderSessionList);
  guard(renderBursaryTable);
  guard(renderConductForm);
  guard(renderConductTable);
  guard(renderStatisticalReports);
  guard(renderStudentSelects);
  guard(renderCompetitionsTable);
  guard(renderSquadsGrid);
  guard(renderAthleteProfiles);
  guard(renderNotices);
  guard(renderTodaysJobs);
  if (can('canManageUsers')) { guard(renderUsersList); guard(renderAuditLog); }
  if (can('canManageSettings')) guard(renderSettingsForm);
  MODULES.forEach(m => { if (m.render) guard(m.render); });
}

function updateMetrics() {
  const s = state.students;
  const collected = s.reduce((a, x) => a + studentPaid(x), 0);
  const outstanding = s.reduce((a, x) => a + studentBalance(x), 0);
  const cleared = s.filter(x => studentBalance(x) <= 0).length;
  const athletes = s.filter(x => x.sport).length;
  const bursaryCount = s.filter(bursaryEligible).length;
  const attRates = s.filter(x => x.sport).map(x => studentAttendance(x.id).rate);
  const avgAtt = attRates.length ? Math.round(attRates.reduce((a, b) => a + b, 0) / attRates.length) : 0;
  const role = currentSession ? currentSession.role : 'exec';

  let cards = [];
  if (['exec', 'admin'].includes(role)) {
    const f = financeSnapshot();
    cards = [
      { label: 'Learners', value: s.length },
      { label: 'Paid this term', value: fmtMoney(f.paidNow), cls: 'is-success', money: true, sub: `${f.rate}% of this term's bills` },
      { label: 'Owed', value: fmtMoney(outstanding), cls: 'is-danger', money: true, sub: f.debtors + ' learners owe' },
      { label: 'From earlier terms', value: fmtMoney(f.arrears), cls: 'is-gold', money: true, sub: 'part of what is owed' },
      { label: 'Fully paid', value: cleared, cls: 'is-info' },
    ];
  } else if (role === 'bursary') {
    const f = financeSnapshot();
    cards = [
      { label: 'Learners', value: s.length },
      { label: 'Paid this term', value: fmtMoney(f.paidNow), cls: 'is-success', money: true, sub: `${f.rate}% of this term's bills` },
      { label: 'Owed', value: fmtMoney(outstanding), cls: 'is-danger', money: true, sub: f.debtors + ' learners owe' },
      { label: 'From earlier terms', value: fmtMoney(f.arrears), cls: 'is-gold', money: true, sub: 'part of what is owed' },
      { label: 'Fully paid', value: cleared, cls: 'is-info' },
    ];
  } else if (role === 'teacher') {
    const mine = visibleStudents();
    const classes = visibleClasses();
    const today = todayISO();
    const done = classes.filter(c => (state.registers || []).some(r => r.class === c && r.date === today)).length;
    cards = [
      { label: 'My classes', value: classes.length },
      { label: 'Learners', value: mine.length, cls: 'is-info' },
      { label: "Today's registers", value: `${done} / ${classes.length}`, cls: done === classes.length ? 'is-success' : 'is-gold' },
    ];
  } else {
    cards = [
      { label: 'Athletes', value: athletes },
      { label: 'Programs', value: state.programs.length, cls: 'is-info' },
      { label: 'Avg training attendance', value: avgAtt + '%', cls: avgAtt >= 75 ? 'is-success' : 'is-danger' },
      { label: 'Bursary Eligible', value: bursaryCount, cls: 'is-gold' },
    ];
  }
  const row = el('metricsRow');
  if (row) row.innerHTML = cards.map(c => `
    <div class="stat ${c.cls || ''}">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value ${c.money ? 'money' : ''}">${c.value}</div>${c.sub ? `<div class="stat-sub">${c.sub}</div>` : ''}
    </div>`).join('');

  const levels = ['Pre-Primary', 'Primary', 'O Level', 'A Level', 'Other'];
  const counts = levels.map(l => s.filter(x => x.level === l).length);
  const max = Math.max(1, ...counts);
  const bd = el('levelBreakdown');
  if (bd) bd.innerHTML = levels.map((l, i) => `
    <div>
      <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span style="font-weight:600">${l}</span><span class="t-muted">${counts[i]}</span></div>
      <div class="bar"><span style="width:${(counts[i] / max) * 100}%"></span></div>
    </div>`).join('');
}

/* Students: one row per child that fits a phone. One money figure (what is
   owed in all, as on the learner page), sorted by class then name. */
const DIR_PAGE = 50;
function studentSearchMatch(s, words, digits) {
  const hay = `${s.name} ${s.id} ${s.class} ${s.stream || ''}`.toLowerCase();
  if (words.length && words.every(w => hay.includes(w))) return true;
  // A guardian's phone, typed any way (0772…, +256 772…, 772 123…).
  return digits.length >= 6 && [s.guardian, s.guardian2].some(g => (g || '').replace(/\D/g, '').includes(digits.length > 9 ? digits.slice(-9) : digits));
}
function renderStudentTable() {
  const body = el('studentTableBody'); if (!body) return;
  fillSelect('dirClass', '<option value="">All classes</option>' + visibleClasses().map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  const raw = (el('searchInput').value || '').trim().toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean), digits = raw.replace(/\D/g, '');
  const cls = el('dirClass').value, show = el('dirShow').value;
  const order = c => { const i = CLASS_OPTIONS.indexOf(c); return i < 0 ? 999 : i; };
  const inClass = state.students.filter(s => (!cls || s.class === cls) && (!raw || studentSearchMatch(s, words, digits)))
    .map(s => ({ s, owes: studentAccount(s).balance }));
  const owing = inClass.filter(x => x.owes > 0).length;
  const list = inClass.filter(x => !show || (show === 'owe' ? x.owes > 0 : x.owes <= 0))
    .sort((a, b) => order(a.s.class) - order(b.s.class) || (a.s.stream || '').localeCompare(b.s.stream || '') || a.s.name.localeCompare(b.s.name));
  const pages = Math.max(1, Math.ceil(list.length / DIR_PAGE));
  if (studentPage > pages) studentPage = pages;
  const slice = list.slice((studentPage - 1) * DIR_PAGE, studentPage * DIR_PAGE);

  const sum = el('dirSummary');
  if (sum) {
    sum.style.display = inClass.length ? '' : 'none';
    sum.innerHTML = `<strong>${inClass.length}</strong> learner${inClass.length === 1 ? '' : 's'}${cls ? ' in ' + escapeHtml(cls) : ''}${raw ? ' matching your search' : ''} · `
      + (owing ? `<button type="button" class="link-btn t-bad" data-act="dirShowOwe">${owing} owe fees</button>` : '<span class="t-ok">nobody owes fees</span>')
      + ` · ${inClass.length - owing} paid up`;
  }
  const tel = g => { const n = normalizePhone(g); return n ? `<a href="tel:${escapeHtml(n)}">${escapeHtml(g)}</a>` : escapeHtml(g || '—'); };
  body.innerHTML = slice.length ? slice.map(({ s, owes }) => {
    const editBtn = can('canEditStudents') ? `<button class="btn btn-outline btn-xs" type="button" data-act="editStudent" data-id="${escapeHtml(s.id)}">Edit</button>` : '';
    const delBtn = can('canDeleteStudents') ? `<button class="btn btn-ghost btn-xs t-bad" type="button" data-act="deleteStudent" data-id="${escapeHtml(s.id)}" aria-label="Remove ${escapeHtml(s.name)}">Remove</button>` : '';
    return `<div class="dir-row">
      <div class="dir-main">
        <div style="font-weight:600">${learnerLink(s.id, s.name)}${s.senFlag ? ` <span class="badge badge-purple">${escapeHtml(s.senFlag)}</span>` : ''}</div>
        <div class="card-desc">${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''} · ${escapeHtml(s.id)}${s.boardingStatus && s.boardingStatus !== 'Day' ? ' · ' + escapeHtml(s.boardingStatus === 'Weekly' ? 'Weekly boarder' : 'Boarder') : ''}</div>
        <div class="card-desc">Guardian ${tel(s.guardian)}${s.guardian2 ? ' · ' + tel(s.guardian2) : ''}</div>
      </div>
      <div class="dir-side">
        <div class="dir-owes ${owes > 0 ? 't-bad' : 't-ok'}">${owes > 0 ? 'Owes ' + fmtMoney(owes) : 'Paid up'}</div>
        <div class="row-actions"><button class="btn btn-primary btn-xs" type="button" data-act="learner" data-id="${escapeHtml(s.id)}">Open</button>${editBtn}${delBtn}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty">${state.students.length ? 'No learners match. Clear the search or choose All classes.' : 'No learners yet. Use Admit a student, or Import from Excel.'}</div>`;
  const pager = el('studentPager');
  if (pager) {
    pager.innerHTML = list.length > DIR_PAGE ? `
      <span>Showing ${(studentPage - 1) * DIR_PAGE + 1}–${Math.min(studentPage * DIR_PAGE, list.length)} of ${list.length}</span>
      <span class="pager-btns">
        <button class="btn btn-outline btn-xs" data-act="studentPage" data-page="prev" ${studentPage <= 1 ? 'disabled' : ''}>${icon('left', 14)} Previous</button>
        <button class="btn btn-outline btn-xs" data-act="studentPage" data-page="next" ${studentPage >= pages ? 'disabled' : ''}>Next ${icon('right', 14)}</button>
      </span>` : '';
  }
}

/* A programme's athletes: its own list, or, until the coach edits it, the
   learners whose primary sport is the programme's sport. */
function programAthletes(p) {
  if (Array.isArray(p.athleteIds)) return p.athleteIds.map(id => state.students.find(s => s.id === id)).filter(Boolean);
  return state.students.filter(s => (s.sport || '').toLowerCase() === (p.sport || '').toLowerCase() && s.sport);
}
function renderPrograms() {
  const grid = el('programsGrid'); if (!grid) return;
  if (!state.programs.length) { grid.innerHTML = '<div class="empty">No programs yet.</div>'; return; }
  grid.innerHTML = state.programs.map(p => {
    const athletes = programAthletes(p).sort((a, b) => a.name.localeCompare(b.name));
    const days = (p.days || []).map(d => `<span class="badge badge-info">${escapeHtml(d)}</span>`).join(' ') || '<span class="t-muted" style="font-size:12px">No schedule</span>';
    const reqs = (p.requirements || []).length ? '<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--muted)">' + p.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>' : '<p class="card-desc" style="margin-top:6px">No requirements listed</p>';
    const del = can('canAddProgram') ? `<button class="btn-icon" title="Remove this programme" aria-label="Remove ${escapeHtml(p.name)}" data-act="deleteProgram" data-id="${escapeHtml(p.id)}">${icon('trash', 15)}</button>` : '';
    const names = athletes.slice(0, 8).map(s => learnerLink(s.id, s.name)).join(', ') + (athletes.length > 8 ? ` <span class="card-desc">+ ${athletes.length - 8} more</span>` : '');
    const edit = can('canAddProgram') ? `<button class="btn btn-outline btn-xs" type="button" data-act="programAthletes" data-id="${escapeHtml(p.id)}" style="margin-top:8px">Add or remove athletes</button>` : '';
    return `<div class="tile">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><div style="font-weight:700">${escapeHtml(p.name)}</div><div class="card-desc">${escapeHtml(p.sport)} · Coach ${escapeHtml(p.coach)}</div></div>${del}
      </div>
      <div class="pill-list" style="margin-top:9px">${days}</div>
      <div class="form-label" style="margin-top:11px;margin-bottom:2px">Athletes (${athletes.length})</div>
      <div style="font-size:13px;line-height:1.7">${athletes.length ? names : '<span class="card-desc">No athletes yet.</span>'}</div>${edit}
      <div class="form-label" style="margin-top:11px;margin-bottom:2px">Requirements</div>${reqs}
    </div>`;
  }).join('');
}
/* Tick the learners in a programme. Saving makes the programme's own list. */
function openProgramAthletes(programId) {
  if (!can('canAddProgram')) return toast('You do not have permission.', 'error');
  const p = state.programs.find(x => x.id === programId); if (!p) return;
  const inProg = new Set(programAthletes(p).map(s => s.id));
  const learners = [...state.students].sort((a, b) => (CLASS_OPTIONS.indexOf(a.class) - CLASS_OPTIONS.indexOf(b.class)) || a.name.localeCompare(b.name));
  const classes = [...new Set(learners.map(s => s.class))];
  openModal({
    title: 'Athletes in ' + escapeHtml(p.name), wide: true,
    bodyHtml: `<p class="card-desc" style="margin:0 0 10px">Tick every learner who trains in ${escapeHtml(p.name)}. A learner can be in more than one programme.</p>
      <div class="form-row" style="margin-bottom:10px"><div><label class="form-label" for="paClass">Class</label><select class="input" id="paClass"><option value="">All classes</option>${classes.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select></div>
        <div><label class="form-label" for="paSearch">Search</label><input class="input" id="paSearch" type="search" placeholder="Name"></div></div>
      <div class="reg-summary" id="paCount"></div>
      <div class="scroll-box" id="paList" style="max-height:380px">${learners.map(s => `<label class="roster-item pa-row" data-class="${escapeHtml(s.class)}" data-name="${escapeHtml(s.name.toLowerCase())}" style="cursor:pointer">
        <div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}${s.sport ? ' · ' + escapeHtml(s.sport) : ''}</div></div>
        <input type="checkbox" class="pa-tick" value="${escapeHtml(s.id)}" ${inProg.has(s.id) ? 'checked' : ''} aria-label="${escapeHtml(s.name)} trains in ${escapeHtml(p.name)}"></label>`).join('')}</div>`,
    footHtml: '<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="paSave">Save athletes</button>',
    onOpen(root) {
      const count = () => { root.querySelector('#paCount').textContent = `${root.querySelectorAll('.pa-tick:checked').length} athletes ticked`; };
      const filter = () => {
        const c = root.querySelector('#paClass').value, q = root.querySelector('#paSearch').value.trim().toLowerCase();
        root.querySelectorAll('.pa-row').forEach(r => { r.style.display = (!c || r.dataset.class === c) && (!q || r.dataset.name.includes(q)) ? '' : 'none'; });
      };
      root.querySelector('#paClass').addEventListener('change', filter);
      root.querySelector('#paSearch').addEventListener('input', filter);
      root.querySelector('#paList').addEventListener('change', count);
      count();
      root.querySelector('#paSave').addEventListener('click', () => {
        p.athleteIds = [...root.querySelectorAll('.pa-tick:checked')].map(x => x.value);
        saveState(); renderAll(); closeModal();
        toast(`${p.name} now has ${p.athleteIds.length} athlete${p.athleteIds.length === 1 ? '' : 's'}.`, 'success');
      });
    },
  });
}

function renderPerformanceTable() {
  const body = el('performanceTableBody'); if (!body) return;
  const filter = (el('sportFilter').value || '').toLowerCase();
  const list = state.students.filter(s => s.sport && (!filter || (s.sport || '').toLowerCase() === filter));
  body.innerHTML = list.length ? list.map(s => {
    const notes = s.performanceNotes || [];
    const latest = notes[notes.length - 1];
    return `<tr>
      <td style="font-weight:600">${learnerLink(s.id, s.name)}</td>
      <td>${escapeHtml(s.class)}</td>
      <td>${escapeHtml(s.sport)}</td>
      <td>${skillBadge(s.skillLevel)}</td>
      <td class="t-muted">${latest ? escapeHtml(latest.date) : '—'}</td>
      <td style="max-width:240px">${latest ? escapeHtml(latest.note) : '<span class="t-muted">No evaluations</span>'}</td>
      <td><button class="btn btn-outline btn-xs" data-act="notes" data-id="${escapeHtml(s.id)}">History</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No athletes tracked yet.</td></tr>';
}

function renderAttendanceProgramSelect() {
  const sel = el('attendanceProgram'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Choose a programme…</option>' + state.programs.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.sport)})</option>`).join('');
  if (cur) sel.value = cur;
  const f = el('sessProgram');
  if (f) { const c = f.value; f.innerHTML = '<option value="">All programmes</option>' + state.programs.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join(''); if (c) f.value = c; }
  if (el('attendanceDate') && !el('attendanceDate').value) el('attendanceDate').value = todayISO();
}
/* Training attendance: the same tap-a-name list as the class register. */
function renderAttendanceRoster() {
  const roster = el('attendanceRoster'); if (!roster) return;
  const programId = el('attendanceProgram').value;
  const date = el('attendanceDate').value || todayISO();
  if (!programId) { roster.innerHTML = '<div class="empty">Choose a programme to list its athletes.</div>'; renderTrainingSummary(); return; }
  const program = state.programs.find(p => p.id === programId);
  const athletes = program ? programAthletes(program).sort((a, b) => a.name.localeCompare(b.name)) : [];
  if (!athletes.length) { roster.innerHTML = '<div class="empty">No athletes in this programme yet. Add them under Sports → Programmes.</div>'; renderTrainingSummary(); return; }
  const existing = state.attendance.find(a => a.programId === programId && a.date === date);
  const presentMap = {};
  if (existing) (existing.records || []).forEach(r => { presentMap[r.studentId] = r.present; });
  roster.innerHTML = athletes.map(s => {
    const st = presentMap[s.id] === false ? 'A' : 'P';
    return `<div class="roster-item reg-row" data-student="${escapeHtml(s.id)}" data-status="${st}">
      <div class="reg-name"><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}</div></div>
      <div class="seg seg-words" role="radiogroup" aria-label="Training attendance for ${escapeHtml(s.name)}">${[['P', 'Present'], ['A', 'Absent']].map(([k, label]) => `<button type="button" role="radio" aria-checked="${k === st}" class="${k === st ? 'on-' + k : ''}" data-set-att="${k}">${label}</button>`).join('')}</div>
    </div>`;
  }).join('');
  const note = el('trainingNote');
  if (note) note.textContent = existing ? 'This session was saved before. Change anyone and press Save session to update it.' : 'Everyone starts as Present. Tap Absent for each athlete who did not come, then press Save session.';
  renderTrainingSummary();
}
function renderTrainingSummary() {
  const box = el('trainSummary'); if (!box) return;
  const rows = [...document.querySelectorAll('#attendanceRoster .reg-row')];
  if (!rows.length) { box.style.display = 'none'; return; }
  const missed = rows.filter(r => r.dataset.status === 'A').map(r => escapeHtml((state.students.find(s => s.id === r.dataset.student) || {}).name || ''));
  box.style.display = '';
  box.innerHTML = `<strong>${rows.length}</strong> athlete${rows.length === 1 ? '' : 's'} · <span class="t-ok">${rows.length - missed.length} present</span> · `
    + (missed.length ? `<span class="t-bad">${missed.length} missed: ${missed.join(', ')}</span>` : '<span class="t-ok">nobody missed</span>');
}
function setAttendanceRow(row, st) {
  row.dataset.status = st;
  row.querySelectorAll('[data-set-att]').forEach(b => { const on = b.dataset.setAtt === st; b.className = on ? 'on-' + st : ''; b.setAttribute('aria-checked', on); });
  renderTrainingSummary();
}
/* Sessions: every training session, with the names of who missed it. */
function renderSessionList() {
  const box = el('sessionList'); if (!box) return;
  const f = el('sessProgram') ? el('sessProgram').value : '';
  const list = state.attendance.filter(a => !f || a.programId === f).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  box.innerHTML = list.length ? list.map(a => {
    const p = state.programs.find(x => x.id === a.programId) || { name: 'Programme removed' };
    const recs = a.records || [];
    const missed = recs.filter(r => !r.present).map(r => state.students.find(s => s.id === r.studentId)).filter(Boolean);
    const change = can('canMarkAttendance') && p.id ? `<button class="btn btn-outline btn-xs" type="button" data-act="openSession" data-id="${escapeHtml(a.programId)}" data-date="${escapeHtml(a.date)}">Change</button>` : '';
    return `<div class="abs-item"><div class="abs-head"><div><strong>${escapeHtml(fmtDay(a.date))}</strong> · <strong>${escapeHtml(p.name)}</strong> · <span class="card-desc">${recs.length - missed.length} of ${recs.length} came</span></div>${change}</div>
      <div class="abs-names">${missed.length ? `<span class="abs-label t-bad">Missed:</span> ${missed.map(s => learnerLink(s.id, s.name)).join(', ')}` : '<span class="t-ok">Everyone came.</span>'}</div></div>`;
  }).join('') : '<div class="empty">No training sessions recorded yet.</div>';
}
/* Who attends training: each athlete's sessions, rate and the dates missed. */
function renderAttendanceTable() {
  const body = el('attendanceTableBody'); if (!body) return;
  // Athletes with at least one session recorded.
  const ids = new Set();
  state.attendance.forEach(a => (a.records || []).forEach(r => ids.add(r.studentId)));
  const athletes = state.students.filter(s => ids.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (!athletes.length || !state.attendance.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No sessions recorded yet.</td></tr>'; return; }
  body.innerHTML = athletes.map(s => {
    const att = studentAttendance(s.id);
    const missed = state.attendance.filter(a => (a.records || []).some(r => r.studentId === s.id && !r.present)).map(a => a.date).sort().reverse();
    const color = att.rate >= 75 ? 'var(--success)' : att.rate >= 50 ? 'var(--warn)' : 'var(--danger)';
    const progs = state.programs.filter(p => programAthletes(p).some(x => x.id === s.id)).map(p => p.name).join(', ') || s.sport || '—';
    return `<tr><td style="font-weight:600">${learnerLink(s.id, s.name)}</td><td>${escapeHtml(progs)}</td><td class="t-center">${att.total}</td><td class="t-center">${att.present}</td><td class="t-center" style="font-weight:700;color:${color}">${att.total ? att.rate + '%' : '—'}</td>
      <td>${missed.length ? `<span class="t-bad">${missed.slice(0, 4).map(d => escapeHtml(fmtDay(d, false))).join(', ')}</span>${missed.length > 4 ? ` <span class="card-desc">+ ${missed.length - 4} more</span>` : ''}` : '<span class="t-ok">None</span>'}</td></tr>`;
  }).join('');
}
function renderBursaryTable() {
  const body = el('bursaryTableBody'); if (!body) return;
  const athletes = state.students.filter(s => s.sport);
  if (!athletes.length) { body.innerHTML = '<tr><td colspan="8" class="empty">No athletes registered.</td></tr>'; return; }
  const ranked = athletes.map(s => ({ s, score: bursaryScore(s), att: studentAttendance(s.id) })).sort((a, b) => b.score - a.score);
  body.innerHTML = ranked.map(({ s, score, att }) => {
    const eligible = score >= 70;
    const badge = eligible ? '<span class="badge badge-success">Eligible</span>' : '<span class="badge badge-neutral">Below threshold</span>';
    const action = can('canAwardBursary') ? `<button class="btn btn-gold btn-xs" data-act="setBursary" data-id="${escapeHtml(s.id)}">Award</button>` : (s.bursaryPct > 0 ? `<span style="color:var(--warn);font-weight:700">${s.bursaryPct}%</span>` : '—');
    return `<tr>
      <td style="font-weight:600">${learnerLink(s.id, s.name)}</td>
      <td class="card-desc">${escapeHtml(s.class)} · ${escapeHtml(s.level)}</td>
      <td>${escapeHtml(s.sport)} ${skillBadge(s.skillLevel)}</td>
      <td class="t-center">${att.rate}% <span class="card-desc">(${att.present}/${att.total})</span></td>
      <td class="t-center">${(s.performanceNotes || []).length}</td>
      <td class="t-center"><div style="font-size:18px;font-weight:700;color:${eligible ? 'var(--success)' : 'var(--faint)'}">${score}</div>${badge}</td>
      <td class="t-center">${s.bursaryPct > 0 ? `<span style="font-weight:700;color:var(--warn)">−${s.bursaryPct}%</span>` : '—'}</td>
      <td class="t-center">${action}</td>
    </tr>`;
  }).join('');
}

/* ── Discipline ────────────────────────────────────────────────────────── */
/* What happened sets how serious it is, so a detention can never be stored
   or texted as a commendation. Older entries keep their type, and their
   group comes from the type too. */
const CONDUCT_TYPES = {
  'Commendation':    { group: 'good',    severity: 'Positive', label: 'Commendation',    said: 'received a commendation' },
  'Verbal Warning':  { group: 'concern', severity: 'Minor',    label: 'Verbal warning',  said: 'was given a verbal warning' },
  'Counselling':     { group: 'concern', severity: 'Minor',    label: 'Counselling',     said: 'was referred for counselling' },
  'Written Warning': { group: 'serious', severity: 'Major',    label: 'Written warning', said: 'was given a written warning' },
  'Detention':       { group: 'serious', severity: 'Major',    label: 'Detention',       said: 'was given a detention' },
  'Suspension':      { group: 'serious', severity: 'Severe',   label: 'Suspension',      said: 'was suspended' },
};
const CONDUCT_GROUPS = { good: ['Good', 'badge-success'], concern: ['A concern', 'badge-warn'], serious: ['Serious', 'badge-danger'] };
function conductKind(c) {
  const t = CONDUCT_TYPES[c.type];
  if (t) return t;
  const group = c.severity === 'Positive' ? 'good' : ['Major', 'Severe'].includes(c.severity) ? 'serious' : 'concern';
  return { group, severity: c.severity || 'Minor', label: c.type || 'Conduct entry', said: `had a conduct entry (${String(c.type || 'other').toLowerCase()})` };
}
/* The message to the guardian: the date, what happened and what the child did. */
function conductMessage(c, s, whatsapp = false) {
  const k = conductKind(c);
  const name = whatsapp ? `*${s.name}*` : s.name;
  const close = k.group === 'good' ? 'Well done!' : 'Please contact the school if you would like to talk about it.';
  return `Dear parent/guardian, on ${fmtDay(c.date)} ${name} (${s.class}) ${k.said}${c.description ? `: "${c.description}"` : ''}. ${close} — ${c.reportedBy || 'School staff'}, ${schoolName()}`;
}
function conductPhone(s, to) { return normalizePhone(to === '2' ? s.guardian2 : s.guardian); }
function sendConduct(conductId, to = '1', whatsapp = false) {
  const c = state.conduct.find(x => x.id === conductId); if (!c) return;
  const s = state.students.find(x => x.id === c.studentId); if (!s) return;
  const phone = conductPhone(s, to);
  if (!phone) return toast(`There is no valid ${to === '2' ? 'second guardian' : 'guardian'} number for ${s.name}.`, 'error');
  const text = conductMessage(c, s, whatsapp);
  window.open(whatsapp ? 'https://wa.me/' + phone.replace('+', '') + '?text=' + encodeURIComponent(text) : 'sms:' + phone + '?body=' + encodeURIComponent(text), '_blank');
}

/* Returns the saved entry, or null when it was refused (the form keeps what was typed). */
function addConduct(f) {
  const no = msg => { toast(msg, 'error'); return null; };
  if (!can('canLogConduct')) return no('You do not have permission to log conduct.');
  const s = state.students.find(x => x.id === f.studentId);
  if (!s) return no('Choose the learner first.');
  const kind = CONDUCT_TYPES[f.type];
  if (!kind) return no('Choose what happened.');
  const description = (f.description || '').trim();
  if (!description) return no('Write what the child did.');
  const date = f.date || todayISO();
  if (date > todayISO()) return no('The date cannot be in the future.');
  const entry = { id: newId('CON'), studentId: s.id, date, type: f.type, severity: kind.severity, description, reportedBy: (f.reportedBy || '').trim() || currentSession.displayName };
  state.conduct.push(entry);
  saveState(); renderAll();
  AUTH.audit('CONDUCT_ADD', `${kind.label} · ${s.name} (${s.id}) · ${fmtDay(date)}`);
  toast(`${kind.label} saved for ${s.name}.`, 'success');
  return entry;
}
async function deleteConduct(id) {
  if (!can('canDeleteConduct')) return toast('You do not have permission.', 'error');
  const c = state.conduct.find(x => x.id === id); if (!c) return;
  const s = state.students.find(x => x.id === c.studentId);
  const k = conductKind(c);
  const who = s ? s.name : 'this learner';
  if (!await confirmDialog({ title: 'Delete a conduct entry', message: `Delete the ${k.label.toLowerCase()} for ${who} on ${fmtDay(c.date)}? It is removed from ${who}'s record.`, confirmLabel: 'Delete entry', danger: true })) return;
  state.conduct = state.conduct.filter(x => x.id !== id);
  saveState(); renderAll();
  AUTH.audit('CONDUCT_DELETE', `${k.label} · ${who}${s ? ' (' + s.id + ')' : ''} · ${fmtDay(c.date)}`);
  toast('Conduct entry deleted.', 'success');
}
/* After saving: the message for the guardian, ready to send. */
function showConductDone(c) {
  const box = el('conductDone'); if (!box || !c) return;
  const s = state.students.find(x => x.id === c.studentId); if (!s) return;
  const k = conductKind(c);
  const send = (to, label) => `<button class="btn btn-outline btn-sm" type="button" data-act="smsConduct" data-id="${escapeHtml(c.id)}" data-to="${to}">SMS ${label}</button><button class="btn btn-outline btn-sm" type="button" data-act="waConduct" data-id="${escapeHtml(c.id)}" data-to="${to}">WhatsApp ${label}</button>`;
  box.className = 'tile pay-done';
  box.style.display = '';
  box.innerHTML = `<div class="pay-done-title">${icon('check', 18)} Saved: ${escapeHtml(k.label.toLowerCase())} for ${escapeHtml(s.name)}</div>
    <div class="form-label" style="margin:10px 0 4px">Message for the guardian</div>
    <div class="tile" style="background:#fff;font-size:13.5px;white-space:pre-wrap" id="conductMsg">${escapeHtml(conductMessage(c, s))}</div>
    <div class="toolbar" style="margin-top:10px">${conductPhone(s, '1') ? send('1', 'guardian') : '<span class="card-desc">No valid guardian number on file.</span>'}${s.guardian2 && conductPhone(s, '2') ? send('2', 'second guardian') : ''}</div>
    <div class="toolbar" style="margin-top:8px"><button class="btn btn-ghost btn-sm" type="button" data-act="learner" data-id="${escapeHtml(s.id)}" data-section="discipline">Open ${escapeHtml(s.name)}</button><button class="btn btn-ghost btn-sm" type="button" data-act="conductAnother">Log another</button></div>`;
  if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}
/* The form: class first, then the child; today's date and the signed-in person by default. */
function renderConductForm() {
  if (!el('conductStudent')) return;
  const classes = classesWithLearners();
  fillSelect('conductClass', '<option value="">All classes</option>' + classes.map(c => `<option>${escapeHtml(c)}</option>`).join(''));
  const cls = el('conductClass').value;
  const list = state.students.filter(s => !cls || s.class === cls).sort((a, b) => a.name.localeCompare(b.name));
  fillSelect('conductStudent', `<option value="">${list.length ? 'Choose a learner…' : 'No learners in this class'}</option>` + list.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(classAndStream(s))}</option>`).join(''));
  const d = el('conductDate'); if (d) { d.max = todayISO(); if (!d.value) d.value = todayISO(); }
  const by = el('conductBy'); if (by && !by.value && currentSession) by.value = currentSession.displayName || '';
  fillSelect('conductClassFilter', '<option value="">All classes</option>' + classes.map(c => `<option>${escapeHtml(c)}</option>`).join(''));
}
/* Choose a learner on the form (e.g. "Log a conduct entry" on their learner page). */
function chooseConductLearner(id) {
  const s = state.students.find(x => x.id === id); if (!s) return;
  const sel = el('conductClass');
  if (sel) sel.value = [...sel.options].some(o => o.value === s.class) ? s.class : '';
  renderConductForm();
  el('conductStudent').value = id;
}
function conductInTerm(c, t) { return inTermWindow(c.date, t); }
function renderConductTable() {
  const body = el('conductTableBody'); if (!body) return;
  const cls = (el('conductClassFilter') || {}).value || '';
  const group = (el('conductFilter') || {}).value || '';
  const period = (el('conductPeriod') || {}).value || 'term';
  const t = getCurrentTerm();
  const byId = new Map(state.students.map(s => [s.id, s]));
  const inView = state.conduct.filter(c => {
    const s = byId.get(c.studentId);
    return (!cls || (s && s.class === cls)) && (period === 'all' || conductInTerm(c, t));
  });
  const list = inView.filter(c => !group || conductKind(c).group === group)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  const sum = el('conductSummary');
  if (sum) {
    const n = { good: 0, concern: 0, serious: 0 };
    inView.forEach(c => { n[conductKind(c).group]++; });
    const counts = {};
    inView.filter(c => conductKind(c).group !== 'good').forEach(c => { counts[c.studentId] = (counts[c.studentId] || 0) + 1; });
    const most = Object.entries(counts).filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, k]) => { const s = byId.get(id); return s ? `${learnerLink(s.id, s.name, 'discipline')} (${k})` : ''; }).filter(Boolean);
    const where = `${period === 'all' ? 'All terms' : escapeHtml(termLabel(t))}${cls ? ' · ' + escapeHtml(cls) : ''}`;
    sum.innerHTML = inView.length
      ? `${where}: <strong>${inView.length}</strong> entr${inView.length === 1 ? 'y' : 'ies'} — <span class="t-ok">${n.good} good</span> · <span class="t-warn">${n.concern} concern${n.concern === 1 ? '' : 's'}</span> · <span class="t-bad">${n.serious} serious</span>${most.length ? `<br>More than one concern: ${most.join(', ')}` : ''}`
      : `${where}: no entries.`;
  }
  body.innerHTML = list.length ? list.map(c => {
    const s = byId.get(c.studentId);
    const k = conductKind(c);
    const [glabel, gbadge] = CONDUCT_GROUPS[k.group];
    const send = s ? `<button class="btn btn-outline btn-xs" type="button" data-act="smsConduct" data-id="${escapeHtml(c.id)}">SMS</button><button class="btn btn-outline btn-xs" type="button" data-act="waConduct" data-id="${escapeHtml(c.id)}">WhatsApp</button>` : '';
    const del = can('canDeleteConduct') ? `<button class="btn btn-ghost btn-xs t-bad" type="button" data-act="deleteConduct" data-id="${escapeHtml(c.id)}" aria-label="Delete the entry for ${escapeHtml(s ? s.name : 'this learner')}">Delete</button>` : '';
    return `<div class="dir-row">
      <div class="dir-main">
        <div style="font-weight:600">${s ? learnerLink(s.id, s.name, 'discipline') + ` <span class="card-desc">· ${escapeHtml(classAndStream(s))}</span>` : '<em class="t-muted">Learner removed</em>'}</div>
        <div style="margin-top:3px"><span class="badge ${gbadge}" title="${escapeHtml(glabel)}">${escapeHtml(k.label)}</span> <span class="card-desc">${escapeHtml(fmtDay(c.date))}${c.reportedBy ? ' · reported by ' + escapeHtml(c.reportedBy) : ''}</span></div>
        ${c.description ? `<div style="margin-top:4px;font-size:13.5px">${escapeHtml(c.description)}</div>` : ''}
      </div>
      <div class="dir-side"><div class="row-actions">${send}${del}</div></div>
    </div>`;
  }).join('') : `<div class="empty">${state.conduct.length ? 'No entries match. Choose All classes, Good and bad, or All terms.' : 'No conduct entries yet.'}</div>`;
}

function renderStatisticalReports() {
  const levels = ['Pre-Primary', 'Primary', 'O Level', 'A Level', 'Other'];
  if (el('levelStats')) el('levelStats').innerHTML = levels.map(l => {
    const cnt = state.students.filter(s => s.level === l).length;
    const col = state.students.filter(s => s.level === l).reduce((a, s) => a + studentPaid(s), 0);
    return `<div class="stat is-info"><div class="stat-label">${l}</div><div class="stat-value">${cnt}</div><div class="stat-sub" style="color:var(--success)">${fmtMoney(col)}</div></div>`;
  }).join('');

  const classMap = {};
  state.students.forEach(s => { (classMap[s.class] = classMap[s.class] || []).push(s); });
  const rows = Object.keys(classMap).sort();
  if (el('classStatsBody')) el('classStatsBody').innerHTML = rows.length ? rows.map(k => {
    const list = classMap[k];
    const avgScores = list.map(s => studentAcademicSummary(s).avg).filter(v => v > 0);
    const avg = avgScores.length ? Math.round(avgScores.reduce((a, b) => a + b, 0) / avgScores.length) : 0;
    const cleared = list.filter(s => studentBalance(s) <= 0).length;
    const outstanding = list.reduce((a, s) => a + studentBalance(s), 0);
    return `<tr><td style="font-weight:600">${escapeHtml(k)}</td><td>${escapeHtml(list[0].level)}</td><td class="t-center">${list.length}</td><td class="t-center">${avg ? avg + '%' : '—'}</td><td class="t-center" style="color:var(--success)">${cleared}/${list.length}</td><td class="t-num" style="color:var(--danger)">${fmtMoney(outstanding)}</td><td class="t-center" style="color:var(--brand)">${list.filter(s => s.sport).length}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No data.</td></tr>';

  const sportCounts = {};
  state.students.forEach(s => { if (s.sport) sportCounts[s.sport] = (sportCounts[s.sport] || 0) + 1; });
  const entries = Object.entries(sportCounts).sort((a, b) => b[1] - a[1]);
  const sm = Math.max(1, ...entries.map(e => e[1]));
  if (el('sportStats')) el('sportStats').innerHTML = entries.length ? entries.map(([sport, n]) => `
    <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span style="font-weight:600">${escapeHtml(sport)}</span><span>${n}</span></div><div class="bar"><span class="gold" style="width:${(n / sm) * 100}%"></span></div></div>`).join('') : '<p class="card-desc">No sports data.</p>';

  renderGenderBoardingSenStats();
  renderEMISPreview();
}

function statBars(target, data) {
  const totalN = Math.max(1, data.reduce((a, d) => a + d[1], 0));
  target.innerHTML = data.map(([l, n, col]) => `
    <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span style="font-weight:600;color:${col}">${l}</span><span>${n} (${Math.round(n / totalN * 100)}%)</span></div><div class="bar"><span style="background:${col};width:${Math.round(n / totalN * 100)}%"></span></div></div>`).join('');
}
function renderGenderBoardingSenStats() {
  const s = state.students;
  if (el('genderStats')) statBars(el('genderStats'), [['Male', s.filter(x => x.gender === 'Male').length, '#1d4ed8'], ['Female', s.filter(x => x.gender === 'Female').length, '#be185d'], ['Not set', s.filter(x => !x.gender).length, '#94a3b8']]);
  if (el('boardingStats')) statBars(el('boardingStats'), [['Day scholar', s.filter(x => (x.boardingStatus || 'Day') === 'Day').length, '#0b5d3b'], ['Boarding', s.filter(x => x.boardingStatus === 'Boarding').length, '#6d28d9'], ['Weekly', s.filter(x => x.boardingStatus === 'Weekly').length, '#1d4ed8']]);
  const senEl = el('senStats');
  if (senEl) {
    const withSEN = s.filter(x => x.senFlag);
    if (!withSEN.length) senEl.innerHTML = '<p class="card-desc">No special-needs learners recorded.</p>';
    else {
      const types = {}; withSEN.forEach(x => { types[x.senFlag] = (types[x.senFlag] || 0) + 1; });
      senEl.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${withSEN.length} SEN learner${withSEN.length > 1 ? 's' : ''}</div>` + Object.entries(types).map(([t, n]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--line)"><span>${escapeHtml(t)}</span><span style="font-weight:700">${n}</span></div>`).join('');
    }
  }
}

function renderEMISPreview() {
  const card = el('emisCard'); if (!card) return;
  card.style.display = can('canViewEMIS') ? '' : 'none';
  if (!can('canViewEMIS')) return;
  const el2 = el('emisPreview'); if (!el2) return;
  const levels = ['Pre-Primary', 'Primary', 'O Level', 'A Level', 'Other'];
  const ct = getCurrentTerm();
  el2.innerHTML = `<p class="card-desc" style="margin-bottom:10px">Term: <strong>${ct ? escapeHtml(ct.year + ' ' + ct.term) : 'Not set — open one under Fees → Terms &amp; fee structures'}</strong></p>
    <div class="table-wrap"><table><thead><tr><th>Level</th><th class="t-center">Total</th><th class="t-center">Male</th><th class="t-center">Female</th><th class="t-center">Boarding</th><th class="t-center">Day</th><th class="t-center">SEN</th><th class="t-center">Cleared</th></tr></thead><tbody>
    ${levels.map(lvl => { const list = state.students.filter(s => s.level === lvl); return `<tr><td style="font-weight:600">${lvl}</td><td class="t-center">${list.length}</td><td class="t-center">${list.filter(s => s.gender === 'Male').length}</td><td class="t-center">${list.filter(s => s.gender === 'Female').length}</td><td class="t-center">${list.filter(s => s.boardingStatus === 'Boarding').length}</td><td class="t-center">${list.filter(s => (s.boardingStatus || 'Day') === 'Day').length}</td><td class="t-center">${list.filter(s => s.senFlag).length}</td><td class="t-center" style="color:var(--success)">${list.filter(s => studentBalance(s) <= 0).length}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
function exportEMIS() {
  if (!can('canViewEMIS')) return;
  const ct = getCurrentTerm();
  const termLabel = ct ? `${ct.year}_${ct.term.replace(/ /g, '_')}` : 'Term_Unknown';
  const levels = ['Pre-Primary', 'Primary', 'O Level', 'A Level', 'Other'];
  const rows = [
    ['EMIS Report — ' + schoolName()],
    [`Term: ${ct ? ct.year + ' ' + ct.term : 'Not set'} | Generated: ${todayISO()}`], [],
    ['Level', 'Total Enrolment', 'Male', 'Female', 'Boarding', 'Day', 'Weekly', 'SEN', 'Cleared Fees', 'Outstanding (' + currency() + ')'],
  ];
  const addRow = (label, list) => rows.push([label, list.length, list.filter(s => s.gender === 'Male').length, list.filter(s => s.gender === 'Female').length, list.filter(s => s.boardingStatus === 'Boarding').length, list.filter(s => (s.boardingStatus || 'Day') === 'Day').length, list.filter(s => s.boardingStatus === 'Weekly').length, list.filter(s => s.senFlag).length, list.filter(s => studentBalance(s) <= 0).length, list.reduce((a, s) => a + studentBalance(s), 0)]);
  levels.forEach(lvl => addRow(lvl, state.students.filter(s => s.level === lvl)));
  addRow('TOTAL', state.students);
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `EMIS_Report_${termLabel}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast('EMIS report exported.', 'success');
}

/* ── Select / datalist population ──────────────────────────────────────── */
function renderSportFilter() {
  const sel = el('sportFilter'); if (!sel) return;
  const cur = sel.value;
  const sports = Array.from(new Set([...state.programs.map(p => p.sport), ...state.students.map(s => s.sport).filter(Boolean)])).sort();
  sel.innerHTML = '<option value="">All Sports</option>' + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (cur) sel.value = cur;
}
function renderSportOptions() {
  const sel = document.querySelector('#registerForm select[name="sport"]'); if (!sel) return;
  const cur = sel.value;
  const sports = Array.from(new Set([...SPORT_OPTIONS, ...state.programs.map(p => p.sport)])).sort();
  sel.innerHTML = '<option value="">— None —</option>' + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  if (cur) sel.value = cur;
}
function renderStudentSelects() {
  const fill = (id, label) => {
    const sel = el(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Choose a student…</option>' + state.students.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.class)}${label(s)}</option>`).join('');
    if (cur) sel.value = cur;
  };
  fill('perfStudent', s => s.sport ? ' · ' + s.sport : '');
}
/* ── Detail modals ─────────────────────────────────────────────────────── */
function openNotes(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const notes = (s.performanceNotes || []).slice().reverse();
  const att = studentAttendance(s.id);
  openModal({
    title: escapeHtml(s.name) + ' — performance history',
    bodyHtml: `<div class="tile" style="margin-bottom:12px;font-size:13px">
      <div><strong>Sport:</strong> ${escapeHtml(s.sport || '—')}</div>
      <div style="margin-top:4px"><strong>Skill:</strong> ${skillBadge(s.skillLevel)}</div>
      <div style="margin-top:4px"><strong>Attendance:</strong> ${att.rate}% (${att.present}/${att.total})</div>
      <div style="margin-top:4px"><strong>Bursary score:</strong> ${bursaryScore(s)}/100 ${bursaryEligible(s) ? '<span style="color:var(--success);font-weight:700">· Eligible</span>' : ''}</div>
    </div>${notes.length ? notes.map(n => `<div class="tile" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span class="card-desc">${escapeHtml(n.date)}</span>${skillBadge(n.skillLevel)}</div><div style="font-size:13px">${escapeHtml(n.note)}</div></div>`).join('') : '<p class="empty">No evaluations yet.</p>'}`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>`,
  });
}
/* ── Student edit modal ────────────────────────────────────────────────── */
function openStudentEdit(studentId, back) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const opt = (list, val) => list.map(o => `<option ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
  const sports = Array.from(new Set([...SPORT_OPTIONS, ...state.programs.map(p => p.sport), s.sport].filter(Boolean))).sort();
  const sen = ['Visual Impairment', 'Hearing Impairment', 'Physical Disability', 'Learning Difficulty', 'Other'];
  if (s.senFlag && !sen.includes(s.senFlag)) sen.push(s.senFlag);
  openModal({
    title: 'Edit ' + escapeHtml(s.name),
    wide: true,
    bodyHtml: `<p class="card-desc" style="margin:-6px 0 12px">Admission no. ${escapeHtml(s.id)} (it cannot be changed). Change what you need, then press Save changes.</p>
    <form id="editStudentForm" class="form-grid">
      <fieldset class="fs-group"><legend>The child</legend><div class="form-row">
        <div><label class="form-label">Full name *</label><input class="input" name="name" value="${escapeHtml(s.name)}" required></div>
        <div><label class="form-label">Gender</label><select class="input" name="gender"><option value="">—</option>${opt(['Male', 'Female'], s.gender)}</select></div>
        <div><label class="form-label">Special needs</label><select class="input" name="senFlag"><option value="">None</option>${opt(sen, s.senFlag)}</select></div>
      </div></fieldset>
      <fieldset class="fs-group"><legend>Class</legend><div class="form-row">
        <div><label class="form-label">Class</label><select class="input" name="class">${opt(CLASS_OPTIONS, s.class)}</select></div>
        <div><label class="form-label">Stream <span class="opt">(optional)</span></label><input class="input" name="stream" value="${escapeHtml(s.stream || '')}" placeholder="e.g. East"></div>
        <div><label class="form-label">Day or boarding</label><select class="input" name="boardingStatus"><option ${(s.boardingStatus || 'Day') === 'Day' ? 'selected' : ''} value="Day">Day scholar</option><option ${s.boardingStatus === 'Boarding' ? 'selected' : ''} value="Boarding">Boarding</option><option ${s.boardingStatus === 'Weekly' ? 'selected' : ''} value="Weekly">Weekly boarder</option></select></div>
      </div><div class="form-row">
        <div><label class="form-label">Subjects / combination</label><input class="input" name="combination" value="${escapeHtml(s.combination || '')}"></div>
        <div><label class="form-label">UNEB index <span class="opt">(S.4 and S.6)</span></label><input class="input" name="unebIndexNo" value="${escapeHtml(s.unebIndexNo || '')}"></div>
      </div></fieldset>
      <fieldset class="fs-group"><legend>Guardians</legend><div class="form-row">
        <div><label class="form-label">Guardian's phone *</label><input class="input" name="guardian" type="tel" value="${escapeHtml(s.guardian || '')}" required></div>
        <div><label class="form-label">Second guardian's phone <span class="opt">(optional)</span></label><input class="input" name="guardian2" type="tel" value="${escapeHtml(s.guardian2 || '')}"></div>
      </div></fieldset>
      <fieldset class="fs-group"><legend>Fees and sport</legend><div class="form-row">
        <div><label class="form-label">Termly fees (${currency()}) <span class="opt">(used when no fee structure covers the class)</span></label><input class="input" type="number" min="0" step="1000" name="fee" value="${s.fee}"></div>
        <div><label class="form-label">Main sport</label><select class="input" name="sport"><option value="">— None —</option>${opt(sports, s.sport)}</select></div>
        <div><label class="form-label">Skill level</label><select class="input" name="skillLevel"><option value="">—</option>${opt(['Beginner', 'Intermediate', 'Advanced', 'Elite'], s.skillLevel)}</select></div>
      </div></fieldset>
    </form>`,
    footHtml: (back ? `<button class="btn btn-ghost" type="button" data-act="learner" data-id="${escapeHtml(s.id)}" data-section="details">Back to ${escapeHtml(s.name)}</button>` : '<button class="btn btn-ghost" data-modal-close>Cancel</button>')
      + `<button class="btn btn-primary" id="editStudentSave">${icon('save', 15)} Save changes</button>`,
    onOpen(root) {
      root.querySelector('#editStudentSave').addEventListener('click', () => {
        const fd = new FormData(root.querySelector('#editStudentForm'));
        if (!updateStudent(studentId, Object.fromEntries(fd.entries()))) return;   // refused: keep what was typed
        if (back) openLearner(studentId, 'details'); else closeModal();
      });
    },
  });
}

/* ── Competitions & squads ─────────────────────────────────────────────── */
function openCompetitionForm() {
  openModal({
    title: 'Log competition result', wide: true,
    bodyHtml: `<form id="compForm" class="form-grid">
      <div class="form-row"><div><label class="form-label">Date</label><input class="input" type="date" name="date" value="${todayISO()}" required></div>
      <div><label class="form-label">Sport</label><input class="input" name="sport" list="sportList" placeholder="Football" required></div></div>
      <div><label class="form-label">Event / tournament</label><input class="input" name="eventName" placeholder="USSSA Kampala Regional Games 2026" required></div>
      <div class="form-row"><div><label class="form-label">Level</label><select class="input" name="level"><option>Inter-class</option><option>Zonal</option><option>District</option><option>Regional</option><option>USSSA National</option><option>FEASSSA</option><option>Friendly</option></select></div>
      <div><label class="form-label">Opponent</label><input class="input" name="opponent" placeholder="Makerere College School"></div>
      <div><label class="form-label">Venue</label><input class="input" name="venue" placeholder="Lugogo"></div></div>
      <div class="form-row"><div><label class="form-label">Result</label><select class="input" name="result"><option>Win</option><option>Draw</option><option>Loss</option><option>Did not start</option><option>N/A</option></select></div>
      <div><label class="form-label">Score</label><input class="input" name="score" placeholder="3-1 or 1st place"></div>
      <div><label class="form-label">Final position</label><input class="input" name="position" placeholder="Runners-up"></div></div>
      <div><label class="form-label">Coach match report</label><textarea class="input" name="matchReport" rows="3"></textarea></div>
      <div><label class="form-label">Season</label><input class="input" name="season" value="${new Date().getFullYear()}"></div>
    </form>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="compSave">${icon('save', 15)} Save result</button>`,
    onOpen(root) {
      root.querySelector('#compSave').addEventListener('click', () => {
        const fd = Object.fromEntries(new FormData(root.querySelector('#compForm')).entries());
        submitCompetition(fd);
      });
    },
  });
}
function submitCompetition(f) {
  if (!can('canManageCompetitions')) return toast('You do not have permission.', 'error');
  if (!f.eventName || !f.sport) return toast('Event name and sport are required.', 'error');
  state.competitions.push({ id: newId('CMP'), ...f });
  saveState(); renderAll(); closeModal();
  toast('Competition result logged.', 'success');
}
async function deleteCompetition(id) { if (!await confirmDialog({ title: 'Delete record', message: 'Delete this competition record?', confirmLabel: 'Delete', danger: true })) return; state.competitions = state.competitions.filter(c => c.id !== id); saveState(); renderAll(); }
function renderCompetitionsTable() {
  const body = el('competitionsTableBody'); if (!body) return;
  const sportF = (el('compSportFilter') && el('compSportFilter').value || '').toLowerCase();
  const seasonF = el('compSeasonFilter') && el('compSeasonFilter').value || '';
  const sports = [...new Set(state.competitions.map(c => c.sport))].sort();
  const seasons = [...new Set(state.competitions.map(c => c.season))].sort().reverse();
  const csf = el('compSportFilter'); if (csf) { const cur = csf.value; csf.innerHTML = '<option value="">All Sports</option>' + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); csf.value = cur; }
  const cse = el('compSeasonFilter'); if (cse) { const cur = cse.value; cse.innerHTML = '<option value="">All Seasons</option>' + seasons.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); cse.value = cur; }
  const list = state.competitions.filter(c => (!sportF || (c.sport || '').toLowerCase() === sportF) && (!seasonF || c.season === seasonF)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const wins = list.filter(c => c.result === 'Win').length;
  const sum = el('compSummaryRow');
  if (sum) sum.innerHTML = [['Played', list.length, ''], ['Wins', wins, 'is-success'], ['Draws', list.filter(c => c.result === 'Draw').length, 'is-gold'], ['Losses', list.filter(c => c.result === 'Loss').length, 'is-danger'], ['Win rate', list.length ? Math.round(wins / list.length * 100) + '%' : '—', '']].map(([l, v, c]) => `<div class="stat ${c}"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join('');
  const rs = { Win: 'badge-success', Draw: 'badge-warn', Loss: 'badge-danger' };
  body.innerHTML = list.length ? list.map(c => `<tr><td class="t-muted">${escapeHtml(c.date)}</td><td style="font-weight:600">${escapeHtml(c.eventName)}</td><td>${escapeHtml(c.sport)}</td><td><span class="badge badge-info">${escapeHtml(c.level)}</span></td><td>${escapeHtml(c.opponent || '—')}</td><td>${escapeHtml(c.venue || '—')}</td><td><span class="badge ${rs[c.result] || 'badge-neutral'}">${escapeHtml(c.result)}</span></td><td class="mono" style="font-weight:700">${escapeHtml(c.score || '—')}</td><td style="font-weight:600;color:var(--brand)">${escapeHtml(c.position || '—')}</td><td><div class="row-actions">${c.matchReport ? `<button class="btn btn-outline btn-xs" data-act="matchReport" data-id="${escapeHtml(c.id)}">Report</button>` : ''}${can('canManageCompetitions') ? `<button class="btn-icon" data-act="deleteCompetition" data-id="${escapeHtml(c.id)}" title="Delete">${icon('trash', 15)}</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="10" class="empty">No competitions logged yet.</td></tr>';
}
function viewMatchReport(id) {
  const c = state.competitions.find(x => x.id === id); if (!c) return;
  openModal({ title: escapeHtml(c.eventName), bodyHtml: `<div class="tile" style="margin-bottom:12px;font-size:13px"><div><strong>Date:</strong> ${escapeHtml(c.date)} · <strong>Venue:</strong> ${escapeHtml(c.venue || '—')}</div><div><strong>Opponent:</strong> ${escapeHtml(c.opponent || '—')} · <strong>Score:</strong> ${escapeHtml(c.score || '—')}</div><div><strong>Result:</strong> ${escapeHtml(c.result)} · <strong>Position:</strong> ${escapeHtml(c.position || '—')}</div></div><p style="font-size:13px;line-height:1.6;white-space:pre-wrap">${escapeHtml(c.matchReport)}</p>`, footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>` });
}
function openSquadForm() {
  const athletes = state.students.filter(s => s.sport);
  openModal({
    title: 'Create squad', wide: true,
    bodyHtml: `<form id="squadForm" class="form-grid">
      <div class="form-row"><div><label class="form-label">Squad name</label><input class="input" name="name" placeholder="First XI Football" required></div><div><label class="form-label">Sport</label><input class="input" name="sport" list="sportList" required></div></div>
      <div><label class="form-label">Members</label><div class="scroll-box" style="padding:8px">${athletes.length ? athletes.map(s => `<label class="check" style="display:flex;padding:4px 0"><input type="checkbox" name="members" value="${escapeHtml(s.id)}"> ${escapeHtml(s.name)} — ${escapeHtml(s.class)} · ${escapeHtml(s.sport)}</label>`).join('') : '<p class="card-desc">No athletes registered yet.</p>'}</div></div>
    </form>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="squadSave">${icon('save', 15)} Save squad</button>`,
    onOpen(root) {
      root.querySelector('#squadSave').addEventListener('click', () => {
        const form = root.querySelector('#squadForm');
        const name = form.name.value.trim(), sport = form.sport.value.trim();
        const members = [...form.querySelectorAll('[name="members"]:checked')].map(c => c.value);
        if (!name || !sport) return toast('Name and sport are required.', 'error');
        if (!members.length) return toast('Select at least one member.', 'error');
        state.squads.push({ id: newId('SQD'), name, sport, members, createdAt: todayISO() });
        saveState(); renderAll(); closeModal(); toast('Squad created.', 'success');
      });
    },
  });
}
async function deleteSquad(id) { if (!await confirmDialog({ title: 'Delete squad', message: 'Delete this squad?', confirmLabel: 'Delete', danger: true })) return; state.squads = state.squads.filter(s => s.id !== id); saveState(); renderAll(); }
function renderSquadsGrid() {
  const grid = el('squadsGrid'); if (!grid) return;
  grid.innerHTML = state.squads.length ? state.squads.map(sq => {
    const members = (sq.members || []).map(id => state.students.find(s => s.id === id)).filter(Boolean);
    const del = can('canManageSquads') ? `<button class="btn-icon" data-act="deleteSquad" data-id="${escapeHtml(sq.id)}" title="Delete">${icon('trash', 15)}</button>` : '';
    return `<div class="tile"><div style="display:flex;justify-content:space-between"><div><div style="font-weight:700">${escapeHtml(sq.name)}</div><div class="card-desc">${escapeHtml(sq.sport)} · ${members.length} members</div></div>${del}</div><div class="pill-list" style="margin-top:9px">${members.map(s => `<span class="badge badge-info">${escapeHtml(s.name)}</span>`).join('')}</div></div>`;
  }).join('') : '<div class="empty">No squads created yet.</div>';
}
function openAthleteProfile(studentId) {
  if (!can('canLogPerformance')) return toast('You do not have permission.', 'error');
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const p = s.athleteProfile || {};
  const opt = (v, sel) => `<option ${v === sel ? 'selected' : ''}>${v}</option>`;
  openModal({
    title: escapeHtml(s.name) + ' — athlete profile', wide: true,
    bodyHtml: `<form id="profForm" class="form-grid">
      <div class="form-row"><div><label class="form-label">Position / event</label><input class="input" name="position" value="${escapeHtml(p.position || '')}"></div><div><label class="form-label">Height (cm)</label><input class="input" type="number" name="height" value="${escapeHtml(p.height || '')}"></div><div><label class="form-label">Weight (kg)</label><input class="input" type="number" name="weight" value="${escapeHtml(p.weight || '')}"></div></div>
      <div><label class="form-label">Personal best</label><input class="input" name="personalBest" value="${escapeHtml(p.personalBest || '')}"></div>
      <div class="form-row"><div><label class="form-label">Injury status</label><select class="input" name="injuryStatus">${['Fit', 'Minor Knock', 'Injured', 'Recovering'].map(v => opt(v, p.injuryStatus || 'Fit')).join('')}</select></div><div><label class="form-label">Injury detail</label><input class="input" name="injuryDetail" value="${escapeHtml(p.injuryDetail || '')}"></div></div>
    </form>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="profSave">${icon('save', 15)} Save profile</button>`,
    onOpen(root) {
      root.querySelector('#profSave').addEventListener('click', () => {
        const fd = Object.fromEntries(new FormData(root.querySelector('#profForm')).entries());
        s.athleteProfile = fd; saveState(); renderAll(); closeModal(); toast('Athlete profile saved.', 'success');
      });
    },
  });
}
function renderAthleteProfiles() {
  const body = el('athleteProfilesBody'); if (!body) return;
  const apf = el('athleteProfileFilter');
  const filter = (apf && apf.value || '').toLowerCase();
  if (apf) { const sports = [...new Set(state.students.filter(s => s.sport).map(s => s.sport))].sort(); const cur = apf.value; apf.innerHTML = '<option value="">All Sports</option>' + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join(''); apf.value = cur; }
  const athletes = state.students.filter(s => s.sport && (!filter || (s.sport || '').toLowerCase() === filter));
  const ic = { Fit: 'badge-success', 'Minor Knock': 'badge-warn', Injured: 'badge-danger', Recovering: 'badge-warn' };
  body.innerHTML = athletes.length ? athletes.map(s => { const p = s.athleteProfile || {}; const inj = p.injuryStatus || 'Fit'; return `<tr><td style="font-weight:600">${learnerLink(s.id, s.name)}</td><td>${escapeHtml(s.class)}</td><td>${escapeHtml(s.sport)}</td><td>${escapeHtml(p.position || '—')}</td><td>${p.height ? escapeHtml(p.height) + 'cm' : '—'}</td><td>${p.weight ? escapeHtml(p.weight) + 'kg' : '—'}</td><td style="color:var(--brand);font-weight:600">${escapeHtml(p.personalBest || '—')}</td><td><span class="badge ${ic[inj] || 'badge-neutral'}">${escapeHtml(inj)}</span></td><td>${can('canLogPerformance') ? `<button class="btn btn-outline btn-xs" data-act="athleteProfile" data-id="${escapeHtml(s.id)}">Edit details</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="9" class="empty">No athlete profiles.</td></tr>';
}

/* ── Notices ───────────────────────────────────────────────────────────── */
const NOTICES_KEPT = 200;
/* Who may change a notice: the director, the administrator, or whoever posted it. */
function canChangeNotice(n) {
  if (!can('canPostNotice') || !currentSession) return false;
  if (['exec', 'admin'].includes(currentSession.role)) return true;
  return n.postedById ? n.postedById === currentSession.userId : n.postedBy === currentSession.displayName;
}
function postNotice(f) {
  if (!can('canPostNotice')) { toast('You do not have permission.', 'error'); return false; }
  if (!f.title || !f.title.trim()) { toast('Give the notice a title.', 'error'); return false; }
  // Online, a notice can also be shown to parents in their portal.
  const audience = ONLINE_EDITION && f.audience === 'all' ? 'all' : 'staff';
  const notice = { id: newId('NTC'), title: f.title.trim(), body: (f.body || '').trim(), category: f.category || 'General', postedBy: currentSession.displayName, postedById: currentSession.userId, postedAt: nowISO(), audience };
  state.notices.unshift(notice);
  if (state.notices.length > NOTICES_KEPT) state.notices = state.notices.slice(0, NOTICES_KEPT);
  saveState(); renderAll();
  AUTH.audit('NOTICE_POST', `${notice.title}${audience === 'all' ? ' · staff and parents' : ''}`);
  toast('Notice posted.', 'success');
  if (ONLINE_EDITION && f.sms && can('canBroadcastSms')) {
    const text = (notice.title + (notice.body ? ': ' + notice.body : '')).slice(0, 380);
    SMS.openRun('broadcast', { message: text }, 'Send this notice by SMS');
  }
  return true;
}
async function deleteNotice(id) {
  const n = state.notices.find(x => x.id === id); if (!n) return;
  if (!canChangeNotice(n)) return toast('Only the person who posted this notice, the director or the administrator can delete it.', 'error');
  if (!await confirmDialog({ title: 'Delete a notice', message: `Delete the notice "${n.title}"${n.postedBy ? ` posted by ${n.postedBy}` : ''}? Nobody will see it again${ONLINE_EDITION && n.audience === 'all' ? ', parents included' : ''}.`, confirmLabel: 'Delete notice', danger: true })) return;
  state.notices = state.notices.filter(x => x.id !== id);
  saveState(); renderAll();
  AUTH.audit('NOTICE_DELETE', n.title);
  toast('Notice deleted.', 'success');
}
/* Edit the words, the kind and (online) who sees it. It is never sent by SMS again. */
function editNotice(id) {
  const n = state.notices.find(x => x.id === id); if (!n) return;
  if (!canChangeNotice(n)) return toast('Only the person who posted this notice, the director or the administrator can change it.', 'error');
  const cats = ['General', 'Academic', 'Finance', 'Sports', 'Discipline', 'Urgent'];
  openModal({
    title: 'Edit notice',
    bodyHtml: `<form id="noticeEditForm" class="form-grid">
      <div><label class="form-label" for="neTitle">Title *</label><input class="input" id="neTitle" name="title" required value="${escapeHtml(n.title)}"></div>
      <div class="form-row">
        <div><label class="form-label" for="neCategory">Kind of notice</label><select class="input" id="neCategory" name="category">${cats.map(c => `<option${c === n.category ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
        ${ONLINE_EDITION ? `<div><label class="form-label" for="neAudience">Who can see this</label><select class="input" id="neAudience" name="audience"><option value="staff"${n.audience !== 'all' ? ' selected' : ''}>Staff only</option><option value="all"${n.audience === 'all' ? ' selected' : ''}>Staff and parents</option></select></div>` : ''}
      </div>
      <div><label class="form-label" for="neBody">Details</label><textarea class="input" id="neBody" name="body" rows="4">${escapeHtml(n.body || '')}</textarea></div>
      <p class="card-desc" style="margin:0">Saving changes the notice on the board. It is not sent by SMS again.</p>
    </form>`,
    footHtml: '<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="neSave">Save notice</button>',
    onOpen(root) {
      root.querySelector('#neSave').addEventListener('click', () => {
        const f = Object.fromEntries(new FormData(root.querySelector('#noticeEditForm')).entries());
        if (!(f.title || '').trim()) return toast('Give the notice a title.', 'error');
        n.title = f.title.trim(); n.body = (f.body || '').trim(); n.category = f.category || 'General';
        if (ONLINE_EDITION) n.audience = f.audience === 'all' ? 'all' : 'staff';
        closeModal(); saveState(); renderAll();
        AUTH.audit('NOTICE_EDIT', n.title);
        toast('Notice saved.', 'success');
      });
    },
  });
}
function renderNotices() {
  const grid = el('noticesGrid'); if (!grid) return;
  const formCard = el('noticeFormCard');
  if (formCard) formCard.style.display = can('canPostNotice') ? '' : 'none';
  const note = el('noticesNote');
  if (note) note.textContent = ONLINE_EDITION
    ? 'Staff see every notice. Parents see only the notices marked "Staff and parents", in the parent portal.'
    : 'Notices are seen by everyone who signs in to this app on this device.';
  const cat = (el('noticeFilter') || {}).value || '';
  const list = state.notices.filter(n => !cat || n.category === cat);
  grid.innerHTML = list.length ? list.map(n => {
    const mine = canChangeNotice(n);
    return `<div class="notice-item cat-${escapeHtml(n.category)}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span class="badge badge-neutral">${escapeHtml(n.category)}</span><span class="card-desc">${n.postedAt ? escapeHtml(fmtDay(n.postedAt.slice(0, 10))) : ''}</span>${ONLINE_EDITION && n.audience === 'all' ? '<span class="badge badge-info">Parents can see this</span>' : ''}</div>
      <div style="font-weight:700">${escapeHtml(n.title)}</div>${n.body ? `<div class="card-desc" style="white-space:pre-wrap;margin-top:4px">${escapeHtml(n.body)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px"><span class="card-desc">Posted by ${escapeHtml(n.postedBy || '—')}</span>
        ${mine ? `<div class="row-actions"><button class="btn btn-outline btn-xs" type="button" data-act="editNotice" data-id="${escapeHtml(n.id)}">Edit</button><button class="btn btn-ghost btn-xs t-bad" type="button" data-act="deleteNotice" data-id="${escapeHtml(n.id)}" aria-label="Delete the notice ${escapeHtml(n.title)}">Delete</button></div>` : ''}</div>
    </div>`;
  }).join('') : `<div class="empty">${state.notices.length ? 'No notices of this kind.' : 'No notices posted yet.'}</div>`;
}

/* ── User management & audit ───────────────────────────────────────────── */
function renderUsersList() {
  const box = el('usersList'); if (!box) return;
  const users = AUTH.getUsers();
  const colors = { exec: '#0b5d3b', admin: '#1d4ed8', bursary: '#15803d', coach: '#b45309', teacher: '#0e7490' };
  const labels = { exec: 'Executive', admin: 'Administrator', bursary: 'Bursary', coach: 'Sports', teacher: 'Teacher' };
  if (ONLINE_EDITION) {
    box.innerHTML = users.length ? users.map(u => `<div class="user-card"><div class="avatar" style="background:${colors[u.role] || '#64748b'}">${escapeHtml((u.displayName || '?').slice(0, 2).toUpperCase())}</div><div style="flex:1;min-width:0"><div style="font-weight:700">${escapeHtml(u.displayName)}</div><div class="card-desc">${escapeHtml(u.username)} · <span style="color:${colors[u.role] || '#64748b'};font-weight:600">${labels[u.role] || escapeHtml(u.role)}</span></div>${u.role === 'teacher' ? `<div class="card-desc">Classes: ${escapeHtml((u.assignedClasses || []).join(', ') || 'none yet')}</div>` : ''}</div><div class="row-actions">${u.pending ? '<span class="badge badge-warn">Invited — not joined yet</span>' : (u.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Access off</span>')}<button class="btn btn-outline btn-xs" data-act="editUser" data-id="${escapeHtml(u.id)}">Edit</button>${u.pending ? '' : `<button class="btn btn-outline btn-xs" data-act="resetUserPwd" data-id="${escapeHtml(u.id)}">Send reset link</button>`}${u.id !== currentSession.userId ? `<button class="btn btn-danger btn-xs" data-act="deleteUser" data-id="${escapeHtml(u.id)}">${u.pending ? 'Cancel invitation' : 'Remove'}</button>` : '<span class="card-desc">(you)</span>'}</div></div>`).join('') : '<p class="card-desc">No staff yet. Add someone below.</p>';
    return;
  }
  box.innerHTML = users.length ? users.map(u => `<div class="user-card"><div class="avatar" style="background:${colors[u.role] || '#64748b'}">${escapeHtml((u.displayName || '?').slice(0, 2).toUpperCase())}</div><div style="flex:1;min-width:0"><div style="font-weight:700">${escapeHtml(u.displayName)}</div><div class="card-desc">@${escapeHtml(u.username)} · <span style="color:${colors[u.role] || '#64748b'};font-weight:600">${labels[u.role] || u.role}</span></div><div class="card-desc">Last sign-in: ${u.lastLogin ? u.lastLogin.slice(0, 16).replace('T', ' ') : 'Never'}${u.role === 'teacher' ? ' · Classes: ' + escapeHtml((u.assignedClasses || []).join(', ') || 'none yet') : ''}</div></div><div class="row-actions">${u.mustChangePassword ? '<span class="badge badge-warn">Password reset</span>' : '<span class="badge badge-success">Active</span>'}<button class="btn btn-outline btn-xs" data-act="editUser" data-id="${escapeHtml(u.id)}">Edit</button><button class="btn btn-outline btn-xs" data-act="resetUserPwd" data-id="${escapeHtml(u.id)}">Reset password</button>${u.id !== currentSession.userId ? `<button class="btn btn-danger btn-xs" data-act="deleteUser" data-id="${escapeHtml(u.id)}">Delete</button>` : '<span class="card-desc">(you)</span>'}</div></div>`).join('') : '<p class="card-desc">No user accounts found.</p>';
}
function loadUserForEdit(userId) {
  const u = AUTH.getUsers().find(x => x.id === userId); if (!u) return;
  el('editUserId').value = u.id; el('editUsername').value = u.username; el('editDisplayName').value = u.displayName; el('editRole').value = u.role; el('editPassword').value = '';
  if (ONLINE_EDITION) el('editUsername').readOnly = true;   // an account's email cannot be changed here
  document.querySelectorAll('#editAssignedClasses input').forEach(cb => { cb.checked = (u.assignedClasses || []).includes(cb.value); });
  toggleAssignedClasses();
  el('userEditForm').closest('details').open = true;
  el('editUsername').focus();
}
function clearUserEditForm() {
  ['editUserId', 'editUsername', 'editDisplayName', 'editPassword'].forEach(id => el(id).value = '');
  el('editUsername').readOnly = false;
  el('editRole').value = 'admin';
  document.querySelectorAll('#editAssignedClasses input').forEach(cb => { cb.checked = false; });
  toggleAssignedClasses();
}
/* Teachers are limited to the classes ticked here. */
function renderAssignedClassOptions() {
  const box = el('editAssignedClasses'); if (!box || box.dataset.ready) return;
  box.dataset.ready = '1';
  box.innerHTML = CLASS_OPTIONS.map(c => `<label class="check"><input type="checkbox" value="${escapeHtml(c)}"> ${escapeHtml(c)}</label>`).join('');
}
function toggleAssignedClasses() {
  renderAssignedClassOptions();
  const wrap = el('assignedClassesWrap');
  if (wrap) wrap.style.display = el('editRole').value === 'teacher' ? '' : 'none';
}
async function handleUserEditSubmit(e) {
  e.preventDefault();
  const id = el('editUserId').value;
  const username = el('editUsername').value.trim();
  const displayName = el('editDisplayName').value.trim();
  const role = el('editRole').value;
  const password = el('editPassword').value;
  if (!username || !displayName) return toast(ONLINE_EDITION ? 'Email address and name are required.' : 'Username and display name are required.', 'error');
  const data = { username, displayName, role };
  data.assignedClasses = role === 'teacher' ? [...document.querySelectorAll('#editAssignedClasses input:checked')].map(cb => cb.value) : [];
  if (role === 'teacher' && !data.assignedClasses.length) return toast('Tick at least one class for this teacher.', 'error');
  if (id) data.id = id;
  if (password) {
    const check = AUTH.validatePasswordStrength(password);
    if (!check.ok) return toast(check.error, 'error');
    const h = await AUTH.hashPassword(password);
    data.salt = h.salt; data.passwordHash = h.hash; data.iterations = h.iterations; data.mustChangePassword = false;
  }
  const res = await AUTH.upsertUser(data);
  if (!res.ok) return toast(res.error, 'error');
  if (ONLINE_EDITION && res.invited) toast(`${displayName} is invited. Ask them to open the portal, choose "First time here?" and use ${username}.`, 'success');
  else toast(id ? 'User updated.' : 'User created.', 'success');
  clearUserEditForm(); renderUsersList(); renderAuditLog();
}
async function resetUserPwd(userId) {
  const u = AUTH.getUsers().find(x => x.id === userId); if (!u) return;
  if (ONLINE_EDITION) {
    if (!await confirmDialog({ title: 'Send a password-reset link', message: `Email a link to ${u.username} so ${u.displayName} can choose a new password?`, confirmLabel: 'Send link' })) return;
    const sent = await AUTH.adminResetPassword(userId);
    if (!sent.ok) return toast(sent.error, 'error');
    renderAuditLog();
    return toast(`Reset link sent to ${u.username}.`, 'success');
  }
  const pwd = await promptDialog({ title: 'Reset password', label: `Temporary password for ${u.displayName} (min 8 chars, letters + numbers)`, type: 'text' });
  if (!pwd) return;
  const res = await AUTH.adminResetPassword(userId, pwd);
  if (!res.ok) return toast(res.error, 'error');
  toast('Password reset. The user must change it at next sign-in.', 'success');
  renderUsersList(); renderAuditLog();
}
async function confirmDeleteUser(userId) {
  const u = AUTH.getUsers().find(x => x.id === userId); if (!u) return;
  const msg = ONLINE_EDITION
    ? (u.pending ? `Cancel the invitation for ${u.displayName}?` : `Remove ${u.displayName} from the school? They will no longer be able to sign in to it.`)
    : `Delete the account for ${u.displayName}? This cannot be undone.`;
  if (!await confirmDialog({ title: ONLINE_EDITION ? 'Remove staff member' : 'Delete account', message: msg, confirmLabel: ONLINE_EDITION ? (u.pending ? 'Cancel invitation' : 'Remove') : 'Delete account', danger: true })) return;
  const res = await AUTH.deleteUser(userId);
  if (!res.ok) return toast(res.error, 'error');
  toast(ONLINE_EDITION ? 'Done.' : 'Account deleted.', 'success'); renderUsersList(); renderAuditLog();
}
function renderAuditLog() {
  const box = el('auditLogBody'); if (!box) return;
  const log = AUTH.getAuditLog().slice(0, 60);
  box.innerHTML = log.length ? log.map(e => `<div class="audit-row"><span class="audit-ts">${e.ts.slice(0, 16).replace('T', ' ')}</span><span class="audit-user">${escapeHtml(e.username)}</span><span class="audit-tag">${escapeHtml(e.action)}</span><span class="card-desc">${escapeHtml(e.detail)}</span></div>`).join('') : '<p class="card-desc">No events logged yet.</p>';
}

/* ── Settings (white-label) ────────────────────────────────────────────── */
function renderSettingsForm() {
  const st = state.settings;
  const set = (id, v) => { const e = el(id); if (e) e.value = v || ''; };
  set('setSchoolName', st.schoolName); set('setMotto', st.motto); set('setAddress', st.address);
  set('setPoBox', st.poBox); set('setPhone', st.phone); set('setEmail', st.email); set('setHead', st.headTeacher);
  if (el('setGrading')) el('setGrading').value = st.gradingMode;
  if (el('setCurrency')) el('setCurrency').value = st.currency;
}
function saveSettings(f) {
  if (!can('canManageSettings')) return toast('You do not have permission.', 'error');
  state.settings = Object.assign({}, state.settings, {
    schoolName: (f.schoolName || '').trim() || 'School Portal',
    motto: (f.motto || '').trim(), address: (f.address || '').trim(),
    poBox: (f.poBox || '').trim(), phone: (f.phone || '').trim(), email: (f.email || '').trim(),
    headTeacher: (f.headTeacher || '').trim(), gradingMode: f.gradingMode || 'legacy', currency: (f.currency || 'UGX').trim(),
    brandPreset: f.brandPreset || state.settings.brandPreset || 'green',
  });
  recomputeGrades();
  saveState(); applySettings(); renderAll();
  AUTH.audit('SETTINGS_UPDATE', state.settings.schoolName);
  toast('School settings saved.', 'success');
}
function applySettings() {
  const name = schoolName();
  document.title = name + ' — Management Portal';
  document.querySelectorAll('[data-school-name]').forEach(e => e.textContent = name);
  document.querySelectorAll('[data-school-motto]').forEach(e => e.textContent = state.settings.motto || 'Management Portal');
  document.querySelectorAll('[data-currency]').forEach(e => e.textContent = currency());
}

/* =========================================================================
   Navigation
   ========================================================================= */
/* Ten modules. The ids are historical ("register" is Attendance, "payments" is
   Fees, "conduct" is Discipline); only what people read changed. */
const TAB_LABELS = {
  overview: 'Dashboard', directory: 'Students', register: 'Attendance', academics: 'Academics', payments: 'Fees',
  sports: 'Sports', conduct: 'Discipline', reports: 'Reports', noticeboard: 'Notices', admin: 'Administration',
};
/* Sub-tabs inside a module: [id, label, permission needed]. Cards in
   index.html carry data-sub="<id>"; anything without data-sub always shows. */
const SUB_TABS = {
  directory: [['list', 'All students'], ['admit', 'Admit a student', 'canRegisterStudent'], ['import', 'Import from Excel', 'canRegisterStudent']],
  register: [['daily', 'Take register'], ['recent', 'Who was absent'], ['sheet', 'Term sheet']],
  academics: [['marks', 'Enter marks', 'canAddAcademic'], ['results', 'Class results'], ['comments', 'Comments', 'canAddAcademic'], ['reportcards', 'Report cards'], ['grading', 'Grading scales', 'canManageSettings']],
  payments: [['record', 'Record payment'], ['dashboard', 'Fees dashboard'], ['terms', 'Terms & fee structures', 'canManageTerms'], ['bursaries', 'Bursaries', 'canAwardBursary']],
  sports: [['programmes', 'Programmes'], ['training', 'Training attendance'], ['competitions', 'Competitions & squads'], ['athletes', 'Athletes'], ['candidates', 'Bursary candidates']],
  reports: [['statistics', 'Statistics'], ['emis', 'EMIS', 'canViewEMIS']],
  admin: [['staff', 'Staff accounts', 'canManageUsers'], ['profile', 'School profile & logo', 'canManageSettings'], ['sms', 'SMS', 'canViewSmsLog', 'online'], ['data', 'Data & backup']],
};
let currentTab = null;
const lastSub = {};
/* A fourth entry 'online' marks a sub-tab that exists only in the online edition. */
function allowedSubs(tab) { return (SUB_TABS[tab] || []).filter(([, , perm, edition]) => (!perm || can(perm)) && (edition !== 'online' || ONLINE_EDITION)); }
/* The phone menu: every module, and the account buttons, in words. */
function openMenu() {
  const tabs = [...document.querySelectorAll('#navBar .nav-tab')].map(b => b.dataset.tab);
  const acts = [['exportBtn', 'Back up now'], ['importLabel', 'Restore from a backup'], ['changePwdBtn', 'Change my password'], ['logoutBtn', 'Sign out']]
    .filter(([id]) => el(id) && el(id).style.display !== 'none');
  const who = currentSession ? `${currentSession.displayName} · ${(ROLE_PERMISSIONS[currentSession.role] || {}).label || currentSession.role}` : '';
  openModal({
    title: 'Menu',
    bodyHtml: `<div class="menu-grid">${tabs.map(t => `<button type="button" class="menu-item" data-act="menuGo" data-tab="${escapeHtml(t)}"${t === currentTab ? ' aria-current="page"' : ''}>${icon(t, 20)}<span>${escapeHtml(TAB_LABELS[t] || t)}</span></button>`).join('')}</div>
      <div class="menu-acts">${acts.map(([id, label]) => `<button type="button" class="btn btn-outline btn-block" data-act="menuDo" data-target="${id}">${escapeHtml(label)}</button>`).join('')}</div>
      ${who ? `<p class="card-desc" style="margin-top:12px">Signed in as ${escapeHtml(who)}</p>` : ''}`,
    footHtml: '<button class="btn btn-ghost" data-modal-close>Close</button>',
  });
}
function buildNav(tabs) {
  const nav = el('navBar');
  nav.innerHTML = tabs.map(t => `<button class="nav-tab" data-tab="${t}">${icon(t, 16)}<span>${TAB_LABELS[t] || t}</span></button>`).join('');
}
function switchTab(tab, sub) {
  if (!hasTab(tab)) { toast('You do not have access to that section.', 'error'); return; }
  currentTab = tab;
  const mod = el('currentModule'); if (mod) mod.textContent = TAB_LABELS[tab] || '';
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = el('panel-' + tab);
  if (panel) panel.classList.add('active');
  showSub(tab, sub);
  // On a narrow screen the strip scrolls: keep the open module in view.
  const active = document.querySelector(`.nav-tab[data-tab="${tab}"]`);
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // The KPI strip belongs on each role's home module; elsewhere it is clutter.
  const metrics = el('metricsRow');
  if (metrics) metrics.classList.toggle('hidden', tab !== AUTH.getDefaultTab());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
/* Show one sub-tab of a module: the one asked for, else the last one used,
   else the first this role may use. Hiding uses a class, so it never fights
   the role checks in initApp, which set style.display. */
function showSub(tab, sub) {
  const subs = allowedSubs(tab);
  const ids = subs.map(s => s[0]);
  const chosen = ids.includes(sub) ? sub : ids.includes(lastSub[tab]) ? lastSub[tab] : ids[0];
  if (chosen) lastSub[tab] = chosen;
  const nav = el('subNav');
  if (nav) {
    nav.classList.toggle('hidden', subs.length < 2);
    nav.innerHTML = subs.map(([id, label]) => `<button type="button" role="tab" data-sub="${id}" aria-selected="${id === chosen}">${escapeHtml(label)}</button>`).join('');
  }
  const panel = el('panel-' + tab);
  if (panel && SUB_TABS[tab]) panel.querySelectorAll('[data-sub]').forEach(c => c.classList.toggle('hidden', c.dataset.sub !== chosen));
  // Feature files can load what a sub-tab shows when it opens (e.g. the SMS log).
  MODULES.forEach(m => { if (m.onSub) { try { m.onSub(tab, chosen); } catch (err) { console.error(err); } } });
}

/* ── Today's jobs (dashboard) ──────────────────────────────────────────── */
/* The everyday tasks this person can do, one tap each:
   [where it goes ('module/sub-tab' or 'act:action'), label, hint, allowed?] */
const TODAYS_JOBS = [
  ['register/daily', "Take today's register", 'Tap the children who are not here', () => can('canMarkRegister')],
  ['act:absentToday', 'Who is absent today', 'Their names, class by class', () => hasTab('register')],
  ['academics/marks', 'Enter marks', 'A whole class, one subject at a time', () => can('canAddAcademic')],
  ['academics/reportcards', 'Report cards', 'View or print, one child or the class', () => hasTab('academics')],
  ['payments/record', 'Record a payment', 'The receipt prints straight away', () => can('canRecordPayment')],
  ['payments/dashboard', 'Who owes fees', 'Balances, defaulters and reminders', () => hasTab('payments')],
  ['sports/training', 'Mark training', 'Who came and who missed', () => can('canMarkAttendance')],
  ['directory/admit', 'Admit a student', 'Name, class and guardian numbers', () => can('canRegisterStudent')],
];
function renderTodaysJobs() {
  const card = el('jobsCard'), list = el('jobsList');
  if (!card || !list) return;
  const jobs = TODAYS_JOBS.filter(([to, , , ok]) => {
    if (!ok()) return false;
    if (to.startsWith('act:')) return true;
    const [tab, sub] = to.split('/');
    return hasTab(tab) && allowedSubs(tab).some(x => x[0] === sub);
  });
  card.style.display = jobs.length ? '' : 'none';
  list.innerHTML = jobs.map(([to, label, hint]) => {
    const go = to.startsWith('act:') ? `data-act="${escapeHtml(to.slice(4))}"` : `data-act="goto" data-to="${escapeHtml(to)}"`;
    return `<button class="job" type="button" ${go}><span class="job-label">${escapeHtml(label)}</span><span class="job-hint">${escapeHtml(hint)}</span></button>`;
  }).join('');
}

/* =========================================================================
   Event delegation — all data-act clicks route through here
   ========================================================================= */
Object.assign(ACTIONS, {
  reportCard: d => openReportCard(d.id),
  feeReceipt: d => printFeeReceipt(d.id),
  smsBalance: d => smsBalance(d.id),
  waBalance: d => whatsappBalance(d.id),
  smsConduct: d => sendConduct(d.id, d.to || '1'),
  waConduct: d => sendConduct(d.id, d.to || '1', true),
  conductAnother: () => { const b = el('conductDone'); if (b) b.style.display = 'none'; const sel = el('conductStudent'); if (sel) sel.focus(); },
  editNotice: d => editNotice(d.id),
  editStudent: d => openStudentEdit(d.id, d.back === '1'),
  dirShowOwe: () => { el('dirShow').value = 'owe'; studentPage = 1; renderStudentTable(); },
  admitAnother: () => { el('admitDone').style.display = 'none'; const n = document.querySelector('#registerForm input[name="name"]'); if (n) n.focus(); },
  deleteStudent: d => deleteStudent(d.id),
  notes: d => openNotes(d.id),
  voidPayment: async d => {
    const p = state.payments.find(x => x.id === d.id); if (!p || p.void) return;
    const s = state.students.find(x => x.id === p.studentId);
    const who = s ? s.name : p.studentId;
    const r = await promptDialog({
      title: 'Reverse a payment',
      message: `Reverse ${fmtMoney(p.amount)} paid for ${who} on ${fmtDay(p.date)} (receipt no. ${p.id})? The receipt stops being valid and the amount goes back onto what ${who} owes. The payment stays in the list, crossed out, with your reason.`,
      label: 'Why is it being reversed?', okLabel: 'Reverse payment', danger: true,
    });
    if (r !== null) voidPayment(d.id, r);
  },
  deleteProgram: d => deleteProgram(d.id),
  programAthletes: d => openProgramAthletes(d.id),
  menuGo: d => { closeModal(); switchTab(d.tab); },
  menuDo: d => { closeModal(); if (d.target === 'importLabel') el('importInput').click(); else if (el(d.target)) el(d.target).click(); },
  // From Sessions: open that session on the list above, ready to change.
  openSession: d => {
    switchTab('sports', 'training');
    el('attendanceProgram').value = d.id;
    el('attendanceDate').value = d.date;
    renderAttendanceRoster();
  },
  deleteConduct: d => deleteConduct(d.id),
  setBursary: d => setBursary(d.id),
  setActiveTerm: d => setActiveTerm(d.id),
  deleteTerm: d => deleteTerm(d.id),
  matchReport: d => viewMatchReport(d.id),
  deleteCompetition: d => deleteCompetition(d.id),
  deleteSquad: d => deleteSquad(d.id),
  athleteProfile: d => openAthleteProfile(d.id),
  deleteNotice: d => deleteNotice(d.id),
  editUser: d => loadUserForEdit(d.id),
  resetUserPwd: d => resetUserPwd(d.id),
  deleteUser: d => confirmDeleteUser(d.id),
  studentPage: d => { studentPage = d.page === 'next' ? studentPage + 1 : Math.max(1, studentPage - 1); renderStudentTable(); },
  goto: d => { const [tab, sub] = String(d.to || '').split('/'); switchTab(tab, sub); },
});
function handleDelegatedClick(e) {
  const modalClose = e.target.closest('[data-modal-close]');
  if (modalClose) { closeModal(); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl && ACTIONS[actEl.dataset.act]) { e.preventDefault(); ACTIONS[actEl.dataset.act](actEl.dataset, actEl); }
}

/* =========================================================================
   Form bindings
   ========================================================================= */
function bind(id, handler) { const e = el(id); if (e) e.addEventListener('submit', ev => { ev.preventDefault(); handler(Object.fromEntries(new FormData(ev.target).entries()), ev.target); }); }
function setupBindings() {
  // initApp runs on every sign-in; bind listeners only once or forms submit twice.
  if (bindingsReady) return;
  bindingsReady = true;
  bind('registerForm', async (f, form) => { const s = await registerStudent(f); if (s) { form.reset(); showAdmitDone(s); } });
  let paying = false;   // one tap, one payment: the button is off until the answer is back
  bind('paymentForm', async (f, form) => {
    if (paying) return;
    paying = true;
    const btn = form.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
    try {
      const r = await recordPayment(f);
      if (!r) return;   // refused: keep what was typed
      const cls = el('payClass').value;
      form.reset();
      el('payClass').value = cls;
      renderPayStudentOptions();
      showPayDone(r);
    } finally { paying = false; if (btn) btn.disabled = false; }
  });
  bind('programForm', (f, form) => { f.days = new FormData(form).getAll('days'); addProgram(f); form.reset(); });
  bind('performanceForm', (f, form) => { logPerformance(f); form.reset(); });
  bind('conductForm', (f, form) => {
    const c = addConduct(f);
    if (!c) return;   // refused: keep what was typed
    const cls = el('conductClass').value;
    form.reset();
    el('conductClass').value = cls;
    renderConductForm();
    showConductDone(c);
  });
  bind('noticeForm', (f, form) => { if (postNotice(f)) form.reset(); });
  bind('settingsForm', (f) => { saveSettings(f); });

  const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
  on('searchInput', 'input', () => { studentPage = 1; renderStudentTable(); });
  ['dirClass', 'dirShow'].forEach(id => on(id, 'change', () => { studentPage = 1; renderStudentTable(); }));
  on('registerForm', 'input', () => { const d = el('admitDone'); if (d) d.style.display = 'none'; });
  on('sportFilter', 'change', renderPerformanceTable);
  ['conductFilter', 'conductClassFilter', 'conductPeriod'].forEach(id => on(id, 'change', renderConductTable));
  on('conductClass', 'change', () => { el('conductStudent').value = ''; renderConductForm(); });
  on('conductForm', 'input', () => { const d = el('conductDone'); if (d) d.style.display = 'none'; });
  on('noticeFilter', 'change', renderNotices);
  on('compSportFilter', 'change', renderCompetitionsTable);
  on('compSeasonFilter', 'change', renderCompetitionsTable);
  on('athleteProfileFilter', 'change', renderAthleteProfiles);
  on('bulkSmsBtn', 'click', openBulkSms);
  on('attendanceProgram', 'change', renderAttendanceRoster);
  on('attendanceDate', 'change', renderAttendanceRoster);
  on('addCompetitionBtn', 'click', openCompetitionForm);
  on('addSquadBtn', 'click', openSquadForm);
  on('exportEmisBtn', 'click', exportEMIS);

  on('saveAttendanceBtn', 'click', () => {
    const programId = el('attendanceProgram').value;
    const date = el('attendanceDate').value || todayISO();
    if (!programId) return toast('Choose a programme first.', 'error');
    if (date > todayISO()) return toast('You cannot mark a session for a future date.', 'error');
    const rows = document.querySelectorAll('#attendanceRoster .reg-row');
    if (!rows.length) return toast('No athletes to mark.', 'error');
    saveAttendance(programId, date, Array.from(rows).map(r => ({ studentId: r.dataset.student, present: r.dataset.status !== 'A' })));
  });
  on('attendanceRoster', 'click', e => {
    const b = e.target.closest('[data-set-att]'); if (!b) return;
    setAttendanceRow(b.closest('.reg-row'), b.dataset.setAtt);
  });
  on('sessProgram', 'change', renderSessionList);

  // Export / import (header + admin)
  ['exportBtn', 'adminExportBtn'].forEach(id => on(id, 'click', exportLedger));
  ['importInput', 'adminImportInput'].forEach(id => on(id, 'change', e => { if (e.target.files[0]) importLedger(e.target.files[0]); e.target.value = ''; }));
  on('resetBtn', 'click', resetAll);

  const uef = el('userEditForm'); if (uef) uef.addEventListener('submit', handleUserEditSubmit);
  on('clearUserBtn', 'click', clearUserEditForm);

  // Class → combination hint
  const cls = el('classSelect'), combo = el('combinationInput');
  if (cls && combo) cls.addEventListener('change', () => {
    const hints = { Primary: 'Math, English, Science, SST, RE', 'O Level': 'Math, English, Physics, Chemistry, Biology…', 'A Level': 'PCM, PCB, HEG, MEG…' };
    combo.placeholder = hints[classifyLevel(cls.value)] || 'Subjects, comma-separated';
  });
  const role = el('editRole');
  if (role) role.addEventListener('change', toggleAssignedClasses);

  MODULES.forEach(m => { if (m.setup) m.setup(); });
}

/* =========================================================================
   Session lifecycle & timer
   ========================================================================= */
let sessionTimer = null;
let lastRefresh = 0;
const SESSION_WARN_SECS = 15 * 60;
function updateSessionBar() {
  const bar = el('sessionBar'); if (!bar) return;
  // Signed out: stop. Treating "no session" as an expiry would sign out the
  // next person who signs in on this device.
  if (!currentSession) { stopSessionTimer(); return; }
  const secs = AUTH.sessionSecondsLeft();
  if (secs <= 0) {
    const expired = currentSession.userId;
    stopSessionTimer();
    toast('Your session has expired. Please sign in again.', 'warn');
    setTimeout(() => {
      // Only end the session that actually expired.
      const now = AUTH.getSession();
      if (!now || now.userId === expired) { AUTH.logout(); location.reload(); }
    }, 1800);
    return;
  }
  if (secs <= SESSION_WARN_SECS) {
    bar.classList.add('visible');
    const m = Math.floor(secs / 60), s = secs % 60;
    el('sessionBarText').textContent = `Session expires in ${m}m ${s < 10 ? '0' + s : s}s`;
    const fill = el('sessionBarFill');
    fill.style.width = Math.round(secs / SESSION_WARN_SECS * 100) + '%';
    fill.className = secs < 300 ? 'danger' : secs < 600 ? 'warn' : '';
  } else bar.classList.remove('visible');
}
function stopSessionTimer() {
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimer = null;
  const bar = el('sessionBar'); if (bar) bar.classList.remove('visible');
}
function startSessionTimer() { if (sessionTimer) clearInterval(sessionTimer); sessionTimer = setInterval(updateSessionBar, 1000); }

function updateBackupBanner() {
  const banner = el('backupBanner'); if (!banner) return;
  if (ONLINE_EDITION) { banner.style.display = 'none'; return; }
  let last = null;
  try { last = localStorage.getItem('ksa_last_backup'); } catch (_) {}
  if (!can('canExport')) { banner.style.display = 'none'; return; }
  const stale = !last || (Date.now() - new Date(last).getTime()) > 7 * 86400000;
  banner.style.display = stale && state.students.length ? 'flex' : 'none';
  if (stale) banner.querySelector('span').textContent = last ? `Last backup: ${last}. Export a fresh backup to stay safe.` : 'No backup yet — export one to protect your data.';
}

/* =========================================================================
   App init & auth flow
   ========================================================================= */
async function handleLogin(e) {
  e.preventDefault();
  const btn = el('loginBtn'), err = el('authError');
  btn.disabled = true; btn.textContent = 'Signing in…'; err.style.display = 'none';
  const res = await AUTH.login(el('loginUsername').value, el('loginPassword').value);
  btn.disabled = false; btn.textContent = 'Sign in';
  if (!res.ok) {
    err.style.display = 'block'; err.textContent = res.error;
    if (res.noSchool && typeof offerNewSchool === 'function') offerNewSchool();
    return;
  }
  currentSession = res.session;
  el('loginPassword').value = '';
  initApp();
}
async function handleLogout() {
  if (!await confirmDialog({ title: 'Sign out', message: 'Sign out of the portal?', confirmLabel: 'Sign out' })) return;
  stopSessionTimer();
  AUTH.logout(); currentSession = null;
  if (ONLINE_EDITION) { state = freshState(); closeModal(); }   // nothing of the school stays on a shared computer
  el('appShell').classList.remove('visible');
  el('authScreen').style.display = 'grid';
}
function openChangePwd(forced) {
  openModal({
    title: 'Change your password',
    bodyHtml: `${forced ? `<div class="banner banner-warn" style="margin-bottom:14px">${icon('lock')} Your account uses a default password. Set a private one to continue.</div>` : ''}
      <div class="field"><label>Current password</label><input class="input" type="password" id="cpCurrent"></div>
      <div class="field"><label>New password <span class="opt">(min 8 chars, letters + numbers)</span></label><input class="input" type="password" id="cpNew"><div class="pwd-meter"><span></span></div><div class="pwd-meter-label" id="pwdMeterLabel"></div></div>
      <div class="field"><label>Confirm new password</label><input class="input" type="password" id="cpConfirm"></div>
      <div id="cpError" class="auth-error" style="display:none"></div>`,
    locked: !!forced,
    footHtml: forced ? `<button class="btn btn-primary btn-block" id="cpSave">Update password</button>` : `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="cpSave">Update password</button>`,
    onOpen(root) {
      // Re-point the strength meter (modal creates the elements).
      root.querySelector('#cpNew').addEventListener('input', e2 => {
        const bar = root.querySelector('.pwd-meter'); const lbl = root.querySelector('#pwdMeterLabel');
        window._pwdMeterEls = { bar, lbl }; checkPwdStrengthInModal(e2.target.value, bar, lbl);
      });
      root.querySelector('#cpSave').addEventListener('click', () => submitChangePassword(root, forced));
    },
  });
}
function checkPwdStrengthInModal(pwd, bar, lbl) {
  let score = 0;
  if (pwd.length >= 8) score++; if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++; if (/[0-9]/.test(pwd)) score++; if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [{ l: '', c: 'transparent', w: '0%' }, { l: 'Very weak', c: '#dc2626', w: '20%' }, { l: 'Weak', c: '#ea580c', w: '40%' }, { l: 'Fair', c: '#d97706', w: '60%' }, { l: 'Strong', c: '#16a34a', w: '80%' }, { l: 'Very strong', c: '#15803d', w: '100%' }];
  const lv = levels[Math.min(score, 5)];
  bar.querySelector('span').style.width = lv.w; bar.querySelector('span').style.background = lv.c;
  lbl.textContent = lv.l; lbl.style.color = lv.c;
}
async function submitChangePassword(root, forced) {
  const cur = root.querySelector('#cpCurrent').value;
  const nw = root.querySelector('#cpNew').value;
  const conf = root.querySelector('#cpConfirm').value;
  const err = root.querySelector('#cpError');
  err.style.display = 'none';
  if (nw !== conf) { err.style.display = 'block'; err.textContent = 'The new passwords do not match.'; return; }
  const res = await AUTH.changePassword(cur, nw);
  if (!res.ok) { err.style.display = 'block'; err.textContent = res.error; return; }
  closeModal();
  toast('Password updated.', 'success');
}

function initApp() {
  const session = AUTH.getSession(); if (!session) return;
  currentSession = session;
  const perms = AUTH.getPermissions(session.role);

  loadState();
  applySettings();

  el('authScreen').style.display = 'none';
  el('appShell').classList.add('visible');

  el('roleChip').textContent = perms.badge;
  el('userName').textContent = session.displayName;
  el('userRole').textContent = perms.label;
  document.documentElement.style.setProperty('--role', perms.color);

  el('exportBtn').style.display = can('canExport') ? '' : 'none';
  // Restoring a device backup, daily snapshots and "erase all data" belong to
  // the offline edition; online, the school database is the record.
  el('importLabel').style.display = can('canImport') && !ONLINE_EDITION ? '' : 'none';

  buildNav(perms.tabs);

  // Role-gated cards
  const show = (id, ok) => { const e = el(id); if (e) e.style.display = ok ? '' : 'none'; };
  show('regStudentCard', can('canRegisterStudent'));
  show('recPaymentCard', can('canRecordPayment'));
  show('addProgramCard', can('canAddProgram'));
  show('resetCard', can('canReset') && !ONLINE_EDITION);
  show('userMgmtCard', can('canManageUsers'));
  show('auditLogCard', can('canManageUsers'));
  show('settingsCard', can('canManageSettings'));
  show('conductFormCard', can('canLogConduct'));
  show('perfFormCard', can('canLogPerformance'));
  show('termMgmtCard', can('canManageTerms'));
  show('feeStructCard', can('canManageTerms'));
  show('bandsCard', can('canManageSettings'));
  show('importCard', can('canRegisterStudent'));
  show('snapshotsBtn', can('canImport') && !ONLINE_EDITION);
  show('exportDefaultersBtn2', can('canExport'));
  show('marksheetCard', can('canAddAcademic'));
  show('commentsCard', can('canAddAcademic'));
  show('adminImportLabel', can('canImport') && !ONLINE_EDITION);
  // Sports is view-only for roles that cannot act there (the administrator).
  show('trainingFormCard', can('canMarkAttendance'));
  show('addCompetitionBtn', can('canManageCompetitions'));
  show('addSquadBtn', can('canManageSquads'));
  show('syncStatus', ONLINE_EDITION);
  // Online only: SMS, results for parents, notices parents can read.
  show('smsCard', ONLINE_EDITION && can('canViewSmsLog'));
  show('smsLogCard', ONLINE_EDITION && can('canViewSmsLog'));
  show('smsSettingsForm', ONLINE_EDITION && can('canManageSettings'));
  show('noticeSmsWrap', ONLINE_EDITION && can('canBroadcastSms'));
  show('publishBox', ONLINE_EDITION && can('canPublishResults'));
  if (ONLINE_EDITION) SMS.forget();
  showOnlineImport();
  if (ONLINE_EDITION && can('canManageSettings') && SYNC.importing()) setTimeout(resolveInterruptedImport, 0);

  setupBindings();
  renderAll();
  updateBackupBanner();
  startSessionTimer();

  if (el('attendanceDate')) el('attendanceDate').value = todayISO();
  // A new sign-in starts at the top of each module, not where the last person was.
  Object.keys(lastSub).forEach(k => delete lastSub[k]);
  switchTab(AUTH.getDefaultTab());
  if (AUTH.mustChangePassword()) openChangePwd(true);
}

/* Throttle activity-based session refresh to once per minute. */
function registerActivityRefresh() {
  ['click', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, () => {
    const now = Date.now();
    if (AUTH.getSession() && now - lastRefresh > 60000) { lastRefresh = now; AUTH.refreshSession(); }
  }, { passive: true }));
}

/* =========================================================================
   Online edition: sign-in extras and start-up (unused offline)
   ========================================================================= */
function applyEditionTexts() {
  const edition = ONLINE_EDITION ? 'online' : 'offline';
  document.querySelectorAll('[data-edition]').forEach(e => { e.style.display = e.dataset.edition === edition ? '' : 'none'; });
  if (!ONLINE_EDITION) return;
  const user = el('loginUsername');
  user.type = 'email'; user.autocomplete = 'email'; user.name = 'email';
  const label = document.querySelector('label[for="loginUsername"]'); if (label) label.textContent = 'Email address';
  const sub = document.querySelector('.auth-card .auth-sub'); if (sub) sub.textContent = 'Sign in with the email address your school registered for you.';
  // Staff are added by email address and choose their own password.
  const uLabel = el('editUsername') && el('editUsername').previousElementSibling;
  if (uLabel) uLabel.textContent = 'Email address';
  if (el('editUsername')) { el('editUsername').type = 'email'; el('editUsername').placeholder = 'name@yourschool.ug'; }
  if (el('editPassword')) el('editPassword').parentElement.style.display = 'none';
  const desc = document.querySelector('#userMgmtCard .card-desc');
  if (desc) desc.textContent = 'Staff who can sign in to this school. Add someone by email address; they then create their own password with "First time here?".';
}

function authModalError(root, id, message) { const e = root.querySelector(id); e.style.display = message ? 'block' : 'none'; e.textContent = message || ''; }

function openSignUp() {
  openModal({
    title: 'Create your staff account',
    bodyHtml: `<p class="card-desc" style="margin-bottom:12px">Use the email address your school's director added for you. We will email you a link to confirm it.</p>
      <div class="field"><label for="suEmail">Email address</label><input class="input" type="email" id="suEmail" autocomplete="email"></div>
      <div class="field"><label for="suPwd">Choose a password <span class="opt">(min 8 chars, letters + numbers)</span></label><input class="input" type="password" id="suPwd" autocomplete="new-password"></div>
      <div class="field"><label for="suConfirm">Confirm password</label><input class="input" type="password" id="suConfirm" autocomplete="new-password"></div>
      <div id="suError" class="auth-error" style="display:none"></div>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="suSave">Create account</button>`,
    onOpen(root) {
      const typed = el('loginUsername').value.trim(); if (typed) root.querySelector('#suEmail').value = typed;
      root.querySelector('#suSave').addEventListener('click', async () => {
        const email = root.querySelector('#suEmail').value.trim().toLowerCase();
        const pwd = root.querySelector('#suPwd').value;
        if (pwd !== root.querySelector('#suConfirm').value) return authModalError(root, '#suError', 'The passwords do not match.');
        const btn = root.querySelector('#suSave'); btn.disabled = true;
        const res = await AUTH.signUp(email, pwd);
        btn.disabled = false;
        if (!res.ok) return authModalError(root, '#suError', res.error);
        closeModal();
        el('loginUsername').value = email;
        if (res.confirmEmail) { toast(`Account created. Open the link we emailed to ${email}, then sign in.`, 'success'); return; }
        el('loginPassword').value = pwd;
        el('loginForm').requestSubmit();
      });
    },
  });
}

function openForgotPassword() {
  openModal({
    title: 'Reset your password',
    bodyHtml: `<p class="card-desc" style="margin-bottom:12px">Enter your email address and we will send you a link to choose a new password.</p>
      <div class="field"><label for="fpEmail">Email address</label><input class="input" type="email" id="fpEmail" autocomplete="email"></div>
      <div id="fpError" class="auth-error" style="display:none"></div>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="fpSend">Send link</button>`,
    onOpen(root) {
      const typed = el('loginUsername').value.trim(); if (typed) root.querySelector('#fpEmail').value = typed;
      root.querySelector('#fpSend').addEventListener('click', async () => {
        const email = root.querySelector('#fpEmail').value.trim();
        const btn = root.querySelector('#fpSend'); btn.disabled = true;
        const res = await AUTH.sendPasswordReset(email);
        btn.disabled = false;
        if (!res.ok) return authModalError(root, '#fpError', res.error);
        closeModal();
        toast(`If ${email} has an account, a reset link is on its way. Check your email.`, 'success');
      });
    },
  });
}

/* Shown after following a password-reset link from the email. */
function openSetNewPassword() {
  openModal({
    title: 'Choose a new password',
    locked: true,
    bodyHtml: `<div class="field"><label for="npPwd">New password <span class="opt">(min 8 chars, letters + numbers)</span></label><input class="input" type="password" id="npPwd" autocomplete="new-password"></div>
      <div class="field"><label for="npConfirm">Confirm new password</label><input class="input" type="password" id="npConfirm" autocomplete="new-password"></div>
      <div id="npError" class="auth-error" style="display:none"></div>`,
    footHtml: `<button class="btn btn-primary btn-block" id="npSave">Save new password</button>`,
    onOpen(root) {
      root.querySelector('#npSave').addEventListener('click', async () => {
        const pwd = root.querySelector('#npPwd').value;
        if (pwd !== root.querySelector('#npConfirm').value) return authModalError(root, '#npError', 'The passwords do not match.');
        const res = await AUTH.setNewPassword(pwd);
        if (!res.ok) return authModalError(root, '#npError', res.error);
        closeModal();
        AUTH.logout();
        toast('Password changed. Sign in with your new password.', 'success');
      });
    },
  });
}

/* Signed in, but not linked to any school yet: offer to start one. */
function offerNewSchool() {
  openModal({
    title: 'Start your school on the portal',
    bodyHtml: `<p class="card-desc" style="margin-bottom:12px">Your email address is not linked to a school yet. If your school is joining the portal, set it up here and you become its Executive Director. If your school already uses the portal, ask its director to add you instead.</p>
      <div class="field"><label for="nsName">School name</label><input class="input" id="nsName" placeholder="e.g. Kampala Hill Primary School"></div>
      <div class="field"><label for="nsYou">Your name</label><input class="input" id="nsYou" placeholder="e.g. Sarah Namubiru"></div>
      <div id="nsError" class="auth-error" style="display:none"></div>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Not now</button><button class="btn btn-primary" id="nsCreate">Start the school</button>`,
    onOpen(root) {
      root.querySelector('#nsCreate').addEventListener('click', async () => {
        const btn = root.querySelector('#nsCreate'); btn.disabled = true;
        const res = await AUTH.createSchool(root.querySelector('#nsName').value, root.querySelector('#nsYou').value);
        btn.disabled = false;
        if (!res.ok) return authModalError(root, '#nsError', res.error);
        closeModal();
        el('authError').style.display = 'none';
        currentSession = res.session;
        initApp();
        toast(`${res.session.schoolName} is ready. Add your staff under Administration → Staff accounts.`, 'success');
      });
    },
  });
}

/* Bring a school's offline-edition backup into its new online school. Every
   learner's bills and payments are checked against the backup before the
   import is accepted; if anything differs it can be undone. */
async function importOfflineBackup(file) {
  if (!ONLINE_EDITION || !can('canManageSettings')) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { data = null; }
  if (!data || !Array.isArray(data.students)) return toast('That file is not a portal backup.', 'error');
  const backup = migrate(data);
  ensureDefaultTerm(backup);
  const seen = new Set(), problems = [];
  backup.students.forEach(s => {
    if (!ADMISSION_RE.test(String(s.id || ''))) problems.push(`"${s.id}" (${s.name}): admission numbers may only contain letters, numbers, / _ and -`);
    else if (seen.has(String(s.id).toLowerCase())) problems.push(`"${s.id}" is used by more than one learner`);
    seen.add(String(s.id).toLowerCase());
  });
  if (problems.length) {
    return openModal({
      title: 'Fix these learners first',
      bodyHtml: `<p class="card-desc" style="margin-bottom:10px">Correct them in the offline edition, export a new backup and try again.</p><ul style="margin:0;padding-left:18px;font-size:13px">${problems.slice(0, 12).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>${problems.length > 12 ? `<p class="card-desc">…and ${problems.length - 12} more.</p>` : ''}`,
      footHtml: '<button class="btn btn-primary" data-modal-close>OK</button>',
    });
  }
  const expected = SYNC.balancesOf(backup);
  const live = backup.payments.filter(p => !p.void);
  const ok = await confirmDialog({
    title: 'Bring in the offline backup',
    message: `${backup.students.length} learners, ${live.length} payments (${fmtMoney(live.reduce((a, p) => a + Number(p.amount || 0), 0))}), ${backup.invoices.length} bills and ${backup.terms.length} terms will be copied into ${schoolName()}. Terms or notices already entered here are replaced. Every learner's bills and payments are then checked against the backup.`,
    confirmLabel: 'Bring in the backup',
  });
  if (!ok) return;
  if (needsConnection('Bringing in a backup')) return;
  openModal({ title: 'Bringing in the backup…', locked: true, bodyHtml: '<p class="card-desc" id="impProgress">Starting…</p>', footHtml: '' });
  const say = text => { const p = el('impProgress'); if (p) p.textContent = text; };
  let result;
  try {
    result = await SYNC.importBackup(backup, (done, total) => say(`Copied ${done} of ${total} records…`));
  } catch (e) {
    try { await SYNC.cancelImport(); } catch (_) {}
    closeModal();
    return toast('The backup was not brought in: ' + (e.message || e) + ' Nothing was kept; you can try again.', 'error');
  }
  say('Checking every learner\'s balance…');
  let actual;
  try {
    await SYNC.loadSchool(currentSession.schoolId, currentSession.role);
    loadState();
    actual = SYNC.balancesOf(state);
  } catch (e) {
    closeModal();
    return toast('The backup was copied, but the balances could not be checked: ' + (e.message || e) + ' Sign in again to finish or undo the import.', 'error');
  }
  const wrong = Object.keys(expected).filter(id => !actual[id] || actual[id].billed !== expected[id].billed || actual[id].paid !== expected[id].paid);
  closeModal();
  if (!wrong.length) {
    await SYNC.finishImport(`${backup.students.length} learners, ${result.total} records, all balances checked`);
    renderAll(); showOnlineImport();
    return toast(`Done. All ${backup.students.length} learners' balances match the backup.${result.skipped ? ` ${result.skipped} records that belonged to no learner were left out.` : ''}`, 'success');
  }
  const examples = wrong.slice(0, 3).map(id => `${expected[id].name} (${id})`).join(', ');
  const choice = await chooseImportOutcome('Some balances do not match',
    `${wrong.length} learner(s) do not match the backup, for example ${examples}. Undo the import to remove everything it brought in, or keep it and check those learners' accounts yourself.`);
  await settleImport(choice, `${backup.students.length} learners; ${wrong.length} balance(s) differ from the backup`);
}

/* The director must either keep or undo an import: until then the database
   pauses new payments for the school. */
function chooseImportOutcome(title, message) {
  return new Promise(resolve => {
    openModal({
      title, locked: true,
      bodyHtml: `<p style="font-size:14px;color:var(--muted);margin:0">${escapeHtml(message)}</p>`,
      footHtml: '<button class="btn btn-danger-solid" id="impUndo" type="button">Undo the import</button><button class="btn btn-primary" id="impKeep" type="button">Keep it and finish</button>',
      onOpen(root) {
        root.querySelector('#impUndo').addEventListener('click', () => { closeModal(); resolve('undo'); });
        root.querySelector('#impKeep').addEventListener('click', () => { closeModal(); resolve('keep'); });
      },
    });
  });
}
async function settleImport(choice, summary) {
  try {
    if (choice === 'undo') await SYNC.cancelImport(); else await SYNC.finishImport(summary);
    await SYNC.loadSchool(currentSession.schoolId, currentSession.role);
    loadState(); renderAll(); showOnlineImport();
    toast(choice === 'undo' ? 'The import was undone.' : 'The import is finished. Check the learners whose balances differed.', 'warn');
  } catch (e) {
    toast('Could not finish the import: ' + (e.message || e) + ' Sign in again to finish or undo it.', 'error');
  }
}
/* An import that was interrupted (closed tab, lost connection) is offered
   again to the director at sign-in, so the school is never left with
   payments paused. */
async function resolveInterruptedImport() {
  const choice = await chooseImportOutcome('A backup import did not finish',
    'Bringing in the offline backup was interrupted, so new payments are paused for this school. Keep what was brought in and finish, or undo it and bring the backup in again.');
  await settleImport(choice, 'Finished after an interruption');
}
/* "Bring in data from the offline edition" is offered to the director of a
   new online school that has no learners yet. */
function showOnlineImport() {
  const e = el('onlineImportLabel'); if (!e) return;
  e.style.display = ONLINE_EDITION && can('canManageSettings') && !state.students.length ? '' : 'none';
}

/* Connect to the school database and pick up an earlier sign-in. */
async function startOnline() {
  applyEditionTexts();
  el('authScreen').style.display = 'grid';
  const btn = el('loginBtn'), err = el('authError');
  btn.disabled = true; btn.textContent = 'Connecting…';
  let res;
  try { res = await ONLINE.start(); } catch (e) { res = { signedIn: false, error: e.message }; }
  btn.disabled = false; btn.textContent = 'Sign in';
  if (res.signedIn) { currentSession = AUTH.getSession(); initApp(); return; }
  if (res.error) { err.style.display = 'block'; err.textContent = res.error; }
}

document.addEventListener('DOMContentLoaded', () => {
  if (el('brandCrest')) el('brandCrest').innerHTML = crestSVG();
  if (el('topCrest')) el('topCrest').innerHTML = crestSVG();
  el('loginForm').addEventListener('submit', handleLogin);
  el('changePwdBtn').addEventListener('click', () => openChangePwd(false));
  el('menuBtn').addEventListener('click', openMenu);
  el('logoutBtn').addEventListener('click', handleLogout);
  if (el('forgotPwdBtn')) el('forgotPwdBtn').addEventListener('click', openForgotPassword);
  if (el('signUpBtn')) el('signUpBtn').addEventListener('click', openSignUp);
  if (el('onlineImportInput')) el('onlineImportInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importOfflineBackup(f); });
  window.addEventListener('portal:password-recovery', openSetNewPassword);
  el('navBar').addEventListener('click', e => { const b = e.target.closest('.nav-tab'); if (b) switchTab(b.dataset.tab); });
  el('subNav').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b && currentTab) showSub(currentTab, b.dataset.sub); });
  el('sessionExtendBtn').addEventListener('click', () => { AUTH.refreshSession(); updateSessionBar(); });
  document.addEventListener('click', handleDelegatedClick);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('#modalHost [data-locked]')) closeModal(); });
  registerActivityRefresh();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is available — refresh to update.', 'info');
          }
        });
      });
    }).catch(() => {});
  }

  // Show the school's own name, logo and colours on the sign-in screen.
  try { loadState(); applySettings(); applyBranding(); } catch (_) {}

  if (ONLINE_EDITION) { startOnline(); return; }
  applyEditionTexts();   // hide what only the online edition has (e.g. "Who can see this" on notices)
  const session = AUTH.getSession();
  if (session) { currentSession = session; initApp(); }
  else el('authScreen').style.display = 'grid';
});

window.KSA = { state: () => state, exportLedger };
