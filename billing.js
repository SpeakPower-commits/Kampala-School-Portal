/* =========================================================================
   billing.js — terms, fee structures, per-term invoices, arrears,
   receipts and the finance dashboard.

   Model
   - A term is { id, year, term: 'Term 1'|'Term 2'|'Term 3', startDate, endDate,
     isActive, openedAt }.
   - A fee structure belongs to one term and applies to a class (e.g. "S.2"),
     a level (e.g. "O Level") or "All". Items can apply to all learners,
     boarders only or day scholars only. An optional installment schedule
     splits the bill by percentage and due date.
   - Every learner gets one invoice per term, built from the matching fee
     structure (or their own "Termly tuition" when no structure exists).
     Bursaries are applied as a discount on the invoice.
   - Payments are not tied to a term. They are allocated oldest invoice first
     (FIFO), so unpaid amounts from earlier terms show as arrears.
   ========================================================================= */
'use strict';

/* ── Terms ─────────────────────────────────────────────────────────────── */
const TERM_NAMES = ['Term 1', 'Term 2', 'Term 3'];

function termById(id) { return id ? (state.terms.find(t => t.id === id) || null) : null; }
function termNumber(t) { const m = /(\d)/.exec((t && t.term) || ''); return m ? Number(m[1]) : 0; }
/* Sort key: opening balances (no term) first, then by year and term number. */
function termOrderKey(termOrId) {
  const t = typeof termOrId === 'string' ? termById(termOrId) : termOrId;
  if (!t) return -1;
  return Number(t.year || 0) * 10 + termNumber(t);
}
function termLabel(t) { return t ? `${t.term} ${t.year}` : 'Opening balance'; }
function termsInOrder() { return [...state.terms].sort((a, b) => termOrderKey(a) - termOrderKey(b)); }
function getCurrentTerm() { return state.terms.find(t => t.isActive) || termsInOrder().pop() || null; }
function nextTermOf(t) {
  if (!t) return null;
  return termsInOrder().find(x => termOrderKey(x) > termOrderKey(t)) || null;
}
/* Uganda's school year: Term 1 Feb–Apr, Term 2 May–Aug, Term 3 Sep–Dec. */
function guessTermForDate(date) {
  const m = date.getMonth() + 1;
  return m <= 4 ? 'Term 1' : m <= 8 ? 'Term 2' : 'Term 3';
}
/* Make sure there is always a current term, so every learner can be billed. */
function ensureDefaultTerm(data) {
  if (data.terms && data.terms.length) {
    if (!data.terms.some(t => t.isActive)) {
      const last = [...data.terms].sort((a, b) => (Number(a.year) * 10 + termNumber(a)) - (Number(b.year) * 10 + termNumber(b))).pop();
      last.isActive = true;
    }
    return;
  }
  const now = new Date();
  data.terms = [{ id: 'TRM' + uid().slice(0, 5), year: String(now.getFullYear()), term: guessTermForDate(now), startDate: '', endDate: '', isActive: true, openedAt: nowISO() }];
}

/* ── Fee structures ────────────────────────────────────────────────────── */
function isBoarder(s) { return s.boardingStatus === 'Boarding' || s.boardingStatus === 'Weekly'; }
function structureFor(s, termId) {
  const list = state.feeStructures.filter(f => f.termId === termId);
  return list.find(f => f.appliesTo === s.class) || list.find(f => f.appliesTo === s.level) || list.find(f => f.appliesTo === 'All') || null;
}
function structureItemsFor(st, s) {
  return st.items.filter(i => i.who === 'all' || (i.who === 'boarders' && isBoarder(s)) || (i.who === 'day' && !isBoarder(s)));
}
function structureTotal(st, boarder) {
  return st.items.filter(i => i.who === 'all' || (i.who === 'boarders' && boarder) || (i.who === 'day' && !boarder)).reduce((a, i) => a + Number(i.amount || 0), 0);
}

/* ── Invoices ──────────────────────────────────────────────────────────── */
function computeInvoiceTotals(inv) {
  inv.gross = inv.lines.reduce((a, l) => a + Number(l.amount || 0), 0);
  // Same rounding as v4's effectiveFee() so migrated balances match exactly.
  inv.total = Math.round(inv.gross * (1 - (inv.bursaryPct || 0) / 100));
  inv.discount = inv.gross - inv.total;
}
function scheduleFor(structure, total) {
  const plan = structure && Array.isArray(structure.installments) ? structure.installments.filter(i => i.dueDate && Number(i.pct) > 0) : [];
  if (!plan.length) return [];
  const sorted = [...plan].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let allocated = 0;
  return sorted.map((i, idx) => {
    const amount = idx === sorted.length - 1 ? total - allocated : Math.round(total * Number(i.pct) / 100);
    allocated += amount;
    return { dueDate: i.dueDate, amount };
  });
}
function buildInvoice(s, termId) {
  const st = structureFor(s, termId);
  const lines = st
    ? structureItemsFor(st, s).map(i => ({ name: i.name, amount: Number(i.amount) || 0 }))
    : [{ name: 'Tuition', amount: Number(s.fee) || 0 }];
  const inv = { id: 'INV' + uid(), studentId: s.id, termId, lines, bursaryPct: s.bursaryPct || 0, createdAt: todayISO() };
  computeInvoiceTotals(inv);
  inv.installments = scheduleFor(st, inv.total);
  return inv;
}
function findInvoice(studentId, termId) { return state.invoices.find(i => i.studentId === studentId && i.termId === termId) || null; }
function billStudentForCurrentTerm(s) {
  const t = getCurrentTerm();
  if (!t || findInvoice(s.id, t.id)) return;
  state.invoices.push(buildInvoice(s, t.id));
}
/* Rebuild this term's invoice after a fee, class, boarding or bursary change.
   Earlier terms are history and are never rewritten. */
