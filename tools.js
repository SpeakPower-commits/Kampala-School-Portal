/* =========================================================================
   tools.js — CSV import/export, school branding (logo + colours) and
   automatic daily snapshots.
   ========================================================================= */
'use strict';

/* ── CSV helpers ───────────────────────────────────────────────────────── */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
/* Quote every cell, and neutralise values Excel would run as formulas. */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function downloadCSV(filename, rows) {
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

/* ── Learner import ────────────────────────────────────────────────────── */
const IMPORT_COLUMNS = ['admission_no', 'name', 'class', 'stream', 'gender', 'guardian_phone', 'termly_fee', 'boarding', 'uneb_index', 'special_needs', 'sport', 'opening_balance'];

function downloadImportTemplate() {
  downloadCSV('learners-import-template.csv', [
    IMPORT_COLUMNS,
    ['KSA/2026/0001', 'Nakato Sarah', 'S.2', 'East', 'Female', '0772123456', '650000', 'Day', '', '', 'Netball', '0'],
    ['', 'Okello John', 'P.6', '', 'Male', '0701234567', '450000', 'Boarding', '', '', '', '120000'],
  ]);
}
function normaliseClass(v) {
  const t = String(v || '').trim();
  const m = /^([PpSs])\s*\.?\s*(\d)$/.exec(t);
  if (m) return m[1].toUpperCase() + '.' + m[2];
  const pre = CLASS_OPTIONS.find(c => c.toLowerCase() === t.toLowerCase());
  return pre || t;
}
function normaliseGender(v) {
  const t = String(v || '').trim().toLowerCase();
  if (['m', 'male', 'boy'].includes(t)) return 'Male';
  if (['f', 'female', 'girl'].includes(t)) return 'Female';
  return t ? null : '';
}
function normaliseBoarding(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t || ['day', 'd', 'day scholar'].includes(t)) return 'Day';
  if (['boarding', 'boarder', 'b'].includes(t)) return 'Boarding';
  if (['weekly', 'w', 'weekly boarder'].includes(t)) return 'Weekly';
  return null;
}
function parseAmount(v) {
  const t = String(v || '').replace(/[,\s]|UGX/gi, '');
  if (t === '') return 0;
  const n = Number(t);
  return isNaN(n) || n < 0 ? null : Math.round(n);
}
function validateImport(rows) {
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ['name', 'class', 'guardian_phone'].filter(c => !header.includes(c));
  if (missing.length) throw new Error('The file is missing these columns: ' + missing.join(', ') + '. Download the template to see the layout.');
  const ids = new Set(state.students.map(s => s.id.toLowerCase()));
  return rows.slice(1).map((cells, i) => {
    const get = k => { const idx = header.indexOf(k); return idx >= 0 ? String(cells[idx] || '').trim() : ''; };
    const errors = [];
    const rec = {
      admissionNo: get('admission_no'), name: get('name'), class: normaliseClass(get('class')), stream: get('stream'),
      gender: normaliseGender(get('gender')), guardian: get('guardian_phone'), fee: parseAmount(get('termly_fee')),
      boardingStatus: normaliseBoarding(get('boarding')), unebIndexNo: get('uneb_index'), senFlag: get('special_needs'),
      sport: get('sport'), opening: parseAmount(get('opening_balance')),
    };
    if (!rec.name) errors.push('name missing');
    if (!CLASS_OPTIONS.includes(rec.class)) errors.push(`class "${get('class')}" not recognised`);
    if (!phoneValid(rec.guardian)) errors.push('guardian phone not a valid Ugandan number');
    if (rec.gender === null) errors.push('gender must be Male or Female');
    if (rec.boardingStatus === null) errors.push('boarding must be Day, Boarding or Weekly');
    if (rec.fee === null) errors.push('termly fee is not a number');
    if (rec.opening === null) errors.push('opening balance is not a number');
    if (rec.admissionNo) {
      if (!ADMISSION_RE.test(rec.admissionNo)) errors.push('admission no. has invalid characters');
      else if (ids.has(rec.admissionNo.toLowerCase())) errors.push('admission no. already used');
      else ids.add(rec.admissionNo.toLowerCase());
    }
    return { line: i + 2, rec, errors };
  });
}
function importLearnersFile(file) {
  if (!can('canRegisterStudent')) return toast('You do not have permission to add learners.', 'error');
  const reader = new FileReader();
  reader.onload = e => {
    let checked;
    try {
      const rows = parseCSV(String(e.target.result));
      if (rows.length < 2) return toast('The file has no learner rows.', 'error');
      checked = validateImport(rows);
    } catch (err) { return toast(err.message || 'Could not read that file.', 'error'); }
    const good = checked.filter(r => !r.errors.length);
    const bad = checked.filter(r => r.errors.length);
    openModal({
      title: 'Import learners', wide: true,
      bodyHtml: `<div class="banner ${bad.length ? 'banner-warn' : 'banner-success'}" style="margin-bottom:12px">${icon(bad.length ? 'alert' : 'check')}<span><strong>${good.length}</strong> ready to import${bad.length ? ` · <strong>${bad.length}</strong> with problems (skipped — fix them in the file and import again)` : ''}.</span></div>
        <div class="table-wrap" style="max-height:380px;overflow:auto"><table><thead><tr><th>Line</th><th>Name</th><th>Class</th><th>Guardian</th><th class="t-num">Fee</th><th class="t-num">Opening bal.</th><th>Status</th></tr></thead><tbody>
        ${checked.slice(0, 300).map(r => `<tr><td class="t-muted">${r.line}</td><td>${escapeHtml(r.rec.name)}</td><td>${escapeHtml(r.rec.class)}${r.rec.stream ? ' ' + escapeHtml(r.rec.stream) : ''}</td><td>${escapeHtml(r.rec.guardian)}</td><td class="t-num">${r.rec.fee === null ? '—' : fmtMoney(r.rec.fee)}</td><td class="t-num">${r.rec.opening ? fmtMoney(r.rec.opening) : '—'}</td>
          <td>${r.errors.length ? `<span class="badge badge-danger">${escapeHtml(r.errors.join('; '))}</span>` : '<span class="badge badge-success">OK</span>'}</td></tr>`).join('')}
        </tbody></table></div>`,
      footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="importGo" ${good.length ? '' : 'disabled'}>Import ${good.length} learner${good.length === 1 ? '' : 's'}</button>`,
      onOpen(root) {
        root.querySelector('#importGo').addEventListener('click', () => { commitImport(good.map(r => r.rec)); closeModal(); });
      },
    });
  };
  reader.readAsText(file);
}
function commitImport(recs) {
  recs.forEach(r => {
    const id = r.admissionNo || 'S' + uid().slice(0, 6);
    const s = {
      id, name: r.name, class: r.class, stream: r.stream, level: classifyLevel(r.class), combination: '',
      guardian: r.guardian, fee: r.fee || 0, paid: 0, sport: r.sport, skillLevel: '', gender: r.gender || '',
      boardingStatus: r.boardingStatus, unebIndexNo: r.unebIndexNo, senFlag: r.senFlag,
      performanceNotes: [], academics: [], bursaryPct: 0, feeComponents: [], injuryLog: [], athleteProfile: {}, comments: {},
      createdAt: todayISO(),
    };
    state.students.push(s);
    billStudentForCurrentTerm(s);
    if (r.opening > 0) {
      const inv = { id: 'INV' + uid(), studentId: id, termId: null, lines: [{ name: 'Balance brought forward', amount: r.opening }], bursaryPct: 0, installments: [], createdAt: todayISO() };
      computeInvoiceTotals(inv);
      state.invoices.push(inv);
    }
  });
  recomputePaid(); saveState(); renderAll();
  AUTH.audit('STUDENT_IMPORT', `${recs.length} learners`);
  toast(`Imported ${recs.length} learner${recs.length === 1 ? '' : 's'}.`, 'success');
}

/* ── Exports ───────────────────────────────────────────────────────────── */
function exportLearnersCSV(onlyDefaulters) {
  if (!can('canExport')) return toast('You do not have permission to export.', 'error');
  let list = state.students.map(s => ({ s, a: studentAccount(s) }));
  if (onlyDefaulters) list = list.filter(x => x.a.balance > 0).sort((a, b) => b.a.balance - a.a.balance);
  downloadCSV(`${onlyDefaulters ? 'defaulters' : 'learners'}-${todayISO()}.csv`, [
    ['admission_no', 'name', 'class', 'stream', 'gender', 'guardian_phone', 'boarding', 'uneb_index', 'special_needs', 'sport', 'arrears', 'this_term_due', 'total_balance'],
    ...list.map(({ s, a }) => [s.id, s.name, s.class, s.stream || '', s.gender, s.guardian, s.boardingStatus, s.unebIndexNo, s.senFlag, s.sport, a.arrears, a.currentDue, a.balance]),
  ]);
  toast(onlyDefaulters ? `Exported ${list.length} defaulters.` : `Exported ${list.length} learners.`, 'success');
}
function exportPaymentsCSV() {
  if (!can('canExport')) return toast('You do not have permission to export.', 'error');
  const rows = [...state.payments].sort((a, b) => a.date.localeCompare(b.date)).map(p => {
    const s = state.students.find(x => x.id === p.studentId);
    return [p.date, p.id, p.studentId, s ? s.name : '', s ? s.class : '', p.amount, p.method || 'Cash', p.reference || '', p.recordedByName || '', p.void ? 'Reversed: ' + (p.voidReason || '') : 'Valid'];
  });
  downloadCSV(`payments-${todayISO()}.csv`, [['date', 'receipt_no', 'admission_no', 'name', 'class', 'amount', 'method', 'reference', 'recorded_by', 'status'], ...rows]);
  toast(`Exported ${rows.length} payments.`, 'success');
}

/* ── Branding ──────────────────────────────────────────────────────────── */
const BRAND_PRESETS = [
  { id: 'green', name: 'Forest green', brand: '#0b5d3b', dark: '#08472d', deep: '#0a3d29' },
  { id: 'maroon', name: 'Maroon', brand: '#7a1f2b', dark: '#5e1620', deep: '#4a111a' },
  { id: 'navy', name: 'Navy', brand: '#1e3a5f', dark: '#162c48', deep: '#10223a' },
  { id: 'blue', name: 'Royal blue', brand: '#1d4ed8', dark: '#1e40af', deep: '#1e3a8a' },
  { id: 'purple', name: 'Purple', brand: '#5b21b6', dark: '#4c1d95', deep: '#3b1675' },
  { id: 'black', name: 'Black', brand: '#262626', dark: '#171717', deep: '#0a0a0a' },
];
function brandPreset() { const id = state.settings && state.settings.brandPreset; return BRAND_PRESETS.find(p => p.id === id) || BRAND_PRESETS[0]; }
function applyBranding() {
  const p = brandPreset();
  const root = document.documentElement.style;
  root.setProperty('--brand', p.brand); root.setProperty('--brand-dark', p.dark); root.setProperty('--brand-800', p.deep);
  state.settings.brandColor = p.brand;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', p.brand);
  const logo = state.settings.logo;
  ['brandCrest', 'topCrest'].forEach(id => {
    const box = el(id); if (!box) return;
    if (logo) { box.innerHTML = ''; const img = document.createElement('img'); img.src = logo; img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:6px;background:#fff'; box.appendChild(img); }
    else box.innerHTML = crestSVG();
  });
  const preview = el('logoPreview');
  if (preview) preview.innerHTML = logo ? `<img src="${logo}" alt="School logo" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">` : '<span class="card-desc">No logo — the crest is used.</span>';
  const removeBtn = el('logoRemoveBtn'); if (removeBtn) removeBtn.style.display = logo ? '' : 'none';
  const swatches = el('brandSwatches');
  if (swatches) swatches.innerHTML = BRAND_PRESETS.map(b => `<label class="swatch" title="${b.name}"><input type="radio" name="brandPreset" value="${b.id}" ${b.id === p.id ? 'checked' : ''}><span style="background:${b.brand}"></span>${b.name}</label>`).join('');
}
function uploadLogo(file) {
  if (!can('canManageSettings')) return toast('You do not have permission.', 'error');
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Use a PNG, JPG or WEBP image.', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('That image is larger than 5 MB.', 'error');
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const max = 240, scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/png');
      if (data.length > 140000) {
        const flat = document.createElement('canvas'); flat.width = canvas.width; flat.height = canvas.height;
        const fctx = flat.getContext('2d'); fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, flat.width, flat.height); fctx.drawImage(canvas, 0, 0);
        data = flat.toDataURL('image/jpeg', 0.85);
      }
      if (data.length > 200000) return toast('That logo is too detailed to store. Try a simpler image.', 'error');
      state.settings.logo = data;
      if (saveState()) { applyBranding(); AUTH.audit('LOGO_UPDATE', ''); toast('Logo saved.', 'success'); }
    };
    img.onerror = () => toast('That file could not be read as an image.', 'error');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function removeLogo() { delete state.settings.logo; saveState(); applyBranding(); toast('Logo removed.', 'success'); }

/* ── Daily snapshots (IndexedDB) ───────────────────────────────────────── */
/* One copy of the school's data per day, last 7 days, on this device only.
   Protects against mistakes (a wrong reset or import) — not against losing the
   device. Keep exporting backups. */
const SNAP_DB = 'school-portal-snapshots', SNAP_STORE = 'snapshots', SNAP_KEEP = 7;
function snapDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(SNAP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SNAP_STORE, { keyPath: 'date' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function snapTx(mode, fn) {
  return snapDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAP_STORE, mode);
    const out = fn(tx.objectStore(SNAP_STORE));
    tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    tx.onerror = () => reject(tx.error);
  }));
}
async function takeDailySnapshot() {
  const today = todayISO();
  let last = null;
  try { last = localStorage.getItem('ksa_last_snapshot'); } catch (_) {}
  if (last === today || !state.students.length) return;
  try {
    await snapTx('readwrite', store => store.put({ date: today, ts: nowISO(), learners: state.students.length, data: JSON.stringify(state) }));
    const keys = await snapTx('readonly', store => store.getAllKeys());
    const old = (keys || []).sort().slice(0, Math.max(0, (keys || []).length - SNAP_KEEP));
    if (old.length) await snapTx('readwrite', store => old.forEach(k => store.delete(k)));
    try { localStorage.setItem('ksa_last_snapshot', today); } catch (_) {}
  } catch (_) { /* snapshots are best-effort */ }
}
async function openSnapshots() {
  if (!can('canImport')) return toast('You do not have permission to restore data.', 'error');
  let list = [];
  try { list = await snapTx('readonly', store => store.getAll()); } catch (_) { return toast('Snapshots are not available in this browser.', 'error'); }
  list = (list || []).sort((a, b) => b.date.localeCompare(a.date));
  openModal({
    title: 'Restore a daily snapshot',
    bodyHtml: `<p class="card-desc" style="margin-bottom:12px">The portal keeps one copy of your data per day for the last ${SNAP_KEEP} days, on this device only. Restoring replaces everything with that day's copy.</p>
      ${list.length ? list.map(s => `<div class="roster-item"><div><div style="font-weight:600">${escapeHtml(s.date)}</div><div class="card-desc">${s.learners} learners · ${Math.round(s.data.length / 1024)} KB · saved ${escapeHtml(s.ts.slice(11, 16))}</div></div><button class="btn btn-outline btn-xs" data-snap="${escapeHtml(s.date)}">Restore</button></div>`).join('') : '<p class="empty">No snapshots yet. One is taken automatically each day the portal is used.</p>'}`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>`,
    onOpen(root) {
      root.addEventListener('click', async e => {
        const b = e.target.closest('[data-snap]'); if (!b) return;
        const snap = list.find(s => s.date === b.dataset.snap); if (!snap) return;
        closeModal();
        const ok = await confirmDialog({ title: 'Restore snapshot', message: `Replace all current data with the copy from ${snap.date}? Anything entered since then will be lost.`, confirmLabel: 'Restore snapshot', danger: true });
        if (!ok) return;
        state = migrate(JSON.parse(snap.data)); recomputePaid(); recomputeGrades();
        saveState(); applySettings(); renderAll();
        AUTH.audit('SNAPSHOT_RESTORE', snap.date);
        toast(`Restored the snapshot from ${snap.date}.`, 'success');
      });
    },
  });
}

/* ── Wiring ────────────────────────────────────────────────────────────── */
MODULES.push({
  name: 'tools',
  setup() {
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('importTemplateBtn', 'click', downloadImportTemplate);
    on('importLearnersInput', 'change', e => { if (e.target.files[0]) importLearnersFile(e.target.files[0]); e.target.value = ''; });
    on('exportLearnersBtn', 'click', () => exportLearnersCSV(false));
    on('exportDefaultersBtn', 'click', () => exportLearnersCSV(true));
    on('exportDefaultersBtn2', 'click', () => exportLearnersCSV(true));
    on('exportPaymentsBtn', 'click', exportPaymentsCSV);
    on('logoInput', 'change', e => { if (e.target.files[0]) uploadLogo(e.target.files[0]); e.target.value = ''; });
    on('logoRemoveBtn', 'click', removeLogo);
    on('snapshotsBtn', 'click', openSnapshots);
    takeDailySnapshot();
  },
  render() { applyBranding(); },
  afterSave() { if (!ONLINE_EDITION) takeDailySnapshot(); },   // online, the school database is backed up instead
});
