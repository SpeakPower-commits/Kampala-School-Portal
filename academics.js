/* =========================================================================
   academics.js — grading scales, exam sets, aggregates, class positions,
   class mark sheets, report-card comments and report cards.

   Marks are stored per learner as { id, termId, examSet: BOT|MOT|EOT,
   subject, score, grade, points, date }. A subject's term result ("final")
   is the end-of-term (EOT) mark when there is one, otherwise the average of
   the beginning- and mid-term marks.
   ========================================================================= */
'use strict';

const EXAM_SETS = [
  { id: 'BOT', label: 'Beginning of term' },
  { id: 'MOT', label: 'Mid-term' },
  { id: 'EOT', label: 'End of term' },
];
const PLE_SUBJECTS = ['english language', 'mathematics', 'science', 'social studies'];

/* Default grading scales. Each school can change them under Academics →
   Grading scales, because cut-offs differ from school to school. */
const DEFAULT_GRADE_BANDS = {
  primary: [
    { grade: 'D1', min: 80, points: 1 }, { grade: 'D2', min: 70, points: 2 },
    { grade: 'C3', min: 65, points: 3 }, { grade: 'C4', min: 60, points: 4 },
    { grade: 'C5', min: 55, points: 5 }, { grade: 'C6', min: 50, points: 6 },
    { grade: 'P7', min: 45, points: 7 }, { grade: 'P8', min: 40, points: 8 },
    { grade: 'F9', min: 0, points: 9 },
  ],
  olevel: [
    { grade: 'D1', min: 90, points: 1 }, { grade: 'D2', min: 80, points: 2 },
    { grade: 'C3', min: 70, points: 3 }, { grade: 'C4', min: 60, points: 4 },
    { grade: 'C5', min: 50, points: 5 }, { grade: 'C6', min: 40, points: 6 },
    { grade: 'P7', min: 30, points: 7 }, { grade: 'P8', min: 20, points: 8 },
    { grade: 'F9', min: 0, points: 9 },
  ],
  olevelCbc: [
    { grade: 'A', min: 80, points: 5 }, { grade: 'B', min: 65, points: 4 },
    { grade: 'C', min: 50, points: 3 }, { grade: 'D', min: 35, points: 2 },
    { grade: 'E', min: 0, points: 1 },
  ],
  alevel: [
    { grade: 'A', min: 80, points: 6 }, { grade: 'B', min: 70, points: 5 },
    { grade: 'C', min: 60, points: 4 }, { grade: 'D', min: 50, points: 3 },
    { grade: 'E', min: 40, points: 2 }, { grade: 'O', min: 35, points: 1 },
    { grade: 'F', min: 0, points: 0 },
  ],
  other: [{ grade: 'Pass', min: 50, points: 1 }, { grade: 'Fail', min: 0, points: 0 }],
};
const BAND_SCHEMES = [
  { key: 'primary', label: 'Primary (PLE)' },
  { key: 'olevel', label: 'O Level — legacy (D1–F9)' },
  { key: 'olevelCbc', label: 'O Level — new curriculum (A–E)' },
  { key: 'alevel', label: 'A Level' },
];

function gradeBands(key) {
  const custom = state.settings && state.settings.gradeBands && state.settings.gradeBands[key];
  const bands = Array.isArray(custom) && custom.length ? custom : DEFAULT_GRADE_BANDS[key];
  return [...bands].sort((a, b) => b.min - a.min);
}
function schemeFor(level) {
  if (level === 'Primary') return 'primary';
  if (level === 'O Level') return gradingMode() === 'cbc' ? 'olevelCbc' : 'olevel';
  if (level === 'A Level') return 'alevel';
  return 'other';
}
function gradeFor(level, score) {
  score = Number(score);
  const band = gradeBands(schemeFor(level)).find(b => score >= b.min) || gradeBands(schemeFor(level)).slice(-1)[0];
  return { grade: band.grade, points: band.points };
}
function subjectRemark(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 70) return 'Very good';
  if (score >= 60) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 40) return 'Needs more effort';
  return 'Weak — needs support';
}

/* UCE (legacy) divisions over the best eight subjects. */
function calculateDivision(agg, subjectCount) {
  if (subjectCount < 6) return 'Incomplete';
  if (agg <= 32) return 'Division I';
  if (agg <= 44) return 'Division II';
  if (agg <= 56) return 'Division III';
  if (agg <= 72) return 'Division IV';
  return 'Ungraded (U)';
}
/* PLE divisions over the four examinable subjects. */
function pleDivision(agg) {
  if (agg <= 12) return 'Division I';
  if (agg <= 23) return 'Division II';
  if (agg <= 29) return 'Division III';
  if (agg <= 33) return 'Division IV';
  return 'Ungraded (U)';
}