function refreshCurrentInvoice(s) {
  const t = getCurrentTerm(); if (!t) return;
  const fresh = buildInvoice(s, t.id);
  const existing = findInvoice(s.id, t.id);
  if (!existing) { state.invoices.push(fresh); return; }
  existing.lines = fresh.lines;
  existing.bursaryPct = fresh.bursaryPct;
  existing.installments = fresh.installments;
  computeInvoiceTotals(existing);
}
function studentInvoices(studentId) {
  return state.invoices.filter(i => i.studentId === studentId)
    .sort((a, b) => termOrderKey(a.termId) - termOrderKey(b.termId) || String(a.createdAt).localeCompare(String(b.createdAt)));
}
/* FIFO: payments clear the oldest invoice first. */
function allocate(s) {
  let pool = studentPaid(s);
  const rows = studentInvoices(s.id).map(inv => {
    const paid = Math.max(0, Math.min(pool, inv.total));
    pool -= paid;
    return { inv, paid, due: inv.total - paid };
  });
  return { rows, credit: Math.max(0, pool) };
}
function studentAccount(s) {
  const { rows, credit } = allocate(s);
  const cur = getCurrentTerm();
  const curKey = termOrderKey(cur);
  let billed = 0, arrears = 0, currentDue = 0, currentBilled = 0, currentPaid = 0;
  rows.forEach(r => {
    billed += r.inv.total;
    const key = termOrderKey(r.inv.termId);
    if (cur && key < curKey) arrears += r.due;
    if (cur && r.inv.termId === cur.id) { currentDue += r.due; currentBilled += r.inv.total; currentPaid += r.paid; }
  });
  return { rows, credit, billed, paid: studentPaid(s), arrears, currentDue, currentBilled, currentPaid, balance: Math.max(0, billed - studentPaid(s)) };
}
/* Kept for the rest of the app: this term's bill and the total still owed. */
function effectiveFee(s) { const t = getCurrentTerm(); const inv = t && findInvoice(s.id, t.id); return inv ? inv.total : 0; }
function studentBalance(s) { return studentAccount(s).balance; }
function studentArrears(s) { return studentAccount(s).arrears; }

/* Installments past their due date that are not yet covered. */
function overdueInstallment(s) {
  const t = getCurrentTerm(); if (!t) return 0;
  const acct = studentAccount(s);
  const row = acct.rows.find(r => r.inv.termId === t.id);
  if (!row || !row.inv.installments || !row.inv.installments.length) return 0;
  const today = todayISO();
  const dueSoFar = row.inv.installments.filter(i => i.dueDate < today).reduce((a, i) => a + i.amount, 0);
  return Math.max(0, dueSoFar - row.paid);
}

/* ── Migration to schema v5 ────────────────────────────────────────────── */
/* Converts each learner's single "fee" into an invoice for the current term,
   with the same bursary rounding, so every balance is unchanged. Also maps
   academic entries from a bare "Term 1" to a real term record. */
function migrateToV5(data) {
  data.invoices = Array.isArray(data.invoices) ? data.invoices : [];
  data.feeStructures = Array.isArray(data.feeStructures) ? data.feeStructures : [];
  data.registers = Array.isArray(data.registers) ? data.registers : [];
  ensureDefaultTerm(data);
  const active = data.terms.find(t => t.isActive);
  // Old itemised "fee components" become a draft fee structure for review.
  if (Array.isArray(data.feeComponents) && data.feeComponents.length && !data.feeStructures.length) {
    data.feeStructures.push({
      id: 'FS' + uid().slice(0, 6), termId: active.id, appliesTo: 'All', draft: true,
      items: data.feeComponents.map(c => ({ name: c.name, amount: Number(c.amount) || 0, who: 'all' })),
      installments: [],
    });
  }
  (data.students || []).forEach(s => {
    s.stream = s.stream || '';
    if (!data.invoices.some(i => i.studentId === s.id && i.termId === active.id)) {
      const inv = { id: 'INV' + uid(), studentId: s.id, termId: active.id, lines: [{ name: 'Tuition', amount: Number(s.fee) || 0 }], bursaryPct: s.bursaryPct || 0, createdAt: todayISO(), installments: [] };
      computeInvoiceTotals(inv);
      data.invoices.push(inv);
    }
    (s.academics || []).forEach(a => {
      if (!a.examSet) a.examSet = 'EOT';
      if (a.termId) return;
      const name = TERM_NAMES.includes(a.term) ? a.term : active.term;
      let t = data.terms.find(x => x.year === active.year && x.term === name);
      if (!t) { t = { id: 'TRM' + uid().slice(0, 5), year: active.year, term: name, startDate: '', endDate: '', isActive: false, openedAt: nowISO() }; data.terms.push(t); }
      a.termId = t.id;
    });
  });
  data.version = 5;
  return data;
}

