/* =========================================================================
   School Management Portal — application logic
   Offline-first, role-aware. All data is stored locally on the device.
   ========================================================================= */
'use strict';

/* ── Constants ─────────────────────────────────────────────────────────── */
const SCHEMA_VERSION = 5;
const PAGE_SIZE = 25;

const DEFAULT_SETTINGS = {
  schoolName: 'Kampala School & Academy',
  motto: 'Knowledge · Integrity · Service',
  address: 'Kampala, Uganda',
  poBox: '',
  phone: '',
  email: '',
  headTeacher: '',
  gradingMode: 'legacy',      // 'legacy' = D1–F9 + Division · 'cbc' = new lower-secondary A–E
  currency: 'UGX',
};

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
let state = freshState();
let currentSession = null;
let studentPage = 1;
/* Feature modules (billing.js, academics.js, register.js, tools.js) register
   here: { name, setup(), render(), afterSave() }. */
const MODULES = [];
let bindingsReady = false;

function freshState() {
  return {
    version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS },
    students: [], payments: [], attendance: [], conduct: [], programs: [],
    competitions: [], squads: [], notices: [], terms: [], feeComponents: [],
    invoices: [], feeStructures: [], registers: [],
  };
}

/* ── SVG icon set (feather-style) ──────────────────────────────────────── */
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  directory: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  academics: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  payments: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  sports: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  register: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><polyline points="9 14 11 16 15 12"/>',
  attendance: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 15 11 17 15 13"/>',
  competitions: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  bursary: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  conduct: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  reports: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  noticeboard: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  admin: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
};
function icon(name, size = 18) {
  const p = ICONS[name] || '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
function crestSVG() {
  return `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M24 3l17 6v11c0 11-7.4 19.2-17 22C14.4 39.2 7 31 7 20V9l17-6z" fill="#0b5d3b" stroke="#08472d" stroke-width="1.5"/>
    <path d="M24 3l17 6v11c0 11-7.4 19.2-17 22C14.4 39.2 7 31 7 20V9l17-6z" fill="url(#cg)" opacity="0.15"/>
    <path d="M15 26c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0" stroke="#d4a017" stroke-width="2" stroke-linecap="round"/>
    <path d="M24 12l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L24 12z" fill="#d4a017"/>
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  </svg>`;
}

/* ── Utilities ─────────────────────────────────────────────────────────── */
function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString(); }
function currency() { return (state.settings && state.settings.currency) || 'UGX'; }
function fmtMoney(n) { return currency() + ' ' + Number(n || 0).toLocaleString('en-UG'); }
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function el(id) { return document.getElementById(id); }
function schoolName() { return (state.settings && state.settings.schoolName) || 'School Portal'; }

function toast(msg, type = 'success') {
  const map = { success: 'check', error: 'alert', warn: 'info', info: 'info' };
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.setAttribute('role', 'status');
  t.innerHTML = icon(map[type] || 'info') + '<span></span>';
  t.querySelector('span').textContent = msg;
  el('toastHost').appendChild(t);
  setTimeout(() => t.remove(), 3900);
}

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

/* The balance cache (student.paid) is always derived from the payment ledger. */
function recomputePaid() {
  const totals = {};
  state.payments.forEach(p => { if (!p.void) totals[p.studentId] = (totals[p.studentId] || 0) + Number(p.amount || 0); });
  state.students.forEach(s => { s.paid = totals[s.id] || 0; });
}
/* Grades are derived from the raw score under the school's current grading
   mode, so switching O-Level modes re-grades existing entries consistently. */
function recomputeGrades() {
  state.students.forEach(s => (s.academics || []).forEach(a => {
    const g = gradeFor(s.level, a.score);
    a.grade = g.grade; a.points = g.points;
  }));
}
function studentPaid(s) { return Number(s.paid || 0); }

/* ── Classification & grading ──────────────────────────────────────────── */
function classifyLevel(cls) {
  if (!cls) return 'Other';
  const c = cls.trim();
  if (['Baby Class', 'Middle Class', 'Top Class'].includes(c)) return 'Pre-Primary';
  if (/^P\.[1-7]$/.test(c)) return 'Primary';
  if (/^S\.[1-4]$/.test(c)) return 'O Level';
  if (/^S\.[5-6]$/.test(c)) return 'A Level';
  return 'Other';
}
function gradingMode() { return (state.settings && state.settings.gradingMode) || 'legacy'; }

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
function normalizePhone(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('256')) return '+' + d;
  if (d.startsWith('0') && d.length === 10) return '+256' + d.slice(1);
  return d;
}

/* =========================================================================
   Business logic
   ========================================================================= */
const ADMISSION_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,23}$/;

function registerStudent(f) {
  if (!can('canRegisterStudent')) return toast('You do not have permission to register students.', 'error');
  let id = (f.admissionNo || '').trim();
  if (id) {
    if (!ADMISSION_RE.test(id)) return toast('Admission number may only contain letters, numbers, / _ and -.', 'error');
    if (state.students.some(s => s.id.toLowerCase() === id.toLowerCase())) return toast('Admission number "' + id + '" is already in use.', 'error');
  } else {
    id = 'S' + uid().slice(0, 6);
  }
  if (!f.name || !f.name.trim()) return toast('Student name is required.', 'error');
  state.students.push({
    id, name: f.name.trim(), class: (f.class || '').trim(), level: classifyLevel(f.class),
    combination: (f.combination || '').split(',').map(x => x.trim()).filter(Boolean).join(', '),
    guardian: (f.guardian || '').trim(), fee: Number(f.fee) || 0, paid: 0, stream: (f.stream || '').trim(),
    sport: (f.sport || '').trim(), skillLevel: (f.skillLevel || '').trim(),
    gender: (f.gender || '').trim(), boardingStatus: (f.boardingStatus || 'Day').trim(),
    unebIndexNo: (f.unebIndexNo || '').trim(), senFlag: (f.senFlag || '').trim(),
    performanceNotes: [], academics: [], bursaryPct: 0, feeComponents: [], injuryLog: [],
    athleteProfile: {}, comments: {}, createdAt: todayISO(),
  });
  billStudentForCurrentTerm(state.students[state.students.length - 1]);
  saveState(); renderAll();
  AUTH.audit('STUDENT_REGISTER', `${f.name.trim()} (${id})`);
  toast('Registered ' + f.name.trim() + ' (' + id + ').', 'success');
}