/* Best score per distinct subject. */
function bestPerSubject(entries) {
  const map = {};
  entries.forEach(a => {
    const key = (a.subject || '').toLowerCase();
    if (!map[key] || a.score > map[key].score) map[key] = a;
  });
  return Object.values(map);
}

/* One row per subject for a term: BOT / MOT / EOT and the final mark. */
function subjectResults(s, termId) {
  const entries = (s.academics || []).filter(a => a.termId === termId);
  const bySubject = {};
  entries.forEach(a => {
    const key = (a.subject || '').toLowerCase();
    const row = bySubject[key] = bySubject[key] || { subject: a.subject, BOT: null, MOT: null, EOT: null };
    const set = a.examSet || 'EOT';
    if (row[set] === null || a.score > row[set]) row[set] = a.score;
  });
  return Object.values(bySubject).map(r => {
    const earlier = [r.BOT, r.MOT].filter(v => v !== null);
    const final = r.EOT !== null ? r.EOT : (earlier.length ? Math.round(earlier.reduce((a, b) => a + b, 0) / earlier.length) : 0);
    const g = gradeFor(s.level, final);
    return { ...r, final, grade: g.grade, points: g.points, remark: subjectRemark(final) };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
}

/* Overall result for one term. `rankScore` is higher-is-better, for positions. */
function studentTermResult(s, termId) {
  const results = subjectResults(s, termId);
  if (!results.length) return { results, count: 0, avg: 0, label: '—', rankScore: null };
  const avg = Math.round(results.reduce((a, r) => a + r.final, 0) / results.length);
  const scheme = schemeFor(s.level);
  if (scheme === 'primary') {
    const core = results.filter(r => PLE_SUBJECTS.includes(r.subject.toLowerCase()));
    if (core.length < 4) return { results, count: results.length, avg, label: `${avg}% average · PLE aggregate needs all 4 subjects`, rankScore: -100000 + avg };
    const agg = core.reduce((a, r) => a + r.points, 0);
    const division = pleDivision(agg);
    return { results, count: results.length, avg, agg, division, label: `Aggregate ${agg} · ${division}`, rankScore: -agg * 1000 + avg };
  }
  if (scheme === 'olevel') {
    const best8 = results.slice().sort((a, b) => a.points - b.points).slice(0, 8);
    const agg = best8.reduce((a, r) => a + r.points, 0);
    const division = calculateDivision(agg, best8.length);
    return { results, count: results.length, avg, agg, division, label: `Aggregate ${agg} · ${division}`, rankScore: (best8.length < 6 ? -100000 : -agg * 1000) + avg };
  }
  if (scheme === 'olevelCbc') {
    const counts = {};
    results.forEach(r => { counts[r.grade] = (counts[r.grade] || 0) + 1; });
    const summary = gradeBands('olevelCbc').map(b => b.grade).filter(g => counts[g]).map(g => `${counts[g]}${g}`).join(' ');
    return { results, count: results.length, avg, label: summary + ' · competency grades', rankScore: avg };
  }
  if (scheme === 'alevel') {
    const best3 = results.slice().sort((a, b) => b.points - a.points).slice(0, 3);
    const pts = best3.reduce((a, r) => a + r.points, 0);
    return { results, count: results.length, avg, points: pts, label: `${pts} principal points`, rankScore: pts * 1000 + avg };
  }
  return { results, count: results.length, avg, label: avg + '% average', rankScore: avg };
}
function termsWithMarks(s) {
  const ids = [...new Set((s.academics || []).map(a => a.termId).filter(Boolean))];
  return ids.sort((a, b) => termOrderKey(a) - termOrderKey(b));
}
/* Summary used across the app: the latest term with marks. */
function studentAcademicSummary(s) {
  const ac = s.academics || [];
  if (!ac.length) return { count: 0, avg: 0, latestTerm: '', summary: '—' };
  const latest = termsWithMarks(s).pop();
  const r = studentTermResult(s, latest);
  return { count: ac.length, avg: r.avg, latestTermId: latest, latestTerm: termLabel(termById(latest)), summary: r.label, result: r };
}

/* Competition ranking (1, 2, 2, 4) among learners with marks that term. */
function classPositions(termId, cls, stream) {
  const pool = state.students
    .filter(s => s.class === cls && (!stream || s.stream === stream))
    .map(s => ({ s, r: studentTermResult(s, termId) }))
    .filter(x => x.r.rankScore !== null)
    .sort((a, b) => b.r.rankScore - a.r.rankScore);
  const out = {};
  pool.forEach((x, i) => {
    const pos = i > 0 && x.r.rankScore === pool[i - 1].r.rankScore ? out[pool[i - 1].s.id].pos : i + 1;
    out[x.s.id] = { pos, of: pool.length };
  });
  return out;
}
function ordinal(n) { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); }

/* ── Who can see whom ──────────────────────────────────────────────────── */
/* Teachers only work with their assigned classes; everyone else sees all. */
function visibleStudents() {
  const classes = AUTH.currentUserClasses();
  return classes ? state.students.filter(s => classes.includes(s.class)) : state.students;
}
function visibleClasses() {
  const classes = AUTH.currentUserClasses();
  const present = [...new Set(state.students.map(s => s.class).filter(Boolean))];
  const list = classes ? classes : present;
  return [...list].sort((a, b) => CLASS_OPTIONS.indexOf(a) - CLASS_OPTIONS.indexOf(b));
}
function streamsFor(cls) { return [...new Set(state.students.filter(s => s.class === cls).map(s => s.stream).filter(Boolean))].sort(); }
function termOptions(selectedId) {
  const cur = (getCurrentTerm() || {}).id;
  return termsInOrder().reverse().map(t => `<option value="${escapeHtml(t.id)}" ${t.id === (selectedId || cur) ? 'selected' : ''}>${escapeHtml(termLabel(t))}${t.isActive ? ' (current)' : ''}</option>`).join('');
}
function fillSelect(id, html, keep = true) {
  const sel = el(id); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = html;
  if (keep && cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

/* ── Recording marks ───────────────────────────────────────────────────── */
function saveMark(s, termId, examSet, subject, score) {
  const g = gradeFor(s.level, score);
  s.academics = s.academics || [];
  const existing = s.academics.find(a => a.termId === termId && (a.examSet || 'EOT') === examSet && a.subject.toLowerCase() === subject.toLowerCase());
  if (existing) { existing.score = score; existing.grade = g.grade; existing.points = g.points; existing.date = todayISO(); }
  else s.academics.push({ id: 'AC' + uid().slice(0, 6), termId, examSet, term: (termById(termId) || {}).term || '', subject, score, grade: g.grade, points: g.points, date: todayISO() });
  return g;
}
function addAcademicScore(f) {
  if (!can('canAddAcademic')) return toast('You do not have permission.', 'error');
  const s = visibleStudents().find(x => x.id === f.studentId);
  if (!s) return toast('Choose a learner first.', 'error');
  const score = Number(f.score);
  if (f.score === '' || isNaN(score) || score < 0 || score > 100) return toast('Score must be between 0 and 100.', 'error');
  const subject = (f.subject || '').trim();
  if (!subject) return toast('Enter a subject.', 'error');
  const termId = f.termId || (getCurrentTerm() || {}).id;
  const g = saveMark(s, termId, f.examSet || 'EOT', subject, score);
  saveState(); renderAll();
  toast(`Saved: ${subject} ${score}% (${g.grade}).`, 'success');
}

/* Whole-class mark sheet: one subject, one exam, every learner in the class. */
function renderMarkSheet() {
  const box = el('markSheetRoster'); if (!box) return;
  const cls = el('msClass').value, stream = el('msStream').value, termId = el('msTerm').value, set = el('msExam').value;
  const subject = el('msSubject').value.trim();
  if (!cls || !subject) { box.innerHTML = '<div class="empty">Choose a class and a subject to load the mark sheet.</div>'; return; }
  const learners = visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream)).sort((a, b) => a.name.localeCompare(b.name));
  if (!learners.length) { box.innerHTML = '<div class="empty">No learners in this class.</div>'; return; }
  box.innerHTML = learners.map(s => {
    const mark = (s.academics || []).find(a => a.termId === termId && (a.examSet || 'EOT') === set && a.subject.toLowerCase() === subject.toLowerCase());
    return `<div class="roster-item"><div><div style="font-weight:600">${escapeHtml(s.name)}</div><div class="card-desc">${escapeHtml(s.id)}${s.stream ? ' · ' + escapeHtml(s.stream) : ''}</div></div>
      <input class="input ms-score" type="number" min="0" max="100" style="width:90px" data-student="${escapeHtml(s.id)}" value="${mark ? mark.score : ''}" aria-label="Score for ${escapeHtml(s.name)}"></div>`;
  }).join('');
}
function saveMarkSheet() {
  if (!can('canAddAcademic')) return toast('You do not have permission.', 'error');
  const termId = el('msTerm').value, set = el('msExam').value, subject = el('msSubject').value.trim();
  if (!subject) return toast('Enter a subject.', 'error');
  let saved = 0, bad = 0;
  document.querySelectorAll('#markSheetRoster .ms-score').forEach(inp => {
    if (inp.value === '') return;
    const score = Number(inp.value);
    if (isNaN(score) || score < 0 || score > 100) { bad++; inp.style.borderColor = 'var(--danger)'; return; }
    const s = visibleStudents().find(x => x.id === inp.dataset.student);
    if (s) { saveMark(s, termId, set, subject, score); saved++; }
  });
  if (bad) return toast(`${bad} score${bad > 1 ? 's are' : ' is'} not between 0 and 100. Nothing was saved.`, 'error');
  saveState(); renderAll();
  toast(`Saved ${saved} ${subject} mark${saved === 1 ? '' : 's'}.`, 'success');
}

/* ── Academic table and record modal ───────────────────────────────────── */
function renderAcademicTable() {
  const body = el('academicTableBody'); if (!body) return;
  const levelF = el('academicLevelFilter').value;
  const termId = (el('academicTermFilter') && el('academicTermFilter').value) || (getCurrentTerm() || {}).id;
  const list = visibleStudents().filter(s => (!levelF || s.level === levelF) && (s.academics || []).some(a => a.termId === termId));
  const posCache = {};
  body.innerHTML = list.length ? list.map(s => {
    const r = studentTermResult(s, termId);
    const key = s.class;
    posCache[key] = posCache[key] || classPositions(termId, s.class);
    const p = posCache[key][s.id];
    return `<tr>
      <td style="font-weight:600">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}</td>
      <td class="t-center">${r.count}</td>
      <td class="t-center">${r.avg}%</td>
      <td style="font-weight:600;color:var(--brand)">${escapeHtml(r.label)}</td>
      <td class="t-center">${p ? `${p.pos} / ${p.of}` : '—'}</td>
      <td><div class="row-actions"><button class="btn btn-outline btn-xs" data-act="academic" data-id="${escapeHtml(s.id)}">View</button><button class="btn-icon" title="Report card" data-act="reportCard" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(termId)}">${icon('file', 15)}</button></div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No marks recorded for this term yet.</td></tr>';
}
function openAcademic(studentId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const blocks = termsWithMarks(s).reverse().map(termId => {
    const r = studentTermResult(s, termId);
    const cell = v => v === null ? '<span class="t-muted">—</span>' : v + '%';
    return `<div class="tile" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px"><strong>${escapeHtml(termLabel(termById(termId)))}</strong><span class="badge badge-gold">${escapeHtml(r.label)}</span></div>
      <table><thead><tr><th>Subject</th><th class="t-center">BOT</th><th class="t-center">MOT</th><th class="t-center">EOT</th><th class="t-center">Final</th><th class="t-center">Grade</th></tr></thead><tbody>
      ${r.results.map(x => `<tr><td>${escapeHtml(x.subject)}</td><td class="t-center">${cell(x.BOT)}</td><td class="t-center">${cell(x.MOT)}</td><td class="t-center">${cell(x.EOT)}</td><td class="t-center" style="font-weight:600">${x.final}%</td><td class="t-center" style="font-weight:700;color:var(--brand)">${escapeHtml(x.grade)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
  openModal({ title: escapeHtml(s.name) + ' — academic record', wide: true, bodyHtml: blocks || '<p class="empty">No marks yet.</p>', footHtml: `<button class="btn btn-ghost" data-modal-close>Close</button>` });
}

/* ── Report-card comments ──────────────────────────────────────────────── */
function suggestComment(avg) {
  if (avg >= 80) return 'Excellent performance. Keep it up.';
  if (avg >= 70) return 'Very good work. Aim even higher next term.';
  if (avg >= 60) return 'Good performance. More effort will bring better results.';
  if (avg >= 50) return 'Fair work. Needs to put in more effort.';
  if (avg >= 40) return 'Below average. Needs to work much harder and seek help.';
  return 'Weak performance. Needs close support from teachers and parents.';
}
function renderCommentSheet() {
  const box = el('commentRoster'); if (!box) return;
  const cls = el('cmClass').value, termId = el('cmTerm').value;
  if (!cls) { box.innerHTML = '<div class="empty">Choose a class to write report-card comments.</div>'; return; }
  const canHead = can('canHeadComment');
  const learners = visibleStudents().filter(s => s.class === cls).sort((a, b) => a.name.localeCompare(b.name));
  box.innerHTML = learners.length ? learners.map(s => {
    const c = (s.comments && s.comments[termId]) || {};
    const r = studentTermResult(s, termId);
    return `<div class="tile cm-row" data-student="${escapeHtml(s.id)}" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px"><strong>${escapeHtml(s.name)}</strong><span class="card-desc">${r.count ? r.avg + '% · ' + escapeHtml(r.label) : 'No marks this term'}</span></div>
      <div class="form-row">
        <div><label class="form-label">Class teacher</label><textarea class="input cm-class" rows="2" data-suggest="${escapeHtml(r.count ? suggestComment(r.avg) : '')}">${escapeHtml(c.classTeacher || '')}</textarea></div>
        <div><label class="form-label">Head teacher</label><textarea class="input cm-head" rows="2" data-suggest="${escapeHtml(r.count ? suggestComment(r.avg) : '')}" ${canHead ? '' : 'disabled'}>${escapeHtml(c.headTeacher || '')}</textarea></div>
      </div></div>`;
  }).join('') : '<div class="empty">No learners in this class.</div>';
}
function fillSuggestedComments() {
  document.querySelectorAll('#commentRoster textarea').forEach(t => { if (!t.value.trim() && !t.disabled && t.dataset.suggest) t.value = t.dataset.suggest; });
}
function saveComments() {
  if (!can('canAddAcademic')) return toast('You do not have permission.', 'error');
  const termId = el('cmTerm').value;
  let n = 0;
  document.querySelectorAll('#commentRoster .cm-row').forEach(row => {
    const s = visibleStudents().find(x => x.id === row.dataset.student); if (!s) return;
    s.comments = s.comments || {};
    const c = s.comments[termId] = s.comments[termId] || {};
    c.classTeacher = row.querySelector('.cm-class').value.trim();
    if (can('canHeadComment')) c.headTeacher = row.querySelector('.cm-head').value.trim();
    n++;
  });
  saveState();
  toast(`Comments saved for ${n} learner${n === 1 ? '' : 's'}.`, 'success');
}

/* ── Report cards ──────────────────────────────────────────────────────── */
function daysPresent(s, t) {
  const regs = (state.registers || []).filter(r => r.class === s.class && (!t || ((!t.startDate || r.date >= t.startDate) && (!t.endDate || r.date <= t.endDate))));
  let present = 0, total = 0;
  regs.forEach(r => { const rec = r.records.find(x => x.studentId === s.id); if (rec) { total++; if (rec.status === 'P' || rec.status === 'L') present++; } });
  return { present, total };
}
function nextTermFees(s, next) {
  if (!next) return null;
  const st = structureFor(s, next.id);
  if (!st) return null;
  const gross = structureItemsFor(st, s).reduce((a, i) => a + Number(i.amount || 0), 0);
  return Math.round(gross * (1 - (s.bursaryPct || 0) / 100));
}
function reportCardHtml(s, termId, opts = {}) {
  const t = termById(termId);
  const r = studentTermResult(s, termId);
  // The parent portal holds one child, not the class, so it passes the
  // positions frozen when the results were published.
  const pos = opts.position !== undefined ? opts.position : classPositions(termId, s.class)[s.id];
  const streamPos = opts.streamPosition !== undefined ? opts.streamPosition : (s.stream ? classPositions(termId, s.class, s.stream)[s.id] : null);
  const att = daysPresent(s, t);
  const acct = studentAccount(s);
  const next = nextTermOf(t);
  const nextBegins = opts.nextTermBegins || (next && next.startDate) || '';
  const nextFees = opts.nextTermFees || nextTermFees(s, next);
  const c = (s.comments && s.comments[termId]) || {};
  const conduct = state.conduct.filter(x => x.studentId === s.id && (!t || !t.startDate || x.date >= t.startDate) && (!t || !t.endDate || x.date <= t.endDate)).slice(-4);
  const td = 'border:1px solid #9aa8a0;padding:5px';
  const cell = v => v === null ? '—' : v;
  const brand = (state.settings && state.settings.brandColor) || '#0b5d3b';
  const h2 = `font-size:12px;background:${brand};color:#fff;padding:4px 9px;margin:10px 0 5px;font-family:Arial,sans-serif;letter-spacing:0.04em`;
  const bands = gradeBands(schemeFor(s.level));
  return `<section class="report-card">
    ${docHeader(`Report Card — ${escapeHtml(termLabel(t))}`)}
    <table style="width:100%;font-size:12px;font-family:Arial,sans-serif;margin-bottom:6px"><tr>
      <td><strong>Name:</strong> ${escapeHtml(s.name)}</td><td><strong>Admission no.:</strong> ${escapeHtml(s.id)}</td><td><strong>Class:</strong> ${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}</td></tr><tr>
      <td><strong>Gender:</strong> ${escapeHtml(s.gender || '—')}</td><td><strong>Section:</strong> ${isBoarder(s) ? 'Boarding' : 'Day'}</td><td>${s.unebIndexNo ? `<strong>UNEB index:</strong> ${escapeHtml(s.unebIndexNo)}` : ''}</td></tr></table>
    <div style="${h2}">ACADEMIC PERFORMANCE</div>
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;font-family:Arial,sans-serif">
      <thead style="background:#eef3f0"><tr><th style="${td};text-align:left">Subject</th><th style="${td}">BOT</th><th style="${td}">MOT</th><th style="${td}">EOT</th><th style="${td}">Final</th><th style="${td}">Grade</th><th style="${td};text-align:left">Remark</th><th style="${td}">Initials</th></tr></thead>
      <tbody>${r.results.map(x => `<tr><td style="${td}">${escapeHtml(x.subject)}</td><td style="${td};text-align:center">${cell(x.BOT)}</td><td style="${td};text-align:center">${cell(x.MOT)}</td><td style="${td};text-align:center">${cell(x.EOT)}</td><td style="${td};text-align:center;font-weight:700">${x.final}</td><td style="${td};text-align:center;font-weight:700">${escapeHtml(x.grade)}</td><td style="${td}">${escapeHtml(x.remark)}</td><td style="${td}"></td></tr>`).join('') || `<tr><td colspan="8" style="${td};text-align:center;color:#888">No marks recorded this term</td></tr>`}</tbody>
    </table>
    <table style="width:100%;font-size:12px;font-family:Arial,sans-serif;margin-top:6px"><tr>
      <td><strong>Average:</strong> ${r.avg}%</td><td><strong>Result:</strong> ${escapeHtml(r.label)}</td>
      <td><strong>Position in class:</strong> ${pos ? `${ordinal(pos.pos)} of ${pos.of}` : '—'}</td>
      ${streamPos ? `<td><strong>In stream:</strong> ${ordinal(streamPos.pos)} of ${streamPos.of}</td>` : ''}</tr></table>
    <div style="${h2}">ATTENDANCE, CONDUCT &amp; CO-CURRICULAR</div>
    <p style="font-size:12px;font-family:Arial,sans-serif;margin:2px 0"><strong>Days present:</strong> ${att.total ? `${att.present} of ${att.total}` : 'Not recorded'}${s.sport ? ` · <strong>Sport:</strong> ${escapeHtml(s.sport)}${s.skillLevel ? ' (' + escapeHtml(s.skillLevel) + ')' : ''}` : ''}</p>
    ${conduct.length ? `<ul style="font-size:11.5px;font-family:Arial,sans-serif;margin:4px 0;padding-left:18px">${conduct.map(x => `<li>${escapeHtml(x.date)} · ${escapeHtml(x.type)}: ${escapeHtml(x.description)}</li>`).join('')}</ul>` : ''}
    <div style="${h2}">COMMENTS</div>
    <table style="width:100%;font-size:12px;font-family:Arial,sans-serif"><tr><td style="padding:3px 0;width:28%"><strong>Class teacher:</strong></td><td style="border-bottom:1px dotted #777">${escapeHtml(c.classTeacher || '')}</td></tr>
      <tr><td style="padding:3px 0"><strong>Head teacher:</strong></td><td style="border-bottom:1px dotted #777">${escapeHtml(c.headTeacher || '')}</td></tr></table>
    <div style="${h2}">FEES &amp; NEXT TERM</div>
    <table style="width:100%;font-size:12px;font-family:Arial,sans-serif"><tr>
      <td><strong>Balance owed:</strong> <span style="color:${acct.balance ? '#b91c1c' : '#047857'};font-weight:700">${fmtMoney(acct.balance)}</span></td>
      <td><strong>Next term begins:</strong> ${escapeHtml(nextBegins || '—')}</td>
      <td><strong>Next term fees:</strong> ${nextFees ? fmtMoney(nextFees) : '—'}</td></tr></table>
    <div style="margin-top:22px;display:flex;justify-content:space-between;font-size:11px;font-family:Arial,sans-serif"><div>____________________<br>Class teacher</div><div>____________________<br>Head teacher${state.settings.headTeacher ? '<br>' + escapeHtml(state.settings.headTeacher) : ''}</div><div>____________________<br>Parent / guardian</div></div>
    <p style="font-size:9.5px;color:#666;font-family:Arial,sans-serif;margin-top:10px">Grading: ${bands.map(b => `${escapeHtml(b.grade)} ${b.min}+`).join(' · ')}. Final = end-of-term mark, or the average of earlier tests when there is no end-of-term mark.</p>
  </section>`;
}
function openReportCard(studentId, termId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const t = termId || (termsWithMarks(s).pop()) || (getCurrentTerm() || {}).id;
  printDoc(reportCardHtml(s, t, reportOptions()));
}
function reportOptions() {
  const o = (state.settings && state.settings.reportOptions) || {};
  return { nextTermBegins: o.nextTermBegins || '', nextTermFees: Number(o.nextTermFees) || 0 };
}
function printClassReports() {
  const cls = el('rcClass').value, stream = el('rcStream').value, termId = el('rcTerm').value;
  if (!cls) return toast('Choose a class.', 'error');
  const learners = visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream)).sort((a, b) => a.name.localeCompare(b.name));
  if (!learners.length) return toast('No learners in that class.', 'error');
  state.settings.reportOptions = { nextTermBegins: el('rcNextBegins').value, nextTermFees: el('rcNextFees').value };
  saveState();
  printDoc(learners.map(s => reportCardHtml(s, termId, reportOptions())).join(''));
  toast(`Prepared ${learners.length} report card${learners.length === 1 ? '' : 's'}.`, 'success');
}

/* ── Grading scales editor ─────────────────────────────────────────────── */
function bandsToText(bands) { return bands.map(b => `${b.grade} ${b.min} ${b.points}`).join('\n'); }
function parseBands(text) {
  const rows = text.split('\n').map(l => l.trim()).filter(Boolean);
  const bands = rows.map((line, i) => {
    const parts = line.split(/[\s,]+/);
    if (parts.length !== 3) throw new Error(`Line ${i + 1}: use "GRADE MIN POINTS", e.g. D1 80 1`);
    const [grade, min, points] = parts;
    if (!/^[A-Za-z0-9+-]{1,6}$/.test(grade)) throw new Error(`Line ${i + 1}: grade "${grade}" is not valid`);
    if (isNaN(Number(min)) || Number(min) < 0 || Number(min) > 100) throw new Error(`Line ${i + 1}: minimum must be 0–100`);
    if (isNaN(Number(points))) throw new Error(`Line ${i + 1}: points must be a number`);
    return { grade, min: Number(min), points: Number(points) };
  });
  if (!bands.some(b => b.min === 0)) throw new Error('One grade must start at 0 so every score gets a grade.');
  return bands.sort((a, b) => b.min - a.min);
}
function renderBandsForm() {
  BAND_SCHEMES.forEach(sc => { const t = el('bands-' + sc.key); if (t && document.activeElement !== t) t.value = bandsToText(gradeBands(sc.key)); });
}
function saveBands() {
  if (!can('canManageSettings')) return toast('You do not have permission.', 'error');
  const next = {};
  try { BAND_SCHEMES.forEach(sc => { next[sc.key] = parseBands(el('bands-' + sc.key).value); }); }
  catch (err) { return toast(err.message, 'error'); }
  state.settings.gradeBands = next;
  recomputeGrades(); saveState(); renderAll();
  AUTH.audit('GRADING_SCALES_UPDATE', '');
  toast('Grading scales saved. All marks have been re-graded.', 'success');
}
async function resetBands() {
  if (!await confirmDialog({ title: 'Restore default scales', message: 'Replace your grading scales with the defaults? All marks will be re-graded.', confirmLabel: 'Restore defaults' })) return;
  delete state.settings.gradeBands;
  recomputeGrades(); saveState(); renderAll();
  toast('Default grading scales restored.', 'success');
}

/* ── Rendering & wiring ────────────────────────────────────────────────── */
function renderAcademicControls() {
  const classOpts = '<option value="">Choose class…</option>' + visibleClasses().map(c => `<option>${escapeHtml(c)}</option>`).join('');
  ['msClass', 'cmClass', 'rcClass'].forEach(id => fillSelect(id, classOpts));
  // When a new term opens, move every term picker to it, so marks are not
  // filed under last term by mistake. Otherwise keep the user's choice.
  const currentId = (getCurrentTerm() || {}).id;
  const termChanged = renderAcademicControls.lastCurrent !== currentId;
  renderAcademicControls.lastCurrent = currentId;
  ['academicTerm', 'msTerm', 'cmTerm', 'rcTerm', 'academicTermFilter'].forEach(id => {
    const sel = el(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = termOptions(!termChanged && cur && termById(cur) ? cur : null);
  });
  const streamOpts = cls => '<option value="">All streams</option>' + streamsFor(cls).map(x => `<option>${escapeHtml(x)}</option>`).join('');
  if (el('msStream')) fillSelect('msStream', streamOpts(el('msClass').value));
  if (el('rcStream')) fillSelect('rcStream', streamOpts(el('rcClass').value));
  fillSelect('academicStudent', '<option value="">Choose…</option>' + visibleStudents().map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} — ${escapeHtml(s.class)}${s.stream ? ' ' + escapeHtml(s.stream) : ''}</option>`).join(''));
  const opts = reportOptions();
  if (el('rcNextBegins') && !el('rcNextBegins').value) el('rcNextBegins').value = opts.nextTermBegins;
  if (el('rcNextFees') && !el('rcNextFees').value && opts.nextTermFees) el('rcNextFees').value = opts.nextTermFees;
}

Object.assign(ACTIONS, {
  academic: d => openAcademic(d.id),
  reportCard: d => openReportCard(d.id, d.term),
});
/* ── Publishing results to parents (online edition) ────────────────────── */
/* Parents see a term's marks, comments and report cards only once it is
   published. Positions need the whole class, which a parent's view does not
   have, so they are frozen here at publishing, as on the printed cards. */
function renderPublishBox() {
  const box = el('publishStatus'); if (!box || !ONLINE_EDITION) return;
  const t = termById(el('rcTerm') && el('rcTerm').value);
  if (!t) { box.textContent = 'Choose a term above.'; return; }
  box.textContent = t.resultsPublished
    ? `${termLabel(t)} is published: parents can see marks, positions, comments and report cards in the parent portal.`
    : `${termLabel(t)} is not published: parents cannot see this term's marks yet.`;
  el('publishBtn').textContent = t.resultsPublished ? 'Publish again (after changes)' : 'Publish this term to parents';
  el('unpublishBtn').style.display = t.resultsPublished ? '' : 'none';
}
async function publishResults() {
  if (!ONLINE_EDITION || !can('canPublishResults')) return toast('You do not have permission.', 'error');
  const termId = el('rcTerm').value, t = termById(termId);
  if (!t) return toast('Choose a term.', 'error');
  const learners = state.students.filter(s => studentTermResult(s, termId).results.length);
  if (!learners.length) return toast(`No marks have been entered for ${termLabel(t)} yet.`, 'error');
  if (!await confirmDialog({ title: 'Publish results to parents', message: `Parents will see ${termLabel(t)} marks, class positions, comments and the report card for ${learners.length} learner${learners.length === 1 ? '' : 's'}. Positions are fixed as they are now; publish again after any changes.`, confirmLabel: 'Publish' })) return;
  const saved = await SYNC.flush();
  if (!saved.ok) return toast('Your latest marks have not reached the school database yet. Check the connection and try again.', 'error');
  const byClass = {};
  const rows = learners.map(s => {
    const r = studentTermResult(s, termId);
    const cp = (byClass[s.class] = byClass[s.class] || classPositions(termId, s.class))[s.id];
    const sp = s.stream ? classPositions(termId, s.class, s.stream)[s.id] : null;
    return { learner_id: s.id, position: cp ? cp.pos : null, out_of: cp ? cp.of : null,
      stream_position: sp ? sp.pos : null, stream_out_of: sp ? sp.of : null, average: r.avg, result: r.label };
  });
  const { data, error } = await ONLINE.client().rpc('publish_results', { p_school: SYNC.schoolId(), p_term: termId, p_rows: rows });
  if (error) return toast(ONLINE.friendly(error), 'error');
  t.resultsPublished = true;   // the database already says so; sync.js never writes this flag
  renderPublishBox();
  toast(`${termLabel(t)} results published to parents for ${data} learner${data === 1 ? '' : 's'}.`, 'success');
}
async function unpublishResults() {
  const termId = el('rcTerm').value, t = termById(termId);
  if (!t || !await confirmDialog({ title: 'Withdraw results', message: `Parents will no longer see ${termLabel(t)} marks and report cards.`, confirmLabel: 'Withdraw', danger: true })) return;
  const { error } = await ONLINE.client().rpc('unpublish_results', { p_school: SYNC.schoolId(), p_term: termId });
  if (error) return toast(ONLINE.friendly(error), 'error');
  t.resultsPublished = false;
  renderPublishBox();
  toast(`${termLabel(t)} results withdrawn.`, 'success');
}

MODULES.push({
  name: 'academics',
  setup() {
    bind('academicForm', (f, form) => { addAcademicScore(f); form.subject.value = ''; form.score.value = ''; });
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('academicLevelFilter', 'change', renderAcademicTable);
    on('academicTermFilter', 'change', renderAcademicTable);
    ['msClass', 'msStream', 'msTerm', 'msExam'].forEach(id => on(id, 'change', () => { if (id === 'msClass') renderAcademicControls(); renderMarkSheet(); }));
    on('msSubject', 'change', renderMarkSheet);
    on('msLoadBtn', 'click', renderMarkSheet);
    on('msSaveBtn', 'click', saveMarkSheet);
    ['cmClass', 'cmTerm'].forEach(id => on(id, 'change', renderCommentSheet));
    on('cmSuggestBtn', 'click', fillSuggestedComments);
    on('cmSaveBtn', 'click', saveComments);
    on('rcClass', 'change', renderAcademicControls);
    on('rcPrintBtn', 'click', printClassReports);
    on('rcTerm', 'change', renderPublishBox);
    on('publishBtn', 'click', publishResults);
    on('unpublishBtn', 'click', unpublishResults);
    on('bandsSaveBtn', 'click', saveBands);
    on('bandsResetBtn', 'click', resetBands);
  },
  render() { renderAcademicControls(); renderBandsForm(); renderPublishBox(); },
});