/* ── Term actions ──────────────────────────────────────────────────────── */
async function openNewTerm(f) {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  const year = String(f.year || '').trim();
  if (!/^\d{4}$/.test(year)) return toast('Enter the year as four digits, e.g. 2026.', 'error');
  if (!TERM_NAMES.includes(f.term)) return toast('Choose a term.', 'error');
  if (state.terms.some(t => t.year === year && t.term === f.term)) return toast(`${f.term} ${year} already exists.`, 'error');
  const prev = getCurrentTerm();
  const count = state.students.length;
  const ok = await confirmDialog({
    title: `Open ${f.term} ${year}`,
    message: `${f.term} ${year} becomes the current term and ${count} learner${count === 1 ? '' : 's'} will be billed from the fee structures. Unpaid balances from earlier terms carry forward as arrears.`,
    confirmLabel: 'Open term and bill learners',
  });
  if (!ok) return;
  state.terms.forEach(t => { t.isActive = false; });
  const term = { id: 'TRM' + uid().slice(0, 5), year, term: f.term, startDate: f.startDate || '', endDate: f.endDate || '', isActive: true, openedAt: nowISO() };
  state.terms.push(term);
  // Carry the previous term's fee structures forward; adjust them afterwards if fees changed.
  if (prev) {
    state.feeStructures.filter(fs => fs.termId === prev.id).forEach(fs => {
      state.feeStructures.push({ ...JSON.parse(JSON.stringify(fs)), id: 'FS' + uid().slice(0, 6), termId: term.id, draft: false, installments: [] });
    });
  }
  state.students.forEach(billStudentForCurrentTerm);
  saveState(); renderAll();
  AUTH.audit('TERM_OPEN', `${termLabel(term)} · ${count} learners billed`);
  toast(`${termLabel(term)} is open and ${count} learners are billed.`, 'success');
}
function setActiveTerm(id) {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  state.terms.forEach(t => { t.isActive = (t.id === id); });
  saveState(); renderAll();
  toast('Current term changed.', 'success');
}
async function deleteTerm(id) {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  const t = termById(id); if (!t) return;
  if (state.invoices.some(i => i.termId === id)) return toast('This term has bills. It cannot be removed.', 'error');
  if (state.students.some(s => (s.academics || []).some(a => a.termId === id))) return toast('This term has marks recorded. It cannot be removed.', 'error');
  if (!await confirmDialog({ title: 'Remove term', message: `Remove ${termLabel(t)}?`, confirmLabel: 'Remove', danger: true })) return;
  state.terms = state.terms.filter(x => x.id !== id);
  state.feeStructures = state.feeStructures.filter(fs => fs.termId !== id);
  if (!state.terms.some(x => x.isActive) && state.terms.length) termsInOrder().pop().isActive = true;
  saveState(); renderAll();
}
function renderTermsTable() {
  const body = el('termsTableBody'); if (!body) return;
  const ct = getCurrentTerm();
  const banner = el('currentTermBanner');
  if (banner) {
    banner.style.display = ct ? 'flex' : 'none';
    if (ct) banner.querySelector('span').textContent = `Current term: ${termLabel(ct)}${ct.startDate ? ' · ' + ct.startDate + ' → ' + (ct.endDate || '?') : ''}`;
  }
  const rows = termsInOrder().reverse();
  body.innerHTML = rows.length ? rows.map(t => {
    const invs = state.invoices.filter(i => i.termId === t.id);
    const billed = invs.reduce((a, i) => a + i.total, 0);
    return `<tr><td style="font-weight:600">${escapeHtml(termLabel(t))}</td><td>${escapeHtml(t.startDate || '—')}</td><td>${escapeHtml(t.endDate || '—')}</td>
      <td class="t-center">${invs.length}</td><td class="t-num">${fmtMoney(billed)}</td>
      <td>${t.isActive ? '<span class="badge badge-success">Current</span>' : '<span class="badge badge-neutral">Closed</span>'}</td>
      <td><div class="row-actions">${!t.isActive ? `<button class="btn btn-outline btn-xs" data-act="setActiveTerm" data-id="${escapeHtml(t.id)}">Make current</button>` : ''}<button class="btn-icon" data-act="deleteTerm" data-id="${escapeHtml(t.id)}" title="Remove">${icon('trash', 15)}</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No terms yet.</td></tr>';
  const sel = el('feeStructureTerm');
  if (sel) {
    const termChanged = renderTermsTable.lastCurrent !== (ct && ct.id);
    renderTermsTable.lastCurrent = ct && ct.id;
    const cur = (!termChanged && sel.value) || (ct && ct.id) || '';
    sel.innerHTML = termsInOrder().reverse().map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(termLabel(t))}${t.isActive ? ' (current)' : ''}</option>`).join('');
    if (cur && termById(cur)) sel.value = cur;
  }
}