function updateStudent(id, f) {
  if (!can('canEditStudents')) return toast('You do not have permission to edit students.', 'error');
  const s = state.students.find(x => x.id === id);
  if (!s) return toast('Student not found.', 'error');
  s.name = (f.name || '').trim() || s.name;
  s.class = (f.class || '').trim() || s.class;
  s.level = classifyLevel(s.class);
  s.combination = (f.combination || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');
  s.guardian = (f.guardian || '').trim();
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
}

async function recordPayment(f) {
  if (!can('canRecordPayment')) return toast('You do not have permission to record payments.', 'error');
  const s = state.students.find(x => x.id === f.studentId);
  if (!s) return toast('Choose a student first.', 'error');
  const amount = Number(f.amount);
  if (!amount || amount <= 0) return toast('Enter a valid amount.', 'error');
  if (needsConnection('Recording a payment')) return;
  const date = f.date || todayISO();
  const payment = {
    id: 'P' + uid(), studentId: s.id, amount, method: f.method || 'Cash',
    reference: (f.reference || '').trim(), date,
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
    return toast(`Connection lost while saving ${fmtMoney(amount)} for ${s.name}. It is kept and will be saved automatically when the connection returns. Do not record it again.`, 'warn');
  }
  if (!saved.ok) {
    state.payments = state.payments.filter(x => x !== payment);
    recomputePaid(); renderAll();
    return toast('The payment was NOT recorded. ' + saved.error, 'error');
  }
  renderAll();
  AUTH.audit('PAYMENT_RECORD', `${fmtMoney(amount)} · ${s.name} (${s.id}) · ${f.method || 'Cash'}`);
  toast('Recorded ' + fmtMoney(amount) + ' for ' + s.name + '.', 'success');
}

async function voidPayment(id, reason) {
  if (!can('canVoidPayment')) return toast('You do not have permission to reverse payments.', 'error');
  const p = state.payments.find(x => x.id === id);
  if (!p || p.void) return;
  if (ONLINE_EDITION && !(reason || '').trim()) return toast('Give a reason for the reversal.', 'error');
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
  AUTH.audit('PAYMENT_VOID', `${p.id} · ${fmtMoney(p.amount)} · ${p.voidReason}`);
  toast('Payment reversed.', 'warn');
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

function addConduct(f) {
  if (!can('canLogConduct')) return toast('You do not have permission to log conduct.', 'error');
  const s = state.students.find(x => x.id === f.studentId);
  if (!s) return toast('Choose a student first.', 'error');
  const entry = { id: 'CON' + uid().slice(0, 5), studentId: f.studentId, date: todayISO(), type: f.type, severity: f.severity, description: (f.description || '').trim(), reportedBy: (f.reportedBy || '').trim() };
  state.conduct.push(entry);
  saveState(); renderAll();
  toast('Conduct entry saved for ' + s.name + '.', 'success');
  if (f.notifyGuardian) smsConduct(entry.id);
}
async function deleteConduct(id) {
  if (!can('canDeleteConduct')) return toast('You do not have permission.', 'error');
  if (!await confirmDialog({ title: 'Delete entry', message: 'Delete this conduct entry?', confirmLabel: 'Delete', danger: true })) return;
  state.conduct = state.conduct.filter(c => c.id !== id);
  saveState(); renderAll();
  toast('Conduct entry removed.', 'success');
}

function addProgram(f) {
  if (!can('canAddProgram')) return toast('You do not have permission.', 'error');
  if (!f.name || !f.sport) return toast('Program name and sport are required.', 'error');
  state.programs.push({ id: 'PRG' + uid().slice(0, 5), name: f.name.trim(), sport: f.sport.trim(), coach: (f.coach || 'To be assigned').trim(), days: f.days || [], requirements: (f.requirements || '').split('\n').map(x => x.trim()).filter(Boolean) });
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
  state.attendance.push({ id: 'ATT' + uid().slice(0, 5), programId, date, records });
  saveState(); renderAll();
  toast('Attendance saved for ' + date + '.', 'success');
}

async function setBursary(studentId) {
  if (!can('canAwardBursary')) return toast('You do not have permission.', 'error');
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const val = await promptDialog({ title: 'Award bursary', label: `Bursary percentage for ${s.name} (0–100)`, value: String(s.bursaryPct || 0), type: 'number' });
  if (val === null) return;
  s.bursaryPct = Math.max(0, Math.min(100, Number(val) || 0));
  refreshCurrentInvoice(s);
  saveState(); renderAll();
  AUTH.audit('BURSARY_AWARD', `${s.name} (${s.id}) → ${s.bursaryPct}%`);
  toast(`Bursary set to ${s.bursaryPct}% for ${s.name}.`, 'success');
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
function smsConduct(conductId) {
  const c = state.conduct.find(x => x.id === conductId); if (!c) return;
  const s = state.students.find(x => x.id === c.studentId); if (!s) return;
  const phone = normalizePhone(s.guardian);
  if (!phone) return toast('No valid guardian phone number on file.', 'error');
  const opener = c.severity === 'Positive' ? `Commendation for ${s.name}:` : `Conduct notice regarding ${s.name}:`;
  const body = `${opener} "${c.description}" — ${c.reportedBy || 'school staff'}. ${schoolName()}`;
  window.open('sms:' + phone + '?body=' + encodeURIComponent(body), '_blank');
}
function openBulkSms() {
  const debtors = state.students.map(s => ({ s, bal: studentBalance(s) })).filter(x => x.bal > 0).sort((a, b) => b.bal - a.bal);
  const total = debtors.reduce((a, x) => a + x.bal, 0);
  const body = !debtors.length
    ? `<div class="banner banner-success">${icon('check')} All fees are cleared — no reminders needed.</div>`
    : `<p class="card-desc" style="margin-bottom:12px">Outstanding across ${debtors.length} student${debtors.length > 1 ? 's' : ''}: <strong style="color:var(--danger)">${fmtMoney(total)}</strong></p>
       <div class="scroll-box">${debtors.map(({ s, bal }) => `
         <div class="roster-item">
           <div><div style="font-weight:600">${escapeHtml(s.name)}</div>
           <div class="card-desc">${escapeHtml(s.class)} · ${escapeHtml(s.guardian)} · <span style="color:var(--danger);font-weight:600">${fmtMoney(bal)}</span></div></div>
           <div style="display:flex;gap:6px">
             <button class="btn btn-outline btn-xs" data-act="smsBalance" data-id="${escapeHtml(s.id)}">${icon('message', 14)} SMS</button>
             <button class="btn btn-outline btn-xs" data-act="waBalance" data-id="${escapeHtml(s.id)}">WhatsApp</button>
           </div>
         </div>`).join('')}</div>`;
  openModal({ title: 'Fee reminders', bodyHtml: body, footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>` });
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
  const guard = (fn) => { try { fn(); } catch (err) { console.error(err); } };
  guard(updateMetrics);
  guard(renderStudentTable);
  guard(renderPaymentsTable);
  guard(renderPrograms);
  guard(renderSportFilter);
  guard(renderSportOptions);
  guard(renderPerformanceTable);
  guard(renderAcademicTable);
  guard(renderSubjectList);
  guard(renderAttendanceProgramSelect);
  guard(renderAttendanceRoster);
  guard(renderAttendanceTable);
  guard(renderBursaryTable);
  guard(renderConductTable);
  guard(renderStatisticalReports);
  guard(renderStudentSelects);
  guard(renderCompetitionsTable);
  guard(renderSquadsGrid);
  guard(renderAthleteProfiles);
  guard(renderNotices);
  guard(renderWhatsNew);
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
      { label: 'Collected this term', value: fmtMoney(f.collectedThisTerm), cls: 'is-success', money: true, sub: f.rate + '% of this term billed' },
      { label: 'Outstanding', value: fmtMoney(outstanding), cls: 'is-danger', money: true, sub: f.debtors + ' learners owe' },
      { label: 'Arrears b/f', value: fmtMoney(f.arrears), cls: 'is-gold', money: true, sub: 'from earlier terms' },
      { label: 'Fully paid', value: cleared, cls: 'is-info' },
    ];
  } else if (role === 'bursary') {
    const f = financeSnapshot();
    cards = [
      { label: 'Learners', value: s.length },
      { label: 'Collected this term', value: fmtMoney(f.collectedThisTerm), cls: 'is-success', money: true, sub: f.rate + '% of this term billed' },
      { label: 'Outstanding', value: fmtMoney(outstanding), cls: 'is-danger', money: true, sub: f.debtors + ' learners owe' },
      { label: 'Arrears b/f', value: fmtMoney(f.arrears), cls: 'is-gold', money: true },
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

function renderStudentTable() {
  const body = el('studentTableBody'); if (!body) return;
  const q = (el('searchInput').value || '').toLowerCase();
  const levelF = el('levelFilter').value || '';
  const list = state.students.filter(s =>
    (!q || s.name.toLowerCase().includes(q) || s.class.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) &&
    (!levelF || s.level === levelF)
  );
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (studentPage > pages) studentPage = pages;
  const slice = list.slice((studentPage - 1) * PAGE_SIZE, studentPage * PAGE_SIZE);

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty">No students match your filters.</td></tr>';
  } else {
    body.innerHTML = slice.map(s => {
      const acct = studentAccount(s), fee = effectiveFee(s), bal = acct.balance, paid = studentPaid(s);
      const status = bal <= 0 ? '<span class="badge badge-success">Cleared</span>'
        : acct.arrears > 0 ? `<span class="badge badge-danger">${fmtMoney(bal)}</span>`
        : (paid > 0 ? `<span class="badge badge-warn">${fmtMoney(bal)}</span>` : `<span class="badge badge-danger">${fmtMoney(bal)}</span>`);
      const sport = s.sport ? `${escapeHtml(s.sport)} ${skillBadge(s.skillLevel)}` : '<span class="t-muted">—</span>';
      const gender = s.gender === 'Female' ? '<span style="color:#be185d">Female</span>' : s.gender === 'Male' ? '<span style="color:#1d4ed8">Male</span>' : '<span class="t-muted">—</span>';
      const board = s.boardingStatus === 'Boarding' ? '<span class="badge badge-purple">Boarding</span>' : s.boardingStatus === 'Weekly' ? '<span class="badge badge-info">Weekly</span>' : '<span class="badge badge-neutral">Day</span>';
      const bursaryTag = (s.bursaryPct > 0 ? `<div class="card-desc" style="color:var(--warn)">−${s.bursaryPct}% bursary</div>` : '') + (acct.arrears > 0 ? `<div class="card-desc" style="color:var(--danger)">+${fmtMoney(acct.arrears)} arrears</div>` : '');
      const senTag = s.senFlag ? `<div class="card-desc" style="color:#6d28d9">SEN: ${escapeHtml(s.senFlag)}</div>` : '';
      const editBtn = can('canEditStudents') ? `<button class="btn-icon" title="Edit" data-act="editStudent" data-id="${escapeHtml(s.id)}">${icon('edit', 15)}</button>` : '';
      const delBtn = can('canDeleteStudents') ? `<button class="btn-icon" title="Remove" data-act="deleteStudent" data-id="${escapeHtml(s.id)}">${icon('trash', 15)}</button>` : '';
      return `<tr>
        <td class="t-id">${escapeHtml(s.id)}${s.unebIndexNo ? '<div class="card-desc" style="color:var(--info)">' + escapeHtml(s.unebIndexNo) + '</div>' : ''}</td>
        <td style="font-weight:600">${escapeHtml(s.name)}${senTag}</td>
        <td>${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}${s.combination ? '<div class="card-desc">' + escapeHtml(s.combination) + '</div>' : ''}</td>
        <td>${gender}</td>
        <td>${board}</td>
        <td>${escapeHtml(s.guardian)}</td>
        <td>${sport}</td>
        <td class="t-num">${fmtMoney(fee)}${bursaryTag}</td>
        <td class="t-num" style="color:var(--success);font-weight:600">${fmtMoney(paid)}</td>
        <td>${status}</td>
        <td><div class="row-actions">
          <button class="btn-icon" title="Report card" data-act="reportCard" data-id="${escapeHtml(s.id)}">${icon('file', 15)}</button>
          <button class="btn-icon" title="Fee receipt" data-act="feeReceipt" data-id="${escapeHtml(s.id)}">${icon('printer', 15)}</button>
          <button class="btn-icon" title="SMS guardian" data-act="smsBalance" data-id="${escapeHtml(s.id)}">${icon('message', 15)}</button>
          ${editBtn}${delBtn}
        </div></td>
      </tr>`;
    }).join('');
  }
  const pager = el('studentPager');
  if (pager) {
    pager.innerHTML = list.length ? `
      <span>Showing ${(studentPage - 1) * PAGE_SIZE + 1}–${Math.min(studentPage * PAGE_SIZE, list.length)} of ${list.length}</span>
      <span class="pager-btns">
        <button class="btn btn-outline btn-xs" data-act="studentPage" data-page="prev" ${studentPage <= 1 ? 'disabled' : ''}>${icon('left', 14)} Prev</button>
        <button class="btn btn-outline btn-xs" data-act="studentPage" data-page="next" ${studentPage >= pages ? 'disabled' : ''}>Next ${icon('right', 14)}</button>
      </span>` : '';
  }
}

function renderPaymentsTable() {
  const body = el('paymentsTableBody');
  const recent = el('recentPaymentsBody');
  const sorted = [...state.payments].sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date));
  if (body) {
    body.innerHTML = sorted.length ? sorted.map(p => {
      const s = state.students.find(x => x.id === p.studentId);
      const voidCol = `<button class="btn-icon" title="Print receipt" data-act="paymentReceipt" data-id="${escapeHtml(p.id)}">${icon('printer', 15)}</button>` + (can('canVoidPayment') && !p.void ? ` <button class="btn btn-danger btn-xs" data-act="voidPayment" data-id="${escapeHtml(p.id)}">Reverse</button>` : '');
      return `<tr style="${p.void ? 'opacity:0.55' : ''}">
        <td class="t-muted">${p.date}</td>
        <td class="t-id">${escapeHtml(p.studentId)}</td>
        <td style="font-weight:600">${s ? escapeHtml(s.name) : '<em class="t-muted">(removed)</em>'}${p.void ? ' <span class="badge badge-danger">Reversed</span>' : ''}</td>
        <td>${escapeHtml(p.method || 'Cash')}${p.reference ? '<div class="card-desc">Ref: ' + escapeHtml(p.reference) + '</div>' : ''}</td>
        <td class="card-desc">${escapeHtml(p.recordedByName || '—')}</td>
        <td class="t-num" style="color:var(--success);font-weight:600;${p.void ? 'text-decoration:line-through' : ''}">${fmtMoney(p.amount)}</td>
        <td class="t-num">${voidCol}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">No payments recorded yet.</td></tr>';
  }
  if (recent) {
    const live = sorted.filter(p => !p.void).slice(0, 6);
    recent.innerHTML = live.length ? live.map(p => {
      const s = state.students.find(x => x.id === p.studentId);
      return `<tr><td class="t-muted">${p.date}</td><td>${s ? escapeHtml(s.name) : '—'}</td><td class="t-num" style="color:var(--success);font-weight:600">${fmtMoney(p.amount)}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty">No payments yet.</td></tr>';
  }
}

function renderPrograms() {
  const grid = el('programsGrid'); if (!grid) return;
  if (!state.programs.length) { grid.innerHTML = '<div class="empty">No programs yet.</div>'; return; }
  grid.innerHTML = state.programs.map(p => {
    const enrolled = state.students.filter(s => (s.sport || '').toLowerCase() === (p.sport || '').toLowerCase()).length;
    const days = (p.days || []).map(d => `<span class="badge badge-info">${escapeHtml(d)}</span>`).join(' ') || '<span class="t-muted" style="font-size:12px">No schedule</span>';
    const reqs = (p.requirements || []).length ? '<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--muted)">' + p.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ul>' : '<p class="card-desc" style="margin-top:6px">No requirements listed</p>';
    const del = can('canAddProgram') ? `<button class="btn-icon" title="Remove" data-act="deleteProgram" data-id="${escapeHtml(p.id)}">${icon('trash', 15)}</button>` : '';
    return `<div class="tile">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div><div style="font-weight:700">${escapeHtml(p.name)}</div><div class="card-desc">${escapeHtml(p.sport)} · Coach ${escapeHtml(p.coach)}</div></div>${del}
      </div>
      <div class="pill-list" style="margin-top:9px">${days}</div>
      <div class="form-label" style="margin-top:11px;margin-bottom:2px">Requirements</div>${reqs}
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:11px;padding-top:9px;font-size:12.5px"><span class="t-muted">Enrolled</span><span style="font-weight:700;color:var(--brand)">${enrolled}</span></div>
    </div>`;
  }).join('');
}

function renderPerformanceTable() {
  const body = el('performanceTableBody'); if (!body) return;
  const filter = (el('sportFilter').value || '').toLowerCase();
  const list = state.students.filter(s => s.sport && (!filter || (s.sport || '').toLowerCase() === filter));
  body.innerHTML = list.length ? list.map(s => {
    const notes = s.performanceNotes || [];
    const latest = notes[notes.length - 1];
    return `<tr>
      <td style="font-weight:600">${escapeHtml(s.name)}</td>
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
  sel.innerHTML = '<option value="">Select a program…</option>' + state.programs.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.sport)})</option>`).join('');
  if (cur) sel.value = cur;
}
function renderAttendanceRoster() {
  const roster = el('attendanceRoster'); if (!roster) return;
  const programId = el('attendanceProgram').value;
  const date = el('attendanceDate').value;
  if (!programId) { roster.innerHTML = '<div class="empty">Select a program to load enrolled athletes.</div>'; return; }
  const program = state.programs.find(p => p.id === programId);
  const athletes = state.students.filter(s => (s.sport || '').toLowerCase() === (program.sport || '').toLowerCase());
  if (!athletes.length) { roster.innerHTML = '<div class="empty">No athletes enrolled for this sport.</div>'; return; }
  const existing = state.attendance.find(a => a.programId === programId && a.date === date);
  const presentMap = {};
  if (existing) (existing.records || []).forEach(r => { presentMap[r.studentId] = r.present; });
  roster.innerHTML = athletes.map(s => {
    const present = presentMap[s.id] !== false;
    return `<label class="roster-item" style="cursor:pointer">
      <div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.class)} · ${escapeHtml(s.level)}</div></div>
      <span class="check"><span class="att-state" data-for="${escapeHtml(s.id)}" style="font-size:12px;font-weight:600;color:${present ? 'var(--success)' : 'var(--faint)'}">${present ? 'Present' : 'Absent'}</span>
      <input type="checkbox" class="att-toggle" data-student="${escapeHtml(s.id)}" ${present ? 'checked' : ''}></span>
    </label>`;
  }).join('');
}
function renderAttendanceTable() {
  const body = el('attendanceTableBody'); if (!body) return;
  const athletes = state.students.filter(s => s.sport);
  if (!athletes.length || !state.attendance.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No sessions recorded yet.</td></tr>'; return; }
  body.innerHTML = athletes.map(s => {
    const att = studentAttendance(s.id);
    const color = att.rate >= 75 ? 'var(--success)' : att.rate >= 50 ? 'var(--warn)' : 'var(--danger)';
    return `<tr><td style="font-weight:600">${escapeHtml(s.name)}</td><td>${escapeHtml(s.sport)}</td><td class="t-center">${att.total}</td><td class="t-center">${att.present}</td><td class="t-center" style="font-weight:700;color:${color}">${att.rate}%</td></tr>`;
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
      <td style="font-weight:600">${escapeHtml(s.name)}</td>
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

function renderConductTable() {
  const body = el('conductTableBody'); if (!body) return;
  const filter = el('conductFilter').value;
  const list = [...state.conduct].filter(c => !filter || c.severity === filter).sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="empty">No conduct entries.</td></tr>'; return; }
  const sev = { Positive: 'badge-success', Minor: 'badge-info', Major: 'badge-warn', Severe: 'badge-danger' };
  body.innerHTML = list.map(c => {
    const s = state.students.find(x => x.id === c.studentId);
    const del = can('canDeleteConduct') ? `<button class="btn-icon" title="Delete" data-act="deleteConduct" data-id="${escapeHtml(c.id)}">${icon('trash', 15)}</button>` : '';
    const sms = s ? `<button class="btn-icon" title="SMS guardian" data-act="smsConduct" data-id="${escapeHtml(c.id)}">${icon('message', 15)}</button>` : '';
    return `<tr>
      <td class="t-muted">${c.date}</td>
      <td style="font-weight:600">${s ? escapeHtml(s.name) : '<em class="t-muted">(removed)</em>'}</td>
      <td>${s ? escapeHtml(s.class) : '—'}</td>
      <td>${escapeHtml(c.type)}</td>
      <td><span class="badge ${sev[c.severity] || 'badge-neutral'}">${escapeHtml(c.severity)}</span></td>
      <td style="max-width:240px">${escapeHtml(c.description)}</td>
      <td class="t-muted">${escapeHtml(c.reportedBy)}</td>
      <td><div class="row-actions">${sms}${del}</div></td>
    </tr>`;
  }).join('');
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
function renderSubjectList() {
  const dl = el('subjectList'); if (!dl) return;
  dl.innerHTML = Array.from(new Set([...PRIMARY_SUBJECTS, ...O_LEVEL_SUBJECTS, ...A_LEVEL_SUBJECTS])).sort().map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
}
function renderStudentSelects() {
  const fill = (id, label) => {
    const sel = el(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Choose a student…</option>' + state.students.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.class)}${label(s)}</option>`).join('');
    if (cur) sel.value = cur;
  };
  fill('paymentStudent', s => ` (Balance ${fmtMoney(studentBalance(s))})`);
  fill('perfStudent', s => s.sport ? ' · ' + s.sport : '');
  fill('conductStudent', s => ' · ' + s.class);
  updateBalancePreview();
}
function updateBalancePreview() {
  const sel = el('paymentStudent'); const box = el('balancePreview');
  if (!sel || !box) return;
  const s = state.students.find(x => x.id === sel.value);
  if (!s) { box.style.display = 'none'; return; }
  const a = studentAccount(s);
  box.style.display = 'block';
  box.innerHTML = `<strong>${escapeHtml(s.name)}</strong> · ${escapeHtml(s.class)}<br>This term ${fmtMoney(a.currentBilled)}${s.bursaryPct > 0 ? ` <span style="color:var(--warn)">(−${s.bursaryPct}% bursary)</span>` : ''}${a.arrears ? ` · <span style="color:var(--danger)">Arrears ${fmtMoney(a.arrears)}</span>` : ''}<br>Paid ${fmtMoney(a.paid)} · <span style="font-weight:700;color:${a.balance <= 0 ? 'var(--success)' : 'var(--danger)'}">Balance ${fmtMoney(a.balance)}</span>`;
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
const CLASS_OPTIONS = ['Baby Class', 'Middle Class', 'Top Class', 'P.1', 'P.2', 'P.3', 'P.4', 'P.5', 'P.6', 'P.7', 'S.1', 'S.2', 'S.3', 'S.4', 'S.5', 'S.6'];
function openStudentEdit(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const opt = (list, val) => list.map(o => `<option ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
  openModal({
    title: 'Edit student — ' + escapeHtml(s.name),
    wide: true,
    bodyHtml: `<form id="editStudentForm" class="form-grid">
      <div class="form-row">
        <div><label class="form-label">Full name</label><input class="input" name="name" value="${escapeHtml(s.name)}" required></div>
        <div><label class="form-label">Class</label><select class="input" name="class"><option value="">—</option>${opt(CLASS_OPTIONS, s.class)}</select></div>
      </div>
      <div class="form-row">
        <div><label class="form-label">Stream <span class="opt">(optional)</span></label><input class="input" name="stream" value="${escapeHtml(s.stream || '')}" placeholder="e.g. East"></div>
        <div><label class="form-label">Subjects / combination</label><input class="input" name="combination" value="${escapeHtml(s.combination)}"></div>
        <div><label class="form-label">Guardian contact</label><input class="input" name="guardian" value="${escapeHtml(s.guardian)}"></div>
      </div>
      <div class="form-row">
        <div><label class="form-label">Termly tuition (${currency()})</label><input class="input" type="number" min="0" step="1000" name="fee" value="${s.fee}"></div>
        <div><label class="form-label">Gender</label><select class="input" name="gender"><option value="">—</option><option ${s.gender === 'Male' ? 'selected' : ''}>Male</option><option ${s.gender === 'Female' ? 'selected' : ''}>Female</option></select></div>
        <div><label class="form-label">Boarding</label><select class="input" name="boardingStatus"><option ${(s.boardingStatus || 'Day') === 'Day' ? 'selected' : ''} value="Day">Day scholar</option><option ${s.boardingStatus === 'Boarding' ? 'selected' : ''} value="Boarding">Boarding</option><option ${s.boardingStatus === 'Weekly' ? 'selected' : ''} value="Weekly">Weekly boarder</option></select></div>
      </div>
      <div class="form-row">
        <div><label class="form-label">UNEB index no. <span class="opt">(S.4/S.6)</span></label><input class="input" name="unebIndexNo" value="${escapeHtml(s.unebIndexNo)}"></div>
        <div><label class="form-label">Special needs</label><input class="input" name="senFlag" value="${escapeHtml(s.senFlag)}" placeholder="None"></div>
      </div>
      <div class="form-row">
        <div><label class="form-label">Primary sport</label><input class="input" name="sport" value="${escapeHtml(s.sport)}"></div>
        <div><label class="form-label">Skill level</label><select class="input" name="skillLevel"><option value="">—</option>${opt(['Beginner', 'Intermediate', 'Advanced', 'Elite'], s.skillLevel)}</select></div>
      </div>
    </form>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="editStudentSave">${icon('save', 15)} Save changes</button>`,
    onOpen(root) {
      root.querySelector('#editStudentSave').addEventListener('click', () => {
        const fd = new FormData(root.querySelector('#editStudentForm'));
        updateStudent(studentId, Object.fromEntries(fd.entries()));
        closeModal();
      });
    },
  });
}

/* ── Printable documents ───────────────────────────────────────────────── */
function docHeader(subtitle) {
  const st = state.settings;
  const brand = st.brandColor || '#0b5d3b';
  const contact = [st.address, st.poBox ? 'P.O. Box ' + st.poBox : '', st.phone, st.email].filter(Boolean).join(' · ');
  return `<div style="text-align:center;border-bottom:3px double ${brand};padding-bottom:10px;margin-bottom:14px;position:relative">
    ${st.logo ? `<img src="${st.logo}" alt="" style="position:absolute;left:0;top:0;width:64px;height:64px;object-fit:contain">` : ''}
    <h1 style="font-family:Georgia,serif;font-size:23px;font-weight:700;color:${brand};margin:0;text-transform:uppercase;letter-spacing:0.02em">${escapeHtml(st.schoolName)}</h1>
    ${st.motto ? `<p style="font-size:11px;color:#555;margin:2px 0;font-style:italic">${escapeHtml(st.motto)}</p>` : ''}
    <p style="font-size:11px;color:#555;margin:2px 0">${escapeHtml(contact)}</p>
    <p style="font-size:12px;color:${brand};font-weight:700;margin:6px 0 0;letter-spacing:0.08em;text-transform:uppercase">${subtitle}</p>
  </div>`;
}
function printDoc(html) {
  el('printArea').innerHTML = `<div class="doc">${html}</div>`;
  el('printArea').style.display = 'block';
  window.print();
  el('printArea').style.display = 'none';
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
  state.competitions.push({ id: 'CMP' + uid().slice(0, 5), ...f });
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
        state.squads.push({ id: 'SQD' + uid().slice(0, 5), name, sport, members, createdAt: todayISO() });
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
  body.innerHTML = athletes.length ? athletes.map(s => { const p = s.athleteProfile || {}; const inj = p.injuryStatus || 'Fit'; return `<tr><td style="font-weight:600">${escapeHtml(s.name)}</td><td>${escapeHtml(s.class)}</td><td>${escapeHtml(s.sport)}</td><td>${escapeHtml(p.position || '—')}</td><td>${p.height ? escapeHtml(p.height) + 'cm' : '—'}</td><td>${p.weight ? escapeHtml(p.weight) + 'kg' : '—'}</td><td style="color:var(--brand);font-weight:600">${escapeHtml(p.personalBest || '—')}</td><td><span class="badge ${ic[inj] || 'badge-neutral'}">${escapeHtml(inj)}</span></td><td>${can('canLogPerformance') ? `<button class="btn btn-outline btn-xs" data-act="athleteProfile" data-id="${escapeHtml(s.id)}">Edit</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="9" class="empty">No athlete profiles.</td></tr>';
}

/* ── Notices ───────────────────────────────────────────────────────────── */
function postNotice(f) {
  if (!can('canPostNotice')) return toast('You do not have permission.', 'error');
  if (!f.title || !f.title.trim()) return toast('Notice title is required.', 'error');
  state.notices.unshift({ id: 'NTC' + uid().slice(0, 5), title: f.title.trim(), body: (f.body || '').trim(), category: f.category, postedBy: currentSession.displayName, postedAt: nowISO() });
  if (state.notices.length > 50) state.notices = state.notices.slice(0, 50);
  saveState(); renderAll();
  toast('Notice posted.', 'success');
}
async function deleteNotice(id) { if (!await confirmDialog({ title: 'Delete notice', message: 'Delete this notice?', confirmLabel: 'Delete', danger: true })) return; state.notices = state.notices.filter(n => n.id !== id); saveState(); renderAll(); }
function renderNotices() {
  const grid = el('noticesGrid'); if (!grid) return;
  const formCard = el('noticeFormCard');
  if (formCard) formCard.style.display = can('canPostNotice') ? '' : 'none';
  grid.innerHTML = state.notices.length ? state.notices.map(n => `<div class="notice-item cat-${escapeHtml(n.category)}"><div style="display:flex;justify-content:space-between;gap:10px"><div style="flex:1"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span class="badge badge-neutral">${escapeHtml(n.category)}</span><span class="card-desc">${n.postedAt ? new Date(n.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span></div><div style="font-weight:700">${escapeHtml(n.title)}</div>${n.body ? `<div class="card-desc" style="white-space:pre-wrap;margin-top:4px">${escapeHtml(n.body)}</div>` : ''}<div class="card-desc" style="margin-top:6px">Posted by ${escapeHtml(n.postedBy)}</div></div>${can('canPostNotice') ? `<button class="btn-icon" data-act="deleteNotice" data-id="${escapeHtml(n.id)}" title="Delete">${icon('trash', 15)}</button>` : ''}</div></div>`).join('') : '<div class="empty">No notices posted yet.</div>';
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
   Modal system (confirm / prompt / generic)
   ========================================================================= */
let modalResolver = null;
function openModal({ title, bodyHtml, footHtml, wide, onOpen, locked }) {
  const host = el('modalHost');
  // A locked modal (forced password change) cannot be dismissed by ✕, Escape or backdrop.
  host.innerHTML = `<div class="modal-overlay"${locked ? ' data-locked' : ''}><div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><div><h3>${title}</h3></div>${locked ? '' : `<button class="modal-close" data-modal-close aria-label="Close">${icon('x', 20)}</button>`}</div>
    <div class="modal-body">${bodyHtml}</div>
    ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
  </div></div>`;
  const overlay = host.querySelector('.modal-overlay');
  if (!locked) overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(); });
  const root = host.querySelector('.modal');
  if (onOpen) onOpen(root);
  // Focus straight away. A delayed focus can jump the cursor back to the first
  // field while someone is already typing in another one.
  const focusable = root.querySelector('input, select, textarea, button');
  if (focusable && !root.contains(document.activeElement)) focusable.focus();
}
function closeModal() { el('modalHost').innerHTML = ''; if (modalResolver) { const r = modalResolver; modalResolver = null; r(null); } }

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    openModal({
      title,
      bodyHtml: `<p style="font-size:14px;color:var(--muted);margin:0">${escapeHtml(message)}</p>`,
      footHtml: `<button class="btn btn-ghost" id="mdCancel">Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="mdOk">${escapeHtml(confirmLabel)}</button>`,
      onOpen(root) {
        root.querySelector('#mdCancel').addEventListener('click', () => { cleanup(); resolve(false); });
        root.querySelector('#mdOk').addEventListener('click', () => { cleanup(); resolve(true); });
      },
    });
    function cleanup() { modalResolver = null; el('modalHost').innerHTML = ''; }
    modalResolver = () => resolve(false);
  });
}
function promptDialog({ title, label, value = '', type = 'text' }) {
  return new Promise(resolve => {
    openModal({
      title,
      bodyHtml: `<label class="form-label">${escapeHtml(label)}</label><input class="input" id="mdInput" type="${type}" value="${escapeHtml(value)}">`,
      footHtml: `<button class="btn btn-ghost" id="mdCancel">Cancel</button><button class="btn btn-primary" id="mdOk">Save</button>`,
      onOpen(root) {
        const input = root.querySelector('#mdInput');
        root.querySelector('#mdCancel').addEventListener('click', () => { cleanup(); resolve(null); });
        root.querySelector('#mdOk').addEventListener('click', () => { const v = input.value; cleanup(); resolve(v); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value; cleanup(); resolve(v); } });
      },
    });
    function cleanup() { modalResolver = null; el('modalHost').innerHTML = ''; }
    modalResolver = () => resolve(null);
  });
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
  register: [['daily', 'Daily register'], ['recent', 'Recent registers']],
  academics: [['marks', 'Enter marks'], ['marksheet', 'Mark sheet', 'canAddAcademic'], ['comments', 'Comments', 'canAddAcademic'], ['reportcards', 'Report cards'], ['grading', 'Grading scales', 'canManageSettings']],
  payments: [['record', 'Record payment'], ['dashboard', 'Fees dashboard'], ['terms', 'Terms & fee structures', 'canManageTerms'], ['bursaries', 'Bursaries', 'canAwardBursary']],
  sports: [['programmes', 'Programmes'], ['training', 'Training attendance'], ['competitions', 'Competitions & squads'], ['athletes', 'Athletes'], ['candidates', 'Bursary candidates']],
  reports: [['statistics', 'Statistics'], ['emis', 'EMIS', 'canViewEMIS']],
  admin: [['staff', 'Staff accounts', 'canManageUsers'], ['profile', 'School profile & logo', 'canManageSettings'], ['data', 'Data & backup']],
};
let currentTab = null;
const lastSub = {};
function allowedSubs(tab) { return (SUB_TABS[tab] || []).filter(([, , perm]) => !perm || can(perm)); }
function buildNav(tabs) {
  const nav = el('navBar');
  nav.innerHTML = tabs.map(t => `<button class="nav-tab" data-tab="${t}">${icon(t, 16)}<span>${TAB_LABELS[t] || t}</span></button>`).join('');
}
function switchTab(tab, sub) {
  if (!hasTab(tab)) { toast('You do not have access to that section.', 'error'); return; }
  currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = el('panel-' + tab);
  if (panel) panel.classList.add('active');
  showSub(tab, sub);
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
}

/* ── What's new (dashboard) ────────────────────────────────────────────── */
/* Points directors at the capabilities added in this release. Hiding it is
   remembered on this device only. */
const WHATS_NEW_RELEASE = '2026-11';
const WHATS_NEW_KEY = 'ksa_whatsnew_hidden';
const WHATS_NEW = [
  ['register/daily', 'Attendance', 'Daily class register', 'Mark every class present, absent, late or excused in a minute, then message the guardians of absent learners.'],
  ['academics/marksheet', 'Academics', 'Class mark sheet', "Enter a whole class's marks for one subject on one screen."],
  ['academics/reportcards', 'Academics', 'Report cards', 'Positions, teacher and head-teacher comments, and Uganda grading from PLE to A Level. Print a whole class at once.'],
  ['payments/terms', 'Fees', 'Terms & fee structures', 'Open a term and every learner is billed from the fee structure. Unpaid balances carry forward as arrears.'],
  ['payments/dashboard', 'Fees', 'Fees dashboard', 'Collection rate, arrears, top defaulters and fees by class, with one-tap reminders to guardians.'],
  ['payments/bursaries', 'Fees', 'Bursaries for any learner', 'Needs-based, staff, academic or sports bursaries. The bill adjusts itself.'],
  ['directory/import', 'Students', 'Import from Excel', 'Bring your learners in from a spreadsheet instead of typing them one by one.'],
  ['admin/staff', 'Administration', 'Staff accounts', 'Teachers, the bursar and the head of sports each sign in separately and see only their part.'],
  ['admin/profile', 'Administration', 'Your badge and colours', 'Your logo and school colours on receipts, report cards and the sign-in screen.'],
];
function whatsNewHidden() {
  try { return localStorage.getItem(WHATS_NEW_KEY) === WHATS_NEW_RELEASE; } catch (_) { return false; }
}
function renderWhatsNew() {
  const card = el('whatsNewCard'), list = el('whatsNewList');
  if (!card || !list) return;
  const items = WHATS_NEW.filter(([to]) => { const [tab, sub] = to.split('/'); return hasTab(tab) && allowedSubs(tab).some(s => s[0] === sub); });
  card.style.display = items.length && !whatsNewHidden() ? '' : 'none';
  list.innerHTML = items.map(([to, where, title, desc]) => `<div class="wn-item">
      <div class="wn-where">${escapeHtml(where)}</div><div class="wn-title">${escapeHtml(title)}</div><div class="wn-desc">${escapeHtml(desc)}</div>
      <button class="btn btn-outline btn-xs" type="button" data-act="goto" data-to="${escapeHtml(to)}">Open ${icon('right', 13)}</button>
    </div>`).join('');
}
function hideWhatsNew() {
  try { localStorage.setItem(WHATS_NEW_KEY, WHATS_NEW_RELEASE); } catch (_) {}
  const card = el('whatsNewCard'); if (card) card.style.display = 'none';
}

/* =========================================================================
   Event delegation — all data-act clicks route through here
   ========================================================================= */
const ACTIONS = {
  reportCard: d => openReportCard(d.id),
  feeReceipt: d => printFeeReceipt(d.id),
  smsBalance: d => smsBalance(d.id),
  waBalance: d => whatsappBalance(d.id),
  smsConduct: d => smsConduct(d.id),
  editStudent: d => openStudentEdit(d.id),
  deleteStudent: d => deleteStudent(d.id),
  notes: d => openNotes(d.id),
  academic: d => openAcademic(d.id),
  voidPayment: async d => { const r = await promptDialog({ title: 'Reverse payment', label: 'Reason for reversal', type: 'text' }); if (r !== null) voidPayment(d.id, r); },
  deleteProgram: d => deleteProgram(d.id),
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
  dismissWhatsNew: () => hideWhatsNew(),
};
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
  bind('registerForm', (f, form) => { registerStudent(f); form.reset(); });
  bind('paymentForm', (f, form) => { recordPayment(f); form.reset(); el('balancePreview').style.display = 'none'; });
  bind('programForm', (f, form) => { f.days = new FormData(form).getAll('days'); addProgram(f); form.reset(); });
  bind('performanceForm', (f, form) => { logPerformance(f); form.reset(); });
  bind('conductForm', (f, form) => { f.notifyGuardian = form.notifyGuardian.checked; addConduct(f); form.reset(); });
  bind('noticeForm', (f, form) => { postNotice(f); form.reset(); });
  bind('settingsForm', (f) => { saveSettings(f); });

  const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
  on('searchInput', 'input', () => { studentPage = 1; renderStudentTable(); });
  on('levelFilter', 'change', () => { studentPage = 1; renderStudentTable(); });
  on('sportFilter', 'change', renderPerformanceTable);
  on('conductFilter', 'change', renderConductTable);
  on('compSportFilter', 'change', renderCompetitionsTable);
  on('compSeasonFilter', 'change', renderCompetitionsTable);
  on('athleteProfileFilter', 'change', renderAthleteProfiles);
  on('bulkSmsBtn', 'click', openBulkSms);
  on('paymentStudent', 'change', updateBalancePreview);
  on('attendanceProgram', 'change', renderAttendanceRoster);
  on('attendanceDate', 'change', renderAttendanceRoster);
  on('addCompetitionBtn', 'click', openCompetitionForm);
  on('addSquadBtn', 'click', openSquadForm);
  on('exportEmisBtn', 'click', exportEMIS);

  on('saveAttendanceBtn', 'click', () => {
    const programId = el('attendanceProgram').value;
    const date = el('attendanceDate').value || todayISO();
    if (!programId) return toast('Choose a program first.', 'error');
    const boxes = document.querySelectorAll('#attendanceRoster .att-toggle');
    if (!boxes.length) return toast('No athletes to mark.', 'error');
    saveAttendance(programId, date, Array.from(boxes).map(cb => ({ studentId: cb.dataset.student, present: cb.checked })));
  });

  // Live present/absent labels in the roster.
  const roster = el('attendanceRoster');
  if (roster) roster.addEventListener('change', e => {
    if (!e.target.classList.contains('att-toggle')) return;
    const lbl = roster.querySelector(`.att-state[data-for="${CSS.escape(e.target.dataset.student)}"]`);
    if (lbl) { lbl.textContent = e.target.checked ? 'Present' : 'Absent'; lbl.style.color = e.target.checked ? 'var(--success)' : 'var(--faint)'; }
  });

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
  show('academicFormCard', can('canAddAcademic'));
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
  const session = AUTH.getSession();
  if (session) { currentSession = session; initApp(); }
  else el('authScreen').style.display = 'grid';
});

window.KSA = { state: () => state, exportLedger };
