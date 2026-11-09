/* =========================================================================
   core.js — helpers shared by the staff app (index.html) and the parent
   portal (parent.html): the in-memory school, formatting, icons, printing,
   dialogs, and the ACTIONS / MODULES registries that the feature files fill.
   Nothing here touches staff sign-in, storage or a particular page's layout.
   ========================================================================= */
'use strict';

const SCHEMA_VERSION = 5;

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

const CLASS_OPTIONS = ['Baby Class', 'Middle Class', 'Top Class', 'P.1', 'P.2', 'P.3', 'P.4', 'P.5', 'P.6', 'P.7', 'S.1', 'S.2', 'S.3', 'S.4', 'S.5', 'S.6'];

/* ── State ─────────────────────────────────────────────────────────────── */
let state = freshState();
/* Feature modules (billing.js, academics.js, register.js, tools.js) register
   here: { name, setup(), render(), afterSave() }. */
const MODULES = [];
/* Click handlers for data-act="…" buttons. Each page and feature file adds
   its own with Object.assign(ACTIONS, { … }). */
const ACTIONS = {};

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
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
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
/* An id for a new record: the prefix and 12 random hex digits. Marks and
   registers run to tens of thousands a year, so the 5–6 digits used before
   would, sooner or later, give two records the same id (and online the
   second would overwrite the first). Existing ids are kept as they are. */
function newId(prefix) {
  const hex = crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return prefix + hex.slice(0, 12).toUpperCase();
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString(); }
/* Dates are kept as YYYY-MM-DD (UTC, like todayISO). addDaysISO('2026-11-05', -6)
   is '2026-10-30'; fmtDay('2026-11-05') is 'Thu 5 Nov 2026' (no year if year=false). */
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* A learner's name that opens their learner page (learner.js), optionally
   at one section (e.g. 'fees'). */
function learnerLink(id, name, section) {
  return `<button type="button" class="link-btn" data-act="learner" data-id="${escapeHtml(id)}"${section ? ` data-section="${escapeHtml(section)}"` : ''}>${escapeHtml(name)}</button>`;
}
/* Classes in school order (Baby Class … S.6); a class the app does not know goes last. */
function classRank(c) { const i = CLASS_OPTIONS.indexOf(c); return i < 0 ? 999 : i; }
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(iso, year = true) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}`;
}
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
function normalizePhone(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('256')) return '+' + d;
  if (d.startsWith('0') && d.length === 10) return '+256' + d.slice(1);
  return d;
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
/* message: an optional paragraph above the box (e.g. what is being changed). */
function promptDialog({ title, label, value = '', type = 'text', message = '', okLabel = 'Save', danger = false }) {
  return new Promise(resolve => {
    openModal({
      title,
      bodyHtml: `${message ? `<p style="font-size:14px;margin:0 0 12px">${escapeHtml(message)}</p>` : ''}<label class="form-label" for="mdInput">${escapeHtml(label)}</label><input class="input" id="mdInput" type="${type}" value="${escapeHtml(value)}">`,
      footHtml: `<button class="btn btn-ghost" id="mdCancel">Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="mdOk">${escapeHtml(okLabel)}</button>`,
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