/* ── Fee structure editor ──────────────────────────────────────────────── */
const APPLIES_TO_OPTIONS = ['All', 'Pre-Primary', 'Primary', 'O Level', 'A Level', ...CLASS_OPTIONS];
function appliesToLabel(v) { return v === 'All' ? 'All classes' : v; }

function renderFeeStructures() {
  const box = el('feeStructureList'); if (!box) return;
  const termId = (el('feeStructureTerm') && el('feeStructureTerm').value) || (getCurrentTerm() || {}).id;
  const t = termById(termId);
  const list = state.feeStructures.filter(fs => fs.termId === termId)
    .sort((a, b) => APPLIES_TO_OPTIONS.indexOf(a.appliesTo) - APPLIES_TO_OPTIONS.indexOf(b.appliesTo));
  const applyBtn = el('applyFeeStructuresBtn');
  if (applyBtn) applyBtn.disabled = !(t && t.isActive);
  box.innerHTML = list.length ? list.map(fs => `
    <div class="tile">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div><div style="font-weight:700">${escapeHtml(appliesToLabel(fs.appliesTo))}${fs.draft ? ' <span class="badge badge-warn">Draft from old fee components</span>' : ''}</div>
          <div class="card-desc">Day scholar ${fmtMoney(structureTotal(fs, false))} · Boarder ${fmtMoney(structureTotal(fs, true))}${(fs.installments || []).length ? ` · ${fs.installments.length} installments` : ''}</div></div>
        <div class="row-actions"><button class="btn btn-outline btn-xs" data-act="editFeeStructure" data-id="${escapeHtml(fs.id)}">Edit</button><button class="btn-icon" data-act="deleteFeeStructure" data-id="${escapeHtml(fs.id)}" title="Remove">${icon('trash', 15)}</button></div>
      </div>
      <table style="margin-top:8px"><tbody>${fs.items.map(i => `<tr><td>${escapeHtml(i.name)}${i.who !== 'all' ? ` <span class="badge badge-neutral">${i.who === 'boarders' ? 'Boarders' : 'Day scholars'}</span>` : ''}</td><td class="t-num">${fmtMoney(i.amount)}</td></tr>`).join('')}</tbody></table>
    </div>`).join('') : `<p class="card-desc">No fee structures for ${escapeHtml(termLabel(t))} yet. Without one, each learner is billed their own "Termly tuition".</p>`;
}

function feeItemRow(i = { name: '', amount: '', who: 'all' }) {
  return `<div class="form-row fs-item" style="grid-template-columns:2fr 1.2fr 1.2fr auto;align-items:end">
    <div><label class="form-label">Item</label><input class="input" name="itemName" value="${escapeHtml(i.name)}" placeholder="Tuition"></div>
    <div><label class="form-label">Amount</label><input class="input" name="itemAmount" type="number" min="0" step="1" value="${escapeHtml(i.amount)}"></div>
    <div><label class="form-label">Who pays</label><select class="input" name="itemWho">
      <option value="all" ${i.who === 'all' ? 'selected' : ''}>Everyone</option>
      <option value="boarders" ${i.who === 'boarders' ? 'selected' : ''}>Boarders only</option>
      <option value="day" ${i.who === 'day' ? 'selected' : ''}>Day scholars only</option></select></div>
    <button type="button" class="btn-icon" data-row-remove title="Remove item">${icon('x', 15)}</button>
  </div>`;
}
function installmentRow(i = { dueDate: '', pct: '' }) {
  return `<div class="form-row fs-inst" style="grid-template-columns:1.5fr 1fr auto;align-items:end">
    <div><label class="form-label">Due date</label><input class="input" name="instDate" type="date" value="${escapeHtml(i.dueDate)}"></div>
    <div><label class="form-label">% of bill</label><input class="input" name="instPct" type="number" min="1" max="100" value="${escapeHtml(i.pct)}"></div>
    <button type="button" class="btn-icon" data-row-remove title="Remove installment">${icon('x', 15)}</button>
  </div>`;
}
function openFeeStructureEditor(id) {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  const existing = id ? state.feeStructures.find(fs => fs.id === id) : null;
  const termId = existing ? existing.termId : ((el('feeStructureTerm') && el('feeStructureTerm').value) || (getCurrentTerm() || {}).id);
  const t = termById(termId);
  if (!t) return toast('Open a term first.', 'error');
  const fs = existing || { appliesTo: 'All', items: [{ name: 'Tuition', amount: '', who: 'all' }], installments: [] };
  openModal({
    title: (existing ? 'Edit' : 'New') + ' fee structure — ' + escapeHtml(termLabel(t)), wide: true,
    bodyHtml: `<form id="fsForm" class="form-grid">
      <div><label class="form-label">Applies to</label><select class="input" name="appliesTo">${APPLIES_TO_OPTIONS.map(o => `<option value="${escapeHtml(o)}" ${o === fs.appliesTo ? 'selected' : ''}>${escapeHtml(appliesToLabel(o))}</option>`).join('')}</select>
        <div class="form-hint">A class beats a level, and a level beats "All classes".</div></div>
      <div><div class="form-label" style="margin-bottom:6px">Fee items</div><div id="fsItems" class="form-grid">${fs.items.map(feeItemRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-xs" id="fsAddItem" style="margin-top:8px">${icon('plus', 14)} Add item</button></div>
      <div><div class="form-label" style="margin-bottom:6px">Installment plan <span class="opt">(optional — percentages should add up to 100)</span></div><div id="fsInsts" class="form-grid">${(fs.installments || []).map(installmentRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-xs" id="fsAddInst" style="margin-top:8px">${icon('plus', 14)} Add installment</button></div>
      <div class="tile" id="fsTotals" style="font-size:13px"></div>
    </form>`,
    footHtml: `<button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" id="fsSave">${icon('save', 15)} Save fee structure</button>`,
    onOpen(root) {
      const form = root.querySelector('#fsForm');
      const read = () => ({
        appliesTo: form.appliesTo.value,
        items: [...form.querySelectorAll('.fs-item')].map(r => ({ name: r.querySelector('[name="itemName"]').value.trim(), amount: Number(r.querySelector('[name="itemAmount"]').value) || 0, who: r.querySelector('[name="itemWho"]').value })).filter(i => i.name),
        installments: [...form.querySelectorAll('.fs-inst')].map(r => ({ dueDate: r.querySelector('[name="instDate"]').value, pct: Number(r.querySelector('[name="instPct"]').value) || 0 })).filter(i => i.dueDate || i.pct),
      });
      const totals = () => {
        const d = read();
        const pct = d.installments.reduce((a, i) => a + i.pct, 0);
        root.querySelector('#fsTotals').innerHTML = `Day scholar total <strong>${fmtMoney(structureTotal(d, false))}</strong> · Boarder total <strong>${fmtMoney(structureTotal(d, true))}</strong>${d.installments.length ? ` · Installments add up to <strong style="color:${pct === 100 ? 'var(--success)' : 'var(--danger)'}">${pct}%</strong>` : ''}`;
      };
      root.querySelector('#fsAddItem').addEventListener('click', () => { root.querySelector('#fsItems').insertAdjacentHTML('beforeend', feeItemRow()); totals(); });
      root.querySelector('#fsAddInst').addEventListener('click', () => { root.querySelector('#fsInsts').insertAdjacentHTML('beforeend', installmentRow()); totals(); });
      form.addEventListener('click', e => { const b = e.target.closest('[data-row-remove]'); if (b) { b.parentElement.remove(); totals(); } });
      form.addEventListener('input', totals);
      totals();
      root.querySelector('#fsSave').addEventListener('click', () => {
        const d = read();
        if (!d.items.length) return toast('Add at least one fee item.', 'error');
        if (d.installments.length) {
          if (d.installments.some(i => !i.dueDate || i.pct <= 0)) return toast('Every installment needs a due date and a percentage.', 'error');
          if (d.installments.reduce((a, i) => a + i.pct, 0) !== 100) return toast('Installment percentages must add up to 100.', 'error');
        }
        const clash = state.feeStructures.find(x => x.termId === termId && x.appliesTo === d.appliesTo && x.id !== (existing && existing.id));
        if (clash) return toast(`There is already a fee structure for ${appliesToLabel(d.appliesTo)} this term.`, 'error');
        if (existing) Object.assign(existing, d, { draft: false });
        else state.feeStructures.push({ id: 'FS' + uid().slice(0, 6), termId, ...d });
        saveState(); renderAll(); closeModal();
        AUTH.audit('FEE_STRUCTURE_SAVE', `${termLabel(t)} · ${appliesToLabel(d.appliesTo)}`);
        toast('Fee structure saved. Use "Apply to learners" to re-bill this term.', 'success');
      });
    },
  });
}
async function deleteFeeStructure(id) {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  const fs = state.feeStructures.find(x => x.id === id); if (!fs) return;
  if (!await confirmDialog({ title: 'Remove fee structure', message: `Remove the ${appliesToLabel(fs.appliesTo)} fee structure? Existing bills are not changed until you apply.`, confirmLabel: 'Remove', danger: true })) return;
  state.feeStructures = state.feeStructures.filter(x => x.id !== id);
  saveState(); renderAll();
}
async function applyFeeStructures() {
  if (!can('canManageTerms')) return toast('You do not have permission.', 'error');
  const t = getCurrentTerm(); if (!t) return;
  const ok = await confirmDialog({ title: 'Re-bill this term', message: `Rebuild every learner's ${termLabel(t)} bill from the current fee structures? Payments already made are kept and re-allocated. Earlier terms are not changed.`, confirmLabel: 'Re-bill learners' });
  if (!ok) return;
  state.students.forEach(refreshCurrentInvoice);
  saveState(); renderAll();
  AUTH.audit('TERM_REBILL', `${termLabel(t)} · ${state.students.length} learners`);
  toast(`${termLabel(t)} bills updated.`, 'success');
}

/* ── Statements and receipts ───────────────────────────────────────────── */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function wordsUnder1000(n) {
  const parts = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' and ');
}
function amountInWords(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Zero';
  const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const out = [];
  for (const [value, name] of scales) {
    if (n >= value) { out.push(wordsUnder1000(Math.floor(n / value)) + ' ' + name); n %= value; }
  }
  if (n > 0) out.push(wordsUnder1000(n));
  return out.join(' ');
}
function currencyWords() { return currency() === 'UGX' ? 'Uganda Shillings' : currency(); }

const DOC_CELL = 'border:1px solid #cbd5e1;padding:5px';
function printFeeReceipt(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const acct = studentAccount(s);
  const ct = getCurrentTerm();
  const curRow = acct.rows.find(r => ct && r.inv.termId === ct.id);
  const payments = state.payments.filter(p => p.studentId === s.id && !p.void).sort((a, b) => a.date.localeCompare(b.date));
  const curLines = curRow ? curRow.inv.lines.map(l => `<tr><td style="${DOC_CELL}">${escapeHtml(l.name)}</td><td style="${DOC_CELL};text-align:right">${fmtMoney(l.amount)}</td></tr>`).join('')
    + (curRow.inv.discount ? `<tr><td style="${DOC_CELL}">Bursary (${curRow.inv.bursaryPct}%)</td><td style="${DOC_CELL};text-align:right">−${fmtMoney(curRow.inv.discount)}</td></tr>` : '')
    + `<tr style="font-weight:700;background:#f0f4f1"><td style="${DOC_CELL}">${escapeHtml(termLabel(ct))} total</td><td style="${DOC_CELL};text-align:right">${fmtMoney(curRow.inv.total)}</td></tr>` : '';
  printDoc(`${docHeader('Fees Statement')}
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px;font-family:Arial,sans-serif">
      <div><strong>Student:</strong> ${escapeHtml(s.name)}<br><strong>Admission no.:</strong> ${escapeHtml(s.id)}<br><strong>Class:</strong> ${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}</div>
      <div style="text-align:right"><strong>Date:</strong> ${todayISO()}<br><strong>Current term:</strong> ${escapeHtml(termLabel(ct))}<br><strong>Status:</strong> ${isBoarder(s) ? 'Boarder' : 'Day scholar'}</div>
    </div>
    <div style="font-family:Arial,sans-serif">
    <h3 style="font-size:13px;margin:0 0 4px">ACCOUNT SUMMARY</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px"><thead style="background:#f0f4f1"><tr><th style="${DOC_CELL};text-align:left">Term</th><th style="${DOC_CELL};text-align:right">Billed</th><th style="${DOC_CELL};text-align:right">Paid</th><th style="${DOC_CELL};text-align:right">Balance</th></tr></thead><tbody>
    ${acct.rows.map(r => `<tr><td style="${DOC_CELL}">${escapeHtml(termLabel(termById(r.inv.termId)))}${ct && termOrderKey(r.inv.termId) < termOrderKey(ct) && r.due > 0 ? ' <em>(arrears)</em>' : ''}</td><td style="${DOC_CELL};text-align:right">${fmtMoney(r.inv.total)}</td><td style="${DOC_CELL};text-align:right">${fmtMoney(r.paid)}</td><td style="${DOC_CELL};text-align:right;font-weight:600">${fmtMoney(r.due)}</td></tr>`).join('') || `<tr><td colspan="4" style="${DOC_CELL};text-align:center;color:#888">No bills yet</td></tr>`}
    </tbody></table>
    ${curLines ? `<h3 style="font-size:13px;margin:12px 0 4px">${escapeHtml(termLabel(ct)).toUpperCase()} BILL</h3><table style="width:100%;border-collapse:collapse;font-size:12px"><tbody>${curLines}</tbody></table>` : ''}
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px;margin:10px 0;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
      <div><strong>Arrears brought forward:</strong> ${fmtMoney(acct.arrears)}</div><div><strong>This term outstanding:</strong> ${fmtMoney(acct.currentDue)}</div>
      <div><strong>Total paid to date:</strong> <span style="color:#047857;font-weight:700">${fmtMoney(acct.paid)}</span></div>
      <div><strong>Total balance:</strong> <span style="color:${acct.balance > 0 ? '#b91c1c' : '#047857'};font-weight:700">${fmtMoney(acct.balance)}${acct.balance <= 0 ? ' — CLEARED' : ''}</span></div>
      ${acct.credit ? `<div><strong>Credit carried:</strong> ${fmtMoney(acct.credit)}</div>` : ''}
    </div>
    <h3 style="font-size:13px;margin:12px 0 4px">PAYMENTS RECEIVED</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px"><thead style="background:#f0f4f1"><tr><th style="${DOC_CELL};text-align:left">Date</th><th style="${DOC_CELL};text-align:left">Method</th><th style="${DOC_CELL};text-align:left">Reference</th><th style="${DOC_CELL};text-align:right">Amount</th></tr></thead><tbody>
    ${payments.length ? payments.map(p => `<tr><td style="${DOC_CELL}">${escapeHtml(p.date)}</td><td style="${DOC_CELL}">${escapeHtml(p.method || 'Cash')}</td><td style="${DOC_CELL}">${escapeHtml(p.reference || p.id)}</td><td style="${DOC_CELL};text-align:right;font-weight:600">${fmtMoney(p.amount)}</td></tr>`).join('') : `<tr><td colspan="4" style="${DOC_CELL};text-align:center;color:#888">No payments recorded</td></tr>`}
    </tbody></table>
    <div style="margin-top:30px;display:flex;justify-content:space-between;font-size:11px"><div>____________________<br>Bursar</div><div style="text-align:right">____________________<br>School stamp</div></div>
    <p style="text-align:center;font-size:10px;color:#999;margin-top:12px">Generated ${new Date().toLocaleString('en-GB')}</p></div>`);
}
/* Receipt for one payment, with the amount in words. */
function printPaymentReceipt(paymentId) {
  const p = state.payments.find(x => x.id === paymentId); if (!p) return;
  const s = state.students.find(x => x.id === p.studentId);
  const acct = s ? studentAccount(s) : null;
  printDoc(`${docHeader('Official Receipt')}
    <div style="font-family:Arial,sans-serif;font-size:13px">
    <div style="display:flex;justify-content:space-between;margin-bottom:14px"><div><strong>Receipt no.:</strong> ${escapeHtml(p.id)}</div><div><strong>Date:</strong> ${escapeHtml(p.date)}</div></div>
    ${p.void ? '<div style="border:2px solid #b91c1c;color:#b91c1c;font-weight:700;text-align:center;padding:6px;margin-bottom:12px">REVERSED — NOT VALID</div>' : ''}
    <p style="line-height:2">Received from the parent/guardian of <strong>${escapeHtml(s ? s.name : p.studentId)}</strong>${s ? ` (${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}, admission no. ${escapeHtml(s.id)})` : ''}<br>
    the sum of <strong>${escapeHtml(amountInWords(p.amount))} ${escapeHtml(currencyWords())} only</strong><br>
    being payment of school fees by <strong>${escapeHtml(p.method || 'Cash')}</strong>${p.reference ? `, reference <strong>${escapeHtml(p.reference)}</strong>` : ''}.</p>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
      <div style="border:2px solid #111;padding:8px 16px;font-size:18px;font-weight:700">${fmtMoney(p.amount)}</div>
      ${acct ? `<div style="text-align:right;font-size:12px">Balance as at ${todayISO()}: <strong>${fmtMoney(acct.balance)}</strong>${acct.arrears ? `<br>of which arrears: ${fmtMoney(acct.arrears)}` : ''}</div>` : ''}
    </div>
    <div style="margin-top:36px;display:flex;justify-content:space-between;font-size:11px"><div>Received by: ${escapeHtml(p.recordedByName || '')}<br>____________________<br>Signature</div><div style="text-align:right">____________________<br>School stamp</div></div>
    </div>`);
}

/* ── Finance dashboard ─────────────────────────────────────────────────── */
function paymentsInTerm(t) {
  if (!t) return state.payments.filter(p => !p.void);
  const from = t.startDate || (t.openedAt || '').slice(0, 10);
  const to = t.endDate || '9999-12-31';
  return state.payments.filter(p => !p.void && (!from || p.date >= from) && p.date <= to);
}
function financeSnapshot() {
  const ct = getCurrentTerm();
  const accts = state.students.map(s => ({ s, a: studentAccount(s) }));
  const sum = (fn) => accts.reduce((x, y) => x + fn(y), 0);
  const billedNow = sum(x => x.a.currentBilled);
  const paidNow = sum(x => x.a.currentPaid);
  return {
    ct, accts,
    billedNow, paidNow,
    rate: billedNow ? Math.round(paidNow * 100 / billedNow) : 0,
    arrears: sum(x => x.a.arrears),
    currentDue: sum(x => x.a.currentDue),
    outstanding: sum(x => x.a.balance),
    debtors: accts.filter(x => x.a.balance > 0).length,
    collectedThisTerm: paymentsInTerm(ct).reduce((a, p) => a + Number(p.amount || 0), 0),
    bursaries: state.invoices.filter(i => ct && i.termId === ct.id).reduce((a, i) => a + (i.discount || 0), 0),
  };
}
function renderFinanceDashboard() {
  const box = el('financeStats'); if (!box) return;
  const f = financeSnapshot();
  const row = (l, v, st = '') => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)"><span class="t-muted">${l}</span><span style="font-weight:700;${st}">${v}</span></div>`;
  box.innerHTML = `<p class="card-desc" style="margin-bottom:6px">${escapeHtml(termLabel(f.ct))}</p>`
    + row('Billed this term (after bursaries)', fmtMoney(f.billedNow))
    + row('Paid against this term', fmtMoney(f.paidNow), 'color:var(--success)')
    + row('Cash received this term', fmtMoney(f.collectedThisTerm), 'color:var(--success)')
    + row('Outstanding this term', fmtMoney(f.currentDue), 'color:var(--danger)')
    + row('Arrears from earlier terms', fmtMoney(f.arrears), 'color:var(--danger)')
    + row('Bursaries granted this term', fmtMoney(f.bursaries), 'color:var(--warn)')
    + `<div style="display:flex;justify-content:space-between;padding:9px 0;font-weight:700"><span>Collection rate this term</span><span style="color:${f.rate >= 75 ? 'var(--success)' : f.rate >= 50 ? 'var(--warn)' : 'var(--danger)'}">${f.rate}%</span></div>`;

  const headline = el('arrearsHeadline');
  if (headline) {
    headline.innerHTML = f.outstanding > 0
      ? `${icon('alert')}<span><strong>${fmtMoney(f.outstanding)}</strong> is owed by <strong>${f.debtors}</strong> learner${f.debtors === 1 ? '' : 's'} — ${fmtMoney(f.arrears)} of it from earlier terms.</span>`
      : `${icon('check')}<span>Every learner is fully paid up.</span>`;
    headline.className = 'banner ' + (f.outstanding > 0 ? 'banner-warn' : 'banner-success');
  }

  const methods = {};
  paymentsInTerm(f.ct).forEach(p => { const m = p.method || 'Cash'; methods[m] = (methods[m] || 0) + Number(p.amount || 0); });
  const mEl = el('collectionsByMethod');
  if (mEl) {
    const entries = Object.entries(methods).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(e => e[1]));
    mEl.innerHTML = entries.length ? entries.map(([m, v]) => `<div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span style="font-weight:600">${escapeHtml(m)}</span><span>${fmtMoney(v)}</span></div><div class="bar"><span style="width:${v / max * 100}%"></span></div></div>`).join('') : '<p class="card-desc">No payments received this term yet.</p>';
  }

  const cEl = el('arrearsByClass');
  if (cEl) {
    const byClass = {};
    f.accts.forEach(({ s, a }) => { const k = s.class || 'Unassigned'; byClass[k] = byClass[k] || { billed: 0, out: 0, n: 0 }; byClass[k].billed += a.currentBilled; byClass[k].out += a.balance; byClass[k].n++; });
    const order = (k) => { const i = CLASS_OPTIONS.indexOf(k); return i < 0 ? 99 : i; };
    cEl.innerHTML = Object.keys(byClass).length ? `<table><thead><tr><th>Class</th><th class="t-center">Learners</th><th class="t-num">Billed this term</th><th class="t-num">Outstanding (all terms)</th></tr></thead><tbody>${Object.keys(byClass).sort((a, b) => order(a) - order(b)).map(k => `<tr><td style="font-weight:600">${escapeHtml(k)}</td><td class="t-center">${byClass[k].n}</td><td class="t-num">${fmtMoney(byClass[k].billed)}</td><td class="t-num" style="color:${byClass[k].out ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(byClass[k].out)}</td></tr>`).join('')}</tbody></table>` : '<p class="card-desc">No learners yet.</p>';
  }

  const dEl = el('topDefaulters');
  if (dEl) {
    const top = f.accts.filter(x => x.a.balance > 0).sort((a, b) => b.a.balance - a.a.balance).slice(0, 10);
    dEl.innerHTML = top.length ? `<table><thead><tr><th>Learner</th><th>Class</th><th class="t-num">Arrears</th><th class="t-num">This term</th><th class="t-num">Total</th><th class="t-num">Overdue installment</th><th></th></tr></thead><tbody>${top.map(({ s, a }) => {
      const overdue = overdueInstallment(s);
      return `<tr><td style="font-weight:600">${escapeHtml(s.name)}</td><td>${escapeHtml(s.class)}</td><td class="t-num">${fmtMoney(a.arrears)}</td><td class="t-num">${fmtMoney(a.currentDue)}</td><td class="t-num" style="color:var(--danger);font-weight:700">${fmtMoney(a.balance)}</td><td class="t-num">${overdue ? fmtMoney(overdue) : '—'}</td>
        <td><div class="row-actions"><button class="btn-icon" title="SMS guardian" data-act="smsBalance" data-id="${escapeHtml(s.id)}">${icon('message', 15)}</button><button class="btn btn-outline btn-xs" data-act="waBalance" data-id="${escapeHtml(s.id)}">WhatsApp</button></div></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="card-desc">No defaulters. Well done.</p>';
  }
}

/* ── Wiring ────────────────────────────────────────────────────────────── */
Object.assign(ACTIONS, {
  setActiveTerm: d => setActiveTerm(d.id),
  deleteTerm: d => deleteTerm(d.id),
  editFeeStructure: d => openFeeStructureEditor(d.id),
  deleteFeeStructure: d => deleteFeeStructure(d.id),
  paymentReceipt: d => printPaymentReceipt(d.id),
});
MODULES.push({
  name: 'billing',
  setup() {
    bind('termForm', (f, form) => { openNewTerm(f).then(() => form.reset()); });
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('feeStructureTerm', 'change', renderFeeStructures);
    on('addFeeStructureBtn', 'click', () => openFeeStructureEditor(null));
    on('applyFeeStructuresBtn', 'click', applyFeeStructures);
  },
  render() { renderTermsTable(); renderFeeStructures(); renderFinanceDashboard(); },
});
