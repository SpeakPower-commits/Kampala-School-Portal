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

/* ── Who teaches what ──────────────────────────────────────────────────── */
/* Kept in the school settings, so every device (and, online, every member)
   reads the same: { [username]: { name, classTeacherOf, teaches: [{ subject, class }] } }.
   The director sets it on each teacher's account. */
function teachingOf(username) {
  const t = ((state.settings && state.settings.teaching) || {})[String(username || '').toLowerCase()];
  return { name: (t && t.name) || '', classTeacherOf: (t && t.classTeacherOf) || '', teaches: (t && Array.isArray(t.teaches)) ? t.teaches : [] };
}
function setTeaching(username, rec) {
  const all = Object.assign({}, (state.settings && state.settings.teaching) || {});
  const key = String(username || '').toLowerCase();
  if (rec) all[key] = rec; else delete all[key];
  state.settings = Object.assign({}, state.settings, { teaching: all });
}
function myTeaching() { return currentSession ? teachingOf(currentSession.username) : teachingOf(''); }
/* The subjects (lower case) the signed-in teacher may type marks for in a
   class; null means any subject (everyone who is not a teacher, and a teacher
   whose subjects have not been set yet). */
function mySubjectsFor(cls) {
  if (!currentSession || currentSession.role !== 'teacher') return null;
  const t = myTeaching();
  if (!t.teaches.length) return null;
  return t.teaches.filter(x => x.class === cls).map(x => String(x.subject).toLowerCase());
}
/* Who teaches a subject in a class (their name), for "marks still missing". */
function teacherOf(subject, cls) {
  const all = (state.settings && state.settings.teaching) || {};
  const hit = Object.values(all).find(t => (t.teaches || []).some(x => x.class === cls && String(x.subject).toLowerCase() === String(subject).toLowerCase()));
  return hit ? hit.name : '';
}
function taughtSubjects(cls) {
  return Object.values((state.settings && state.settings.teaching) || {}).flatMap(t => (t.teaches || []).filter(x => x.class === cls).map(x => x.subject));
}

/* ── Marks progress: which papers still have no mark, and whose they are ── */
/* The subjects a class sits in a term: those a teacher is set to teach there
   and those with any mark that term, in the class's subject order. */
function classSheetSubjects(cls, termId) {
  const marked = visibleStudents().filter(s => s.class === cls).flatMap(s => (s.academics || []).filter(a => a.termId === termId).map(a => a.subject));
  const seen = new Set(), out = [];
  [...taughtSubjects(cls), ...marked].forEach(x => { const k = String(x || '').trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } });
  const rank = subjectRank(cls);
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
/* One pass over a class's marks for a term. An exam nobody in the class has
   any mark for yet is "not given yet", so its empty sheets are not "missing". */
function markIndex(cls, stream, termId) {
  const all = visibleStudents().filter(s => s.class === cls);
  const learners = all.filter(s => !stream || s.stream === stream).sort((a, b) => a.name.localeCompare(b.name));
  const keys = new Set(), started = new Set();
  all.forEach(s => (s.academics || []).forEach(a => {
    if (a.termId !== termId) return;
    const set = a.examSet || 'EOT';
    started.add(set);
    keys.add(`${s.id}|${set}|${String(a.subject).toLowerCase()}`);
  }));
  const progress = (set, subj) => {
    const missing = learners.filter(s => !keys.has(`${s.id}|${set}|${String(subj).toLowerCase()}`));
    return { total: learners.length, done: learners.length - missing.length, missing };
  };
  return { learners, started, progress };
}
/* Every unfinished mark sheet of a class in a term, in the exams given so far. */
function missingSheets(cls, stream, termId) {
  const ix = markIndex(cls, stream, termId);
  if (!ix.learners.length) return [];
  const subjects = classSheetSubjects(cls, termId);
  return EXAM_SETS.filter(e => ix.started.has(e.id)).flatMap(e => subjects.map(subject => {
    const p = ix.progress(e.id, subject);
    return p.done < p.total ? Object.assign({ cls, stream, termId, set: e.id, exam: e.label, subject, teacher: teacherOf(subject, cls) }, p) : null;
  })).filter(Boolean);
}
/* "Nakato Sarah, Okello Peter and 4 more", each name opening that child. */
function namesList(list, max = 8, section = 'marks') {
  return list.slice(0, max).map(s => learnerLink(s.id, s.name, section)).join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');
}
const sheetAttrs = (cls, subject, set, termId) => `data-act="openSheet" data-class="${escapeHtml(cls)}" data-subject="${escapeHtml(subject)}" data-exam="${escapeHtml(set)}" data-term="${escapeHtml(termId || '')}"`;

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
  return [...list].sort((a, b) => classRank(a) - classRank(b) || String(a).localeCompare(String(b)));
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
  else s.academics.push({ id: newId('AC'), termId, examSet, term: (termById(termId) || {}).term || '', subject, score, grade: g.grade, points: g.points, date: todayISO() });
  return g;
}
/* ── Enter marks: the class mark sheet ─────────────────────────────────── */
/* One row per child, one column per subject, for one exam: each box is one
   child's paper in one subject. "Show" narrows it to one subject (easier on
   a phone). Scores are typed as written on the script, out of the paper's
   total ("out of" under each subject), and kept as percentages. */
const OTHER_SUBJECT = '__other__';
let msExtraSubjects = [];          // subjects added with "Another subject…" until marks are saved
let msDirty = false, msLast = null; // unsaved typing, and the choices it belongs to
const msOutOf = {};                 // class|term|exam|subject → that paper's total (each paper has its own)

function subjectsFor(cls) {
  const level = classifyLevel(cls);
  const base = level === 'Primary' ? PRIMARY_SUBJECTS : level === 'A Level' ? A_LEVEL_SUBJECTS : level === 'O Level' ? O_LEVEL_SUBJECTS : [];
  const used = visibleStudents().filter(s => s.class === cls).flatMap(s => (s.academics || []).map(a => a.subject));
  const seen = new Set(), out = [];
  [...base, ...taughtSubjects(cls), ...used.sort(), ...msExtraSubjects].forEach(x => { const k = (x || '').trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } });
  return out;
}
const subjectRank = cls => { const list = subjectsFor(cls).map(x => x.toLowerCase()); return x => { const i = list.indexOf(x.toLowerCase()); return i < 0 ? 999 : i; }; };
const msSubject = () => { const v = el('msSubject') ? el('msSubject').value : ''; return v === OTHER_SUBJECT ? '' : v; };
const streamOptions = cls => streamsFor(cls).length ? '<option value="">All streams</option>' + streamsFor(cls).map(x => `<option>${escapeHtml(x)}</option>`).join('') : '';
const round2 = n => Math.round(n * 100) / 100;
const pctText = n => (Math.round(n * 10) / 10) + '%';
const paperKey = (cls, termId, set, subj) => [cls, termId, set, String(subj).toLowerCase()].join('|');
const msPaperKey = subj => paperKey(el('msClass').value, el('msTerm').value, el('msExam').value, subj);
const msOut = subj => msOutOf[msPaperKey(subj)] || 100;

function syncExamButtons() {
  const cur = (el('msExam') || {}).value || 'EOT';
  document.querySelectorAll('#msExamSeg [data-exam]').forEach(b => {
    const on = b.dataset.exam === cur;
    b.className = on ? 'on-P' : ''; b.setAttribute('aria-checked', on);
  });
}
function renderMarkSheet() {
  const box = el('markSheetRoster'); if (!box) return;
  syncExamButtons();
  const cls = el('msClass').value, stream = el('msStream').value, termId = el('msTerm').value, set = el('msExam').value;
  const only = msSubject();
  msLast = { cls, stream, termId, set, subject: el('msSubject').value };
  msDirty = false;
  if (!cls) { box.innerHTML = '<div class="empty">Choose the class: its children and subjects appear here.</div>'; msCount(); return; }
  const learners = visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream)).sort((a, b) => a.name.localeCompare(b.name));
  if (!learners.length) { box.innerHTML = `<div class="empty">No children in ${escapeHtml(cls)} yet. They are added when admitted (Students → Admit a new learner).</div>`; msCount(); return; }
  // A subject teacher types only in their own subjects, which come first; the
  // other columns are shown for reference and stay locked, so nobody overwrites
  // a colleague's marks.
  const mine = mySubjectsFor(cls);
  const subjects = only ? [only] : subjectsFor(cls).sort((a, b) => (mine ? Number(!mine.includes(a.toLowerCase())) - Number(!mine.includes(b.toLowerCase())) : 0));
  const many = subjects.length > 1;
  const locked = subj => !!mine && !mine.includes(subj.toLowerCase());
  const off = subj => locked(subj) ? ' disabled title="Entered by the subject\'s own teacher"' : '';
  const markOf = (s, subj) => (s.academics || []).find(a => a.termId === termId && (a.examSet || 'EOT') === set && a.subject.toLowerCase() === subj.toLowerCase());
  const head = subjects.map(subj => `<th class="ms-col${mine && !locked(subj) ? ' ms-mine' : ''}"><div class="ms-subj">${escapeHtml(subj)}</div>${locked(subj) && teacherOf(subj, cls) ? `<div class="card-desc">${escapeHtml(teacherOf(subj, cls))}</div>` : ''}
      <label class="ms-out">out of <input class="ms-outof" type="number" inputmode="numeric" min="1" max="1000" value="${msOut(subj)}" data-subject="${escapeHtml(subj)}"${off(subj)} aria-label="${escapeHtml(subj)}: the paper is marked out of"></label></th>`).join('');
  const rows = learners.map(s => `<tr class="ms-row" data-student="${escapeHtml(s.id)}" data-find="${escapeHtml(s.name.toLowerCase() + ' ' + s.id.toLowerCase())}">
      <td class="ts-name">${learnerLink(s.id, s.name, 'marks')}${s.stream && !stream ? ` <span class="card-desc">${escapeHtml(s.stream)}</span>` : ''}</td>
      ${subjects.map(subj => {
        const m = markOf(s, subj);
        const shown = m ? round2(m.score * msOut(subj) / 100) : '';
        return `<td class="ms-cell"><input class="input ms-score" type="number" inputmode="decimal" min="0" step="any" data-student="${escapeHtml(s.id)}" data-subject="${escapeHtml(subj)}"${m ? ` data-pct="${m.score}"` : ''} value="${shown}"${off(subj)} aria-label="${escapeHtml(subj)} mark for ${escapeHtml(s.name)}">
          <div class="ms-under"><span class="ms-pct">${m ? pctText(m.score) : ''}</span> <span class="ms-grade">${m ? escapeHtml(gradeFor(s.level, m.score).grade) : ''}</span></div></td>`;
      }).join('')}
      ${many ? '<td class="ts-tot ms-avg"></td>' : ''}</tr>`).join('');
  const yours = mine ? subjects.filter(x => !locked(x)) : [];
  const note = !mine ? '' : yours.length
    ? (yours.length < subjects.length ? `<p class="card-desc ms-lock-note">You type in ${escapeHtml(yours.join(', '))} (highlighted). The other subjects are shown so you can see how each child is doing; their own teachers enter them.</p>` : '')
    : `<p class="card-desc ms-lock-note t-warn">You are not set to teach ${only ? escapeHtml(only) : 'any subject'} in ${escapeHtml(cls)}, so these marks are shown but locked. The director sets who teaches what (Administration → Staff).</p>`;
  box.innerHTML = note + `<div class="ts-wrap"><table class="ts ms-table"><thead><tr><th class="ts-name">Child</th>${head}${many ? '<th>Child\'s average</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="ts-name">Class average</td>${subjects.map(subj => `<td class="ms-cavg" data-subject="${escapeHtml(subj)}"></td>`).join('')}${many ? '<td class="ms-cavg-all"></td>' : ''}</tr></tfoot></table></div>`;
  msFilter();
  msTotals();
  msCount();
}
/* The percentage a box stands for (null when empty or not a valid score). */
function msBoxPct(inp) {
  if (inp.value === '') return null;
  const raw = Number(inp.value), out = msOut(inp.dataset.subject);
  if (!Number.isFinite(raw) || raw < 0 || raw > out) return NaN;
  return round2(raw / out * 100);
}
/* Each child's average, and the class average per subject, as the boxes stand. */
function msTotals() {
  const avg = list => list.length ? pctText(list.reduce((a, b) => a + b, 0) / list.length) : '—';
  const bySubject = {}, all = [];
  document.querySelectorAll('#markSheetRoster .ms-row').forEach(tr => {
    const mine = [];
    tr.querySelectorAll('.ms-score').forEach(inp => {
      const p = msBoxPct(inp);
      if (p === null || Number.isNaN(p)) return;
      mine.push(p); all.push(p);
      (bySubject[inp.dataset.subject] = bySubject[inp.dataset.subject] || []).push(p);
    });
    const cell = tr.querySelector('.ms-avg'); if (cell) cell.textContent = avg(mine);
  });
  document.querySelectorAll('#markSheetRoster .ms-cavg').forEach(td => { td.textContent = avg(bySubject[td.dataset.subject] || []); });
  const tot = document.querySelector('#markSheetRoster .ms-cavg-all'); if (tot) tot.textContent = avg(all);
}
/* "S.4 · Mid-term · Term 3 2026: 34 of 60 marked" and who is still to be marked. */
function msCount() {
  const box = el('msCounter'); if (!box) return;
  const all = [...document.querySelectorAll('#markSheetRoster .ms-score')];
  const inputs = all.filter(i => !i.disabled);
  if (!inputs.length) { box.style.display = 'none'; return; }
  const filled = inputs.filter(i => i.value !== '').length;
  const exam = (EXAM_SETS.find(x => x.id === el('msExam').value) || {}).label || '';
  const subs = [...new Set(inputs.map(i => i.dataset.subject))];
  const only = subs.length === 1 ? subs[0] : '';
  const left = only ? inputs.filter(i => i.value === '').map(i => learnerName(i.dataset.student)) : [];
  box.style.display = '';
  box.innerHTML = `${escapeHtml(el('msClass').value)}${only ? ' · ' + escapeHtml(only) : ''} · ${escapeHtml(exam)} · ${escapeHtml(termLabel(termById(el('msTerm').value)))}: <strong>${filled} of ${inputs.length}</strong> marked`
    + (left.length && left.length <= 12 ? ` · <span class="t-warn">still to mark: ${left.map(escapeHtml).join(', ')}</span>` : '')
    + (msDirty ? ' · <span class="t-warn">not saved yet</span>' : '');
}
function msScoreTyped(inp) {
  const s = state.students.find(x => x.id === inp.dataset.student);
  const p = msBoxPct(inp);
  inp.dataset.touched = '1';
  inp.style.borderColor = Number.isNaN(p) ? 'var(--danger)' : '';
  const under = inp.parentElement;
  under.querySelector('.ms-pct').textContent = p === null ? '' : Number.isNaN(p) ? `0–${msOut(inp.dataset.subject)}` : pctText(p);
  under.querySelector('.ms-grade').textContent = p === null || Number.isNaN(p) ? '' : gradeFor(s.level, p).grade;
  msDirty = true;
  msTotals();
  msCount();
}
/* The paper's total changed: saved marks are shown out of the new total; what
   was typed is read against it (type it as written on the script). */
function msOutOfChanged(inp) {
  const subj = inp.dataset.subject;
  const out = Math.max(1, Math.round(Number(inp.value) || 100));
  msOutOf[msPaperKey(subj)] = out;
  document.querySelectorAll('#markSheetRoster .ms-score').forEach(box => {
    if (box.dataset.subject !== subj) return;
    if (!box.dataset.touched && box.dataset.pct !== undefined) box.value = round2(Number(box.dataset.pct) * out / 100);
    const p = msBoxPct(box);
    if (box.value !== '' || box.dataset.touched) {
      const s = state.students.find(x => x.id === box.dataset.student);
      box.style.borderColor = Number.isNaN(p) ? 'var(--danger)' : '';
      box.parentElement.querySelector('.ms-pct').textContent = p === null ? '' : Number.isNaN(p) ? `0–${out}` : pctText(p);
      box.parentElement.querySelector('.ms-grade').textContent = p === null || Number.isNaN(p) ? '' : gradeFor(s.level, p).grade;
    }
  });
  msTotals();
}
/* "Find a child": show only the rows whose name matches. */
function msFilter() {
  const q = ((el('msFind') || {}).value || '').trim().toLowerCase();
  const rows = [...document.querySelectorAll('#markSheetRoster .ms-row')];
  rows.forEach(tr => { tr.style.display = !q || tr.dataset.find.includes(q) ? '' : 'none'; });
  const shown = rows.filter(tr => tr.style.display !== 'none');
  if (q && shown.length === 1) { const first = shown[0].querySelector('.ms-score'); if (first) first.focus(); }
}
/* A choice changed: warn before losing typed marks, then list the class again. */
async function msChoiceChanged(e) {
  const id = e.target.id;
  if (id === 'msSubject' && e.target.value === OTHER_SUBJECT) {
    const name = ((await promptDialog({ title: 'Another subject', label: 'Name of the subject' })) || '').trim();
    if (name) {
      if (!msExtraSubjects.some(x => x.toLowerCase() === name.toLowerCase())) msExtraSubjects.push(name);
      renderAcademicControls();
      el('msSubject').value = subjectsFor(el('msClass').value).find(x => x.toLowerCase() === name.toLowerCase()) || '';
    } else if (msLast) { el('msSubject').value = msLast.subject; return; }
  }
  if (msDirty && msLast) {
    const ok = await confirmDialog({ title: 'Marks not saved yet', message: 'You typed marks that are not saved. Change the sheet and lose them?', confirmLabel: 'Change and lose them', danger: true });
    if (!ok) {
      el('msClass').value = msLast.cls; renderAcademicControls();
      el('msStream').value = msLast.stream; el('msTerm').value = msLast.termId; el('msExam').value = msLast.set; el('msSubject').value = msLast.subject;
      syncExamButtons();
      return;
    }
  }
  if (id === 'msClass') {
    if (el('msFind')) el('msFind').value = '';
    renderAcademicControls();
    // A teacher who teaches one subject in this class gets that column on its own.
    const mine = mySubjectsFor(el('msClass').value);
    const opt = mine && mine.length === 1 && [...el('msSubject').options].find(o => o.value.toLowerCase() === mine[0]);
    if (opt) el('msSubject').value = opt.value;
  }
  renderMarkSheet();
}
async function msSetExam(set) {
  if (set === el('msExam').value) return;
  const before = el('msExam').value;
  el('msExam').value = set;
  if (msDirty && msLast && !await confirmDialog({ title: 'Marks not saved yet', message: 'You typed marks that are not saved. Change the exam and lose them?', confirmLabel: 'Change and lose them', danger: true })) {
    el('msExam').value = before; syncExamButtons(); return;
  }
  renderMarkSheet();
}
/* Typed marks are saved by the same rules everywhere (the mark sheet and a
   learner's page): a mark outside the paper's total is refused, changing or
   removing a saved mark is confirmed first, and every save is written to "who
   did what". Each box: { s, subj, had (saved %, or null), p (typed %, null
   when empty, NaN when out of range), raw, out, inp }. Returns 'saved',
   'cancelled' (the confirmation was declined) or '' (nothing was saved). */
async function commitMarks(boxes, termId, set, where) {
  const wrong = [], toSave = [], changes = [], removals = [];
  boxes.forEach(({ s, subj, had, p, raw, out, inp }) => {
    if (Number.isNaN(p)) { wrong.push(`${s.name} (${subj}: ${raw} is not between 0 and ${out})`); if (inp) inp.style.borderColor = 'var(--danger)'; return; }
    if (p === null) { if (had !== null) removals.push({ s, subj, had }); return; }
    if (had !== null && Math.abs(had - p) < 0.01) return;   // unchanged
    toSave.push({ s, subj, p });
    if (had !== null) changes.push(`${s.name}'s ${subj} from ${pctText(had)} to ${pctText(p)}`);
  });
  if (wrong.length) { toast(`Not saved. ${wrong.length === 1 ? 'This mark is' : 'These marks are'} out of range: ${wrong.slice(0, 4).join('; ')}${wrong.length > 4 ? ` and ${wrong.length - 4} more` : ''}.`, 'error'); return ''; }
  if (!toSave.length && !removals.length) { toast('Nothing new to save: type a mark in a box first.', 'info'); return ''; }
  if (changes.length || removals.length) {
    const lines = [...changes.map(c => 'change ' + c), ...removals.map(r => `remove ${r.s.name}'s ${r.subj} mark (${pctText(r.had)})`)];
    const ok = await confirmDialog({ title: 'Change marks already saved?', message: `You are about to ${lines.slice(0, 5).join('; ')}${lines.length > 5 ? `; and ${lines.length - 5} more` : ''}. Everything else stays as it is.`, confirmLabel: 'Yes, change them' });
    if (!ok) return 'cancelled';
  }
  toSave.forEach(({ s, subj, p }) => saveMark(s, termId, set, subj, p));
  removals.forEach(({ s, subj }) => { s.academics = (s.academics || []).filter(a => !(a.termId === termId && (a.examSet || 'EOT') === set && a.subject.toLowerCase() === subj.toLowerCase())); });
  saveState();
  const exam = (EXAM_SETS.find(x => x.id === set) || {}).label || set;
  AUTH.audit('MARKS_SAVE', `${where} · ${exam} · ${toSave.length} mark${toSave.length === 1 ? '' : 's'}${changes.length ? ` (${changes.length} changed)` : ''}${removals.length ? ` · ${removals.length} removed` : ''}`);
  toast(`Saved ${toSave.length} mark${toSave.length === 1 ? '' : 's'}${removals.length ? `, removed ${removals.length}` : ''} for ${where}, ${exam}.`, 'success');
  return 'saved';
}
async function saveMarkSheet() {
  if (!can('canAddAcademic')) return toast('You do not have permission.', 'error');
  const cls = el('msClass').value, termId = el('msTerm').value, set = el('msExam').value;
  if (!cls) return toast('Choose the class first.', 'error');
  const boxes = [...document.querySelectorAll('#markSheetRoster .ms-score')].filter(inp => !inp.disabled).map(inp => {
    const s = visibleStudents().find(x => x.id === inp.dataset.student);
    return s && { s, subj: inp.dataset.subject, had: inp.dataset.pct !== undefined ? Number(inp.dataset.pct) : null, p: msBoxPct(inp), raw: inp.value, out: msOut(inp.dataset.subject), inp };
  }).filter(Boolean);
  if (await commitMarks(boxes, termId, set, cls) !== 'saved') return;
  msDirty = false;
  renderAll();
  renderMarkSheet();
}
/* Open the mark sheet ready to type: the class, the exam and (for a subject
   teacher) their subject already chosen. From a teacher's home, the marks
   progress and the "marks still missing" lists. */
async function openMarkSheet(cls, subject, set, termId) {
  if (msDirty && msLast && !await confirmDialog({ title: 'Marks not saved yet', message: 'You typed marks that are not saved. Open the other sheet and lose them?', confirmLabel: 'Open it and lose them', danger: true })) return;
  msDirty = false;
  switchTab('academics', 'marks');
  if (subject && !subjectsFor(cls).some(x => x.toLowerCase() === subject.toLowerCase())) msExtraSubjects.push(subject);
  el('msClass').value = cls;
  renderAcademicControls();
  if (termId && termById(termId)) el('msTerm').value = termId;
  if (el('msStream')) el('msStream').value = '';
  el('msExam').value = EXAM_SETS.some(e => e.id === set) ? set : 'EOT';
  const opt = [...el('msSubject').options].find(o => subject && o.value.toLowerCase() === subject.toLowerCase());
  el('msSubject').value = opt ? opt.value : '';
  if (el('msFind')) el('msFind').value = '';
  renderMarkSheet();
  const first = [...document.querySelectorAll('#markSheetRoster .ms-score')].find(i => !i.disabled && i.value === '');
  if (first) first.focus();
}

/* ── Class results: the class "broad sheet" ─────────────────────────────── */
function classResultsData(cls, stream, termId) {
  const learners = visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream));
  const pos = classPositions(termId, cls);
  const rows = learners.map(s => ({ s, r: studentTermResult(s, termId), p: pos[s.id] }))
    .sort((a, b) => (a.p ? a.p.pos : 1e9) - (b.p ? b.p.pos : 1e9) || a.s.name.localeCompare(b.s.name));
  const rank = subjectRank(cls);
  const subjects = [...new Set(rows.flatMap(x => x.r.results.map(y => y.subject)))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { cls, stream, termId, rows, subjects };
}
function classResultsTable(d, print) {
  const head = d.subjects.map(sub => `<th class="ts-c">${escapeHtml(sub)}</th>`).join('');
  const rows = d.rows.map(({ s, r, p }) => {
    const cells = d.subjects.map(sub => {
      const y = r.results.find(z => z.subject.toLowerCase() === sub.toLowerCase());
      return y ? `<td class="ts-c">${y.final}<div class="cr-grade">${escapeHtml(y.grade)}</div></td>` : '<td class="ts-c ts-none">—</td>';
    }).join('');
    const name = print ? escapeHtml(s.name) : learnerLink(s.id, s.name);
    const card = print ? '' : `<td class="ts-c">${r.count ? `<button class="btn btn-outline btn-xs" type="button" data-act="previewReport" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(d.termId)}">Report card</button>` : ''}</td>`;
    return `<tr><td class="ts-name"><span class="cr-pos">${p ? ordinal(p.pos) : '—'}</span>${name}</td>${cells}<td class="ts-tot">${r.count ? r.avg + '%' : '—'}</td><td class="ts-tot" style="text-align:left">${escapeHtml(r.count ? r.label : 'No marks yet')}</td>${card}</tr>`;
  }).join('');
  const out = d.rows[0] && d.rows.find(x => x.p) ? d.rows.find(x => x.p).p.of : 0;
  return `<div class="ts-wrap"><table class="ts"><thead><tr><th class="ts-name">Position · learner</th>${head}<th class="ts-tot">Average</th><th class="ts-tot" style="text-align:left">Result</th>${print ? '' : '<th class="ts-c"></th>'}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="card-desc" style="margin-top:8px">Each subject shows the final mark and its grade. Positions are out of ${out} in ${escapeHtml(d.cls)}${d.stream ? ' (all streams)' : ''}.</p>`;
}
/* Marks progress for a class: subjects down the side, the three exams across;
   each cell says how many learners have a mark and opens that mark sheet. Below
   it, every unfinished sheet with the names still to enter and whose it is. */
function marksProgressHtml(cls, stream, termId) {
  const ix = markIndex(cls, stream, termId);
  const subjects = classSheetSubjects(cls, termId);
  if (!subjects.length || !ix.learners.length) return '';
  // BOT, MOT and EOT, as on the report card, so the three exams fit a phone.
  const head = EXAM_SETS.map(e => `<th class="ts-c" title="${escapeHtml(e.label)}">${escapeHtml(e.id)}</th>`).join('');
  const rows = subjects.map(subj => {
    const who = teacherOf(subj, cls);
    const cells = EXAM_SETS.map(e => {
      if (!ix.started.has(e.id)) return '<td class="ts-c ts-none" title="Not given yet this term">—</td>';
      const p = ix.progress(e.id, subj), full = p.done === p.total;
      return `<td class="ts-c"><button type="button" class="link-btn ${full ? 't-ok' : 't-warn'}" ${sheetAttrs(cls, subj, e.id, termId)} aria-label="${escapeHtml(`${subj}, ${e.label}: ${p.done} of ${p.total} marked. Open the mark sheet`)}">${p.done}/${p.total}${full ? ' ✓' : ''}</button></td>`;
    }).join('');
    return `<tr><td class="ts-name">${escapeHtml(subj)}${who ? `<div class="card-desc">${escapeHtml(who)}</div>` : ''}</td>${cells}</tr>`;
  }).join('');
  const gaps = missingSheets(cls, stream, termId);
  const given = EXAM_SETS.filter(e => ix.started.has(e.id)).map(e => e.label);
  const list = !given.length ? `<p class="card-desc">No exam has been given in ${escapeHtml(cls)} this term yet.</p>`
    : gaps.length ? gaps.slice(0, 12).map(g => `<div class="abs-item"><strong>${escapeHtml(g.subject)} · ${escapeHtml(g.exam)}</strong>${g.teacher ? ` <span class="card-desc">(${escapeHtml(g.teacher)})</span>` : ''}: ${g.total - g.done} still to enter — ${namesList(g.missing, 8)}</div>`).join('')
      + (gaps.length > 12 ? `<p class="card-desc">and ${gaps.length - 12} more sheets not finished.</p>` : '')
    : `<p class="card-desc t-ok">Every learner has a mark in every subject for ${escapeHtml(given.join(', '))}.</p>`;
  return `<div class="tile ms-progress"><div style="font-weight:700">Marks progress</div>
    <p class="card-desc">How many learners have a mark in each subject: BOT beginning of term, MOT mid-term, EOT end of term. Tap a number to open that mark sheet; "—" is an exam not given yet this term.</p>
    <div class="ts-wrap" style="margin-top:8px"><table class="ts"><thead><tr><th class="ts-name">Subject</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:8px">${list}</div></div>`;
}
function renderClassResults() {
  const box = el('classResults'); if (!box) return;
  const cls = el('crClass').value;
  if (!cls) { box.innerHTML = '<div class="empty">Choose a class to see its results.</div>'; return; }
  const d = classResultsData(cls, el('crStream').value, el('crTerm').value);
  if (!d.rows.length) { box.innerHTML = '<div class="empty">No learners in this class.</div>'; return; }
  const progress = marksProgressHtml(cls, d.stream, d.termId);
  if (!d.subjects.length) { box.innerHTML = progress + `<div class="empty">No marks entered for ${escapeHtml(cls)} in ${escapeHtml(termLabel(termById(d.termId)))} yet. Use Enter marks.</div>`; return; }
  box.innerHTML = progress + '<div class="form-label" style="margin:16px 0 6px">Class results</div>' + classResultsTable(d, false);
}
function printClassResults() {
  const cls = el('crClass').value;
  if (!cls) return toast('Choose a class first.', 'error');
  const d = classResultsData(cls, el('crStream').value, el('crTerm').value);
  if (!d.subjects.length) return toast('There are no marks to print for this class and term.', 'error');
  printDoc('<style>@page { size: A4 landscape; margin: 10mm; }</style>' + docHeader(`Class results — ${escapeHtml(cls + (d.stream ? ' ' + d.stream : ''))} — ${escapeHtml(termLabel(termById(d.termId)))}`) + classResultsTable(d, true));
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
  const pos = classPositions(termId, cls);
  box.innerHTML = learners.length ? learners.map(s => {
    const c = (s.comments && s.comments[termId]) || {};
    const r = studentTermResult(s, termId), p = pos[s.id];
    return `<div class="tile cm-row" data-student="${escapeHtml(s.id)}" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap"><strong>${escapeHtml(s.name)}</strong><span class="card-desc">${r.count ? r.avg + '% · ' + escapeHtml(r.label) + (p ? ` · ${ordinal(p.pos)} of ${p.of}` : '') : 'No marks this term'}</span></div>
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
    <div style="overflow-x:auto"><table class="rc-marks" style="width:100%;border-collapse:collapse;font-size:11.5px;font-family:Arial,sans-serif">
      <thead style="background:#eef3f0"><tr><th style="${td};text-align:left">Subject</th><th style="${td}">BOT</th><th style="${td}">MOT</th><th style="${td}">EOT</th><th style="${td}">Final</th><th style="${td}">Grade</th><th style="${td};text-align:left">Remark</th><th class="rc-ini" style="${td}">Initials</th></tr></thead>
      <tbody>${r.results.map(x => `<tr><td style="${td}">${escapeHtml(x.subject)}</td><td style="${td};text-align:center">${cell(x.BOT)}</td><td style="${td};text-align:center">${cell(x.MOT)}</td><td style="${td};text-align:center">${cell(x.EOT)}</td><td style="${td};text-align:center;font-weight:700">${x.final}</td><td style="${td};text-align:center;font-weight:700">${escapeHtml(x.grade)}</td><td style="${td}">${escapeHtml(x.remark)}</td><td class="rc-ini" style="${td}"></td></tr>`).join('') || `<tr><td colspan="8" style="${td};text-align:center;color:#888">No marks recorded this term</td></tr>`}</tbody>
    </table></div>
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
    <div style="margin-top:22px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;font-size:11px;font-family:Arial,sans-serif"><div>____________________<br>Class teacher</div><div>____________________<br>Head teacher${state.settings.headTeacher ? '<br>' + escapeHtml(state.settings.headTeacher) : ''}</div><div>____________________<br>Parent / guardian</div></div>
    <p style="font-size:9.5px;color:#666;font-family:Arial,sans-serif;margin-top:10px">Grading: ${bands.map(b => `${escapeHtml(b.grade)} ${b.min}+`).join(' · ')}. Final = end-of-term mark, or the average of earlier tests when there is no end-of-term mark.</p>
  </section>`;
}
function openReportCard(studentId, termId) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const t = termId || (termsWithMarks(s).pop()) || (getCurrentTerm() || {}).id;
  printDoc(reportCardHtml(s, t, reportOptions()));
}
/* One learner's report card on screen, with Print. From a learner's page,
   "Back" returns to it. */
function previewReportCard(studentId, termId, back) {
  const s = state.students.find(x => x.id === studentId); if (!s) return;
  const t = termId || (termsWithMarks(s).pop()) || (getCurrentTerm() || {}).id;
  const html = reportCardHtml(s, t, reportOptions());
  openModal({
    title: escapeHtml(`${s.name} — ${termLabel(termById(t))}`), wide: true,
    bodyHtml: `<div class="report-preview">${html}</div>`,
    footHtml: (back ? `<button class="btn btn-ghost" type="button" data-act="learner" data-id="${escapeHtml(s.id)}" data-section="marks">Back to ${escapeHtml(s.name)}</button>` : '<button class="btn btn-ghost" data-modal-close>Close</button>')
      + '<button class="btn btn-primary" type="button" id="rcPreviewPrint">Print</button>',
    onOpen(root) { root.querySelector('#rcPreviewPrint').addEventListener('click', () => printDoc(html)); },
  });
}
/* "Printed on every card": what is on the Report cards screen, else what was
   used for the last class printed. */
function reportOptions() {
  const o = (state.settings && state.settings.reportOptions) || {};
  const begins = el('rcNextBegins') && el('rcNextBegins').value, fees = el('rcNextFees') && el('rcNextFees').value;
  return { nextTermBegins: begins || o.nextTermBegins || '', nextTermFees: Number(fees || o.nextTermFees) || 0 };
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
/* Report cards: every child in the class, each with View and Print. */
function renderReportCardList() {
  const box = el('rcList'); if (!box) return;
  const btn = el('rcPrintBtn');
  const cls = el('rcClass').value, stream = el('rcStream').value, termId = el('rcTerm').value;
  if (!cls) {
    if (el('rcWarn')) el('rcWarn').style.display = 'none';
    box.innerHTML = '<div class="empty">Choose a class to list its report cards.</div>';
    if (btn) { btn.disabled = true; btn.textContent = 'Print all report cards'; }
    return;
  }
  const pos = classPositions(termId, cls);
  const learners = visibleStudents().filter(s => s.class === cls && (!stream || s.stream === stream)).sort((a, b) => a.name.localeCompare(b.name));
  if (btn) { btn.disabled = !learners.length; btn.textContent = `Print all ${learners.length} report card${learners.length === 1 ? '' : 's'} for ${cls}${stream ? ' ' + stream : ''}`; }
  // Nobody prints a card with holes in it without knowing.
  const warn = el('rcWarn');
  if (warn) {
    const gaps = missingSheets(cls, stream, termId);
    warn.style.display = gaps.length ? '' : 'none';
    warn.innerHTML = gaps.length ? `<strong class="t-warn">Marks still missing — check before printing.</strong>
      ${gaps.slice(0, 6).map(g => `<div class="abs-item">${escapeHtml(g.subject)}: ${g.total - g.done} learner${g.total - g.done === 1 ? ' has' : 's have'} no ${escapeHtml(g.exam)} mark${g.teacher ? ` (${escapeHtml(g.teacher)})` : ''} — ${namesList(g.missing, 5)} · <button type="button" class="link-btn" ${sheetAttrs(cls, g.subject, g.set, termId)}>Open the mark sheet</button></div>`).join('')}
      ${gaps.length > 6 ? `<p class="card-desc">and ${gaps.length - 6} more. See Class results → Marks progress.</p>` : ''}` : '';
  }
  box.innerHTML = learners.length ? learners.map(s => {
    const r = studentTermResult(s, termId), p = pos[s.id];
    const c = (s.comments && s.comments[termId]) || {};
    const result = r.count ? `${r.avg}% · ${escapeHtml(r.label)}${p ? ` · ${ordinal(p.pos)} of ${p.of}` : ''}` : '<span class="t-warn">No marks yet</span>';
    const comments = c.classTeacher ? '<span class="t-ok">Comments written</span>' : '<span class="t-warn">No class-teacher comment yet</span>';
    return `<div class="rc-item"><div><div>${learnerLink(s.id, s.name)}</div><div class="card-desc">${result} · ${comments}</div></div>
      <div class="row-actions"><button class="btn btn-outline btn-xs" type="button" data-act="previewReport" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(termId)}">View</button><button class="btn btn-outline btn-xs" type="button" data-act="reportCard" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(termId)}">Print</button></div></div>`;
  }).join('') : '<div class="empty">No learners in this class.</div>';
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
  ['msClass', 'crClass', 'cmClass', 'rcClass'].forEach(id => fillSelect(id, classOpts));
  // When a new term opens, move every term picker to it, so marks are not
  // filed under last term by mistake. Otherwise keep the user's choice.
  const currentId = (getCurrentTerm() || {}).id;
  const termChanged = renderAcademicControls.lastCurrent !== currentId;
  renderAcademicControls.lastCurrent = currentId;
  ['msTerm', 'crTerm', 'cmTerm', 'rcTerm'].forEach(id => {
    const sel = el(id); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = termOptions(!termChanged && cur && termById(cur) ? cur : null);
  });
  // A stream picker only for a class that has streams.
  [['msStream', 'msClass', 'msStreamWrap'], ['crStream', 'crClass', 'crStreamWrap'], ['rcStream', 'rcClass', 'rcStreamWrap']].forEach(([sid, cid, wid]) => {
    if (!el(sid)) return;
    fillSelect(sid, streamOptions(el(cid).value));
    if (el(wid)) el(wid).style.display = streamsFor(el(cid).value).length ? '' : 'none';
  });
  // The subjects of the class being marked, and "Another subject…".
  if (el('msSubject')) {
    const cls = el('msClass').value;
    fillSelect('msSubject', '<option value="">All subjects (the whole mark sheet)</option>'
      + (cls ? subjectsFor(cls).map(x => `<option value="${escapeHtml(x)}">Only ${escapeHtml(x)}</option>`).join('') + `<option value="${OTHER_SUBJECT}">Add another subject…</option>` : ''));
  }
  const opts = reportOptions();
  if (el('rcNextBegins') && !el('rcNextBegins').value) el('rcNextBegins').value = opts.nextTermBegins;
  if (el('rcNextFees') && !el('rcNextFees').value && opts.nextTermFees) el('rcNextFees').value = opts.nextTermFees;
}

/* ── A teacher's home: "My work today" ─────────────────────────────────── */
/* A teacher opens the app on their own jobs: the class they call the roll for,
   and one card per subject they teach with how far each exam's marking has
   got. The director and the administrator see "Marks still missing" for the
   whole school instead. */
function classTeacherCard(cls) {
  const today = todayISO();
  const learners = visibleStudents().filter(s => s.class === cls);
  const regs = (state.registers || []).filter(r => r.class === cls && r.date === today);
  let status;
  if (!learners.length) status = `<p class="card-desc">No children in ${escapeHtml(cls)} yet. They are added when admitted.</p>`;
  else if (!regs.length) status = `<div class="t-warn" style="font-weight:600;margin-top:6px">Not taken yet today (${learners.length} children).</div>`;
  else {
    const recs = regs.flatMap(r => r.records || []);
    const absent = recs.filter(x => x.status === 'A').map(x => state.students.find(s => s.id === x.studentId)).filter(Boolean);
    const here = recs.filter(x => x.status === 'P' || x.status === 'L').length;
    const by = [...new Set(regs.map(r => r.markedBy).filter(Boolean))].join(', ');
    const at = regs.map(r => r.createdAt).filter(Boolean).sort()[0];
    const left = streamsFor(cls).filter(st => !regs.some(r => r.stream === st || !r.stream));
    status = `<div class="t-ok" style="font-weight:600;margin-top:6px">Taken${at ? ' at ' + escapeHtml(fmtWhen(at).split(', ').pop()) : ''}${by ? ' by ' + escapeHtml(by) : ''}.</div>
      <div>${here} present · ${absent.length} absent${absent.length ? ': ' + namesList(absent, 10, 'attendance') : ''}</div>
      ${left.length ? `<div class="t-warn">Not taken yet for ${escapeHtml(left.join(', '))}.</div>` : ''}`;
  }
  const streaks = typeof absentStreaks === 'function' ? absentStreaks([cls]) : [];
  return `<div class="work-card"><div class="work-title">Attendance today · ${escapeHtml(cls)}</div>
    <div class="card-desc">You are the class teacher: call the roll each morning.</div>${status}
    ${streaksHtml(streaks)}
    <div class="toolbar" style="margin-top:10px"><button class="btn ${regs.length ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" data-act="takeRegister" data-class="${escapeHtml(cls)}">${regs.length ? 'Open the register' : "Take today's attendance"}</button></div></div>`;
}
/* "Okello Peter: absent Mon 2, Tue 3, Wed 4 Nov — call the guardian 0772…". */
function streaksHtml(streaks) {
  if (!streaks.length) return '';
  return `<div class="form-label" style="margin:10px 0 2px">Absent 3 days or more in a row — call the guardian</div>
    ${streaks.map(x => {
      const n = normalizePhone(x.s.guardian);
      return `<div class="abs-item streak-item">${learnerLink(x.s.id, x.s.name, 'attendance')} <span class="card-desc">${escapeHtml(x.s.class)}</span>: absent ${x.days} days, ${escapeHtml(x.dates.map(d => fmtDay(d, false)).join(', '))}${n ? ` · <a href="tel:${escapeHtml(n)}">Call ${escapeHtml(x.s.guardian)}</a>` : ' · <span class="t-warn">no guardian number</span>'}</div>`;
    }).join('')}`;
}
function subjectWorkCard(cls, subject, termId) {
  const ix = markIndex(cls, '', termId);
  const chips = EXAM_SETS.map(e => {
    const p = ix.progress(e.id, subject);
    const given = ix.started.has(e.id);
    const full = p.total && p.done === p.total;
    const txt = !p.total ? 'no children yet' : full ? `${p.done} of ${p.total} ✓` : given ? `${p.done} of ${p.total} · ${p.total - p.done} to go` : 'not started';
    return `<button type="button" class="btn btn-outline btn-sm work-exam${full ? ' is-done' : given ? ' is-part' : ''}" ${sheetAttrs(cls, subject, e.id, termId)}><span>${escapeHtml(e.label)}</span><strong>${escapeHtml(txt)}</strong></button>`;
  }).join('');
  // The exam being marked now: the latest one given in this class.
  const now = [...EXAM_SETS].reverse().find(e => ix.started.has(e.id));
  const p = now && ix.progress(now.id, subject);
  const line = p && p.missing.length ? `<div class="card-desc" style="margin-top:8px">${escapeHtml(now.label)}: still to enter — ${namesList(p.missing, 8)}</div>` : '';
  return `<div class="work-card"><div class="work-title">${escapeHtml(subject)} · ${escapeHtml(cls)}</div>
    <div class="card-desc">Tap an exam to open its mark sheet, ready to type.</div><div class="work-exams">${chips}</div>${line}</div>`;
}
function renderMyWork() {
  const card = el('myWorkCard'), body = el('myWorkBody'); if (!card || !body) return;
  const role = currentSession ? currentSession.role : '';
  const term = getCurrentTerm(), termId = term && term.id;
  const set = (title, desc, html) => { card.style.display = ''; el('myWorkTitle').textContent = title; el('myWorkDesc').textContent = desc; body.innerHTML = html; };
  if (role === 'teacher') {
    const t = myTeaching();
    const rank = c => classRank(c);
    const teaches = [...t.teaches].sort((a, b) => rank(a.class) - rank(b.class) || subjectRank(a.class)(a.subject) - subjectRank(a.class)(b.subject));
    const parts = [];
    if (t.classTeacherOf) parts.push(classTeacherCard(t.classTeacherOf));
    if (termId) teaches.forEach(x => parts.push(subjectWorkCard(x.class, x.subject, termId)));
    if (!parts.length) {
      return set('My work today', 'Your class and subjects.', `<p class="card-desc">The director has not yet set the class you are class teacher of or the subjects you teach (Administration → Staff). Until then, use these:</p>
        <div class="toolbar" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-act="goto" data-to="directory/daily">Attendance today</button><button class="btn btn-outline btn-sm" type="button" data-act="goto" data-to="academics/marks">Enter marks</button></div>`);
    }
    return set('My work today', `${term ? termLabel(term) + ' · ' : ''}${fmtDay(todayISO())}`, parts.join(''));
  }
  if (['exec', 'admin'].includes(role) && termId) {
    const classes = visibleClasses();
    const gaps = classes.flatMap(c => missingSheets(c, '', termId));
    const anyGiven = classes.some(c => markIndex(c, '', termId).started.size);
    const desc = `${termLabel(term)}: every mark sheet that is not finished, and whose it is. Tap one to open it.`;
    if (!anyGiven) return set('Marks still missing', desc, `<p class="card-desc">No marks have been entered for ${escapeHtml(termLabel(term))} yet.</p>`);
    if (!gaps.length) return set('Marks still missing', desc, '<p class="card-desc t-ok">Every mark sheet started this term is complete.</p>');
    const MAX = 12;
    return set('Marks still missing', desc, gaps.slice(0, MAX).map(g => `<div class="abs-item work-gap"><div><strong>${escapeHtml(g.cls)} · ${escapeHtml(g.subject)}</strong> — ${escapeHtml(g.exam)}: ${g.done} of ${g.total}${g.teacher ? ` <span class="card-desc">· ${escapeHtml(g.teacher)}</span>` : ''}
        <div class="card-desc">Still to enter: ${namesList(g.missing, 6)}</div></div><button class="btn btn-outline btn-xs" type="button" ${sheetAttrs(g.cls, g.subject, g.set, termId)}>Open</button></div>`).join('')
      + (gaps.length > MAX ? `<p class="card-desc" style="margin-top:8px">and ${gaps.length - MAX} more. Academics → Class results shows each class's marks progress.</p>` : ''));
  }
  card.style.display = 'none';
}

/* ── One learner, every subject (from the learner's page) ──────────────── */
/* A make-up paper, or a child who joined late: their marks for one exam,
   subject by subject, by the same rules as the mark sheet. */
function openLearnerMarks(studentId, set, typed) {
  const s = visibleStudents().find(x => x.id === studentId); if (!s) return;
  if (!can('canAddAcademic')) return toast('You do not have permission.', 'error');
  const term = getCurrentTerm();
  if (!term) return toast('There is no current term yet. The office opens it under Fees → Terms & fee structures.', 'error');
  const termId = term.id;
  const ix = markIndex(s.class, '', termId);
  set = set || ([...EXAM_SETS].reverse().find(e => ix.started.has(e.id)) || EXAM_SETS[0]).id;
  const mine = mySubjectsFor(s.class);
  const subjects = subjectsFor(s.class).sort((a, b) => (mine ? Number(!mine.includes(a.toLowerCase())) - Number(!mine.includes(b.toLowerCase())) : 0));
  const out = subj => msOutOf[paperKey(s.class, termId, set, subj)] || 100;
  const markOf = subj => (s.academics || []).find(a => a.termId === termId && (a.examSet || 'EOT') === set && a.subject.toLowerCase() === subj.toLowerCase());
  const rows = subjects.map(subj => {
    const m = markOf(subj), locked = !!mine && !mine.includes(subj.toLowerCase());
    const key = subj.toLowerCase();
    const val = typed && key in typed ? typed[key].v : m ? round2(m.score * out(subj) / 100) : '';
    const o = typed && key in typed ? typed[key].o : out(subj);
    return `<div class="lm-row" data-subject="${escapeHtml(subj)}"${m ? ` data-pct="${m.score}"` : ''}>
      <div class="lm-subj">${escapeHtml(subj)}${locked ? `<div class="card-desc">Entered by ${escapeHtml(teacherOf(subj, s.class) || 'its teacher')}</div>` : ''}</div>
      <input class="input lm-score" type="number" inputmode="decimal" min="0" step="any" value="${escapeHtml(String(val))}"${locked ? ' disabled' : ''} aria-label="${escapeHtml(subj)} mark">
      <label class="lm-out">out of <input class="input lm-outof" type="number" inputmode="numeric" min="1" max="1000" value="${o}"${locked ? ' disabled' : ''} aria-label="${escapeHtml(subj)}: marked out of"></label>
      <span class="lm-pct">${m ? pctText(m.score) + ' ' + escapeHtml(gradeFor(s.level, m.score).grade) : ''}</span></div>`;
  }).join('');
  const seg = EXAM_SETS.map(e => `<button type="button" role="radio" data-lm-exam="${e.id}" class="${e.id === set ? 'on-P' : ''}" aria-checked="${e.id === set}">${escapeHtml(e.label)}</button>`).join('');
  openModal({
    title: escapeHtml(`Enter marks — ${s.name}`), wide: true,
    bodyHtml: `<p class="card-desc" style="margin:-6px 0 10px">${escapeHtml(classLabel(s.class, s.stream))} · ${escapeHtml(termLabel(term))}. For a make-up paper or a child who joined late: type each mark as written on the script, then press Save marks. Empty boxes are papers not marked yet.</p>
      <div class="form-label">Exam</div><div class="seg seg-words ms-exams" role="radiogroup" aria-label="Exam">${seg}</div>
      <div class="lm-list" style="margin-top:12px">${rows}</div>`,
    footHtml: `<button class="btn btn-ghost" type="button" data-act="learner" data-id="${escapeHtml(s.id)}" data-section="marks">Back to ${escapeHtml(s.name)}</button><button class="btn btn-primary" type="button" id="lmSave">Save marks</button>`,
    onOpen(root) {
      const read = () => [...root.querySelectorAll('.lm-row')].reduce((acc, r) => { acc[r.dataset.subject.toLowerCase()] = { v: r.querySelector('.lm-score').value, o: r.querySelector('.lm-outof').value }; return acc; }, {});
      const pctOf = r => {
        const v = r.querySelector('.lm-score').value; if (v === '') return null;
        const o = Math.max(1, Math.round(Number(r.querySelector('.lm-outof').value) || 100)), raw = Number(v);
        return !Number.isFinite(raw) || raw < 0 || raw > o ? NaN : round2(raw / o * 100);
      };
      root.addEventListener('input', e => {
        const r = e.target.closest('.lm-row'); if (!r) return;
        const p = pctOf(r);
        if (e.target.classList.contains('lm-outof')) msOutOf[paperKey(s.class, termId, set, r.dataset.subject)] = Math.max(1, Math.round(Number(e.target.value) || 100));
        r.querySelector('.lm-score').style.borderColor = Number.isNaN(p) ? 'var(--danger)' : '';
        r.querySelector('.lm-pct').textContent = p === null ? '' : Number.isNaN(p) ? `0–${r.querySelector('.lm-outof').value}` : `${pctText(p)} ${gradeFor(s.level, p).grade}`;
      });
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-lm-exam]'); if (!b || b.dataset.lmExam === set) return;
        openLearnerMarks(s.id, b.dataset.lmExam);
      });
      root.querySelector('#lmSave').addEventListener('click', async () => {
        const typedNow = read();
        const boxes = [...root.querySelectorAll('.lm-row')].filter(r => !r.querySelector('.lm-score').disabled).map(r => ({
          s, subj: r.dataset.subject, had: r.dataset.pct !== undefined ? Number(r.dataset.pct) : null, p: pctOf(r),
          raw: r.querySelector('.lm-score').value, out: r.querySelector('.lm-outof').value, inp: r.querySelector('.lm-score'),
        }));
        const res = await commitMarks(boxes, termId, set, s.name);
        if (res === 'saved') { renderAll(); openLearner(s.id, 'marks'); }
        else if (res === 'cancelled') openLearnerMarks(s.id, set, typedNow);
      });
    },
  });
}

Object.assign(ACTIONS, {
  openSheet: d => openMarkSheet(d.class, d.subject, d.exam, d.term),
  learnerMarks: d => openLearnerMarks(d.id),
  academic: d => openLearner(d.id, 'marks'),
  reportCard: d => openReportCard(d.id, d.term),
  previewReport: d => previewReportCard(d.id, d.term, d.back === '1'),
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
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    // Enter marks: the list follows the choices; Enter moves to the next child.
    ['msClass', 'msStream', 'msTerm', 'msSubject'].forEach(id => on(id, 'change', msChoiceChanged));
    on('msExamSeg', 'click', e => { const b = e.target.closest('[data-exam]'); if (b) msSetExam(b.dataset.exam); });
    on('msFind', 'input', msFilter);
    on('markSheetRoster', 'input', e => {
      if (e.target.classList.contains('ms-score')) msScoreTyped(e.target);
      else if (e.target.classList.contains('ms-outof')) msOutOfChanged(e.target);
    });
    // Enter moves down the column: the next child, same subject, as when marking a pile of scripts.
    on('markSheetRoster', 'keydown', e => {
      if (e.key !== 'Enter' || !e.target.classList.contains('ms-score')) return;
      e.preventDefault();
      const col = [...document.querySelectorAll('#markSheetRoster .ms-score')].filter(x => x.dataset.subject === e.target.dataset.subject && x.closest('tr').style.display !== 'none');
      const next = col[col.indexOf(e.target) + 1];
      (next || el('msSaveBtn')).focus();
    });
    on('msSaveBtn', 'click', saveMarkSheet);
    ['crClass', 'crStream', 'crTerm'].forEach(id => on(id, 'change', () => { if (id === 'crClass') renderAcademicControls(); renderClassResults(); }));
    on('crPrintBtn', 'click', printClassResults);
    ['cmClass', 'cmTerm'].forEach(id => on(id, 'change', renderCommentSheet));
    on('cmSuggestBtn', 'click', fillSuggestedComments);
    on('cmSaveBtn', 'click', saveComments);
    ['rcClass', 'rcStream', 'rcTerm'].forEach(id => on(id, 'change', () => { if (id === 'rcClass') renderAcademicControls(); renderReportCardList(); renderPublishBox(); }));
    on('rcPrintBtn', 'click', printClassReports);
    on('publishBtn', 'click', publishResults);
    on('unpublishBtn', 'click', unpublishResults);
    on('bandsSaveBtn', 'click', saveBands);
    on('bandsResetBtn', 'click', resetBands);
  },
  render() { renderAcademicControls(); renderClassResults(); renderReportCardList(); renderBandsForm(); renderPublishBox(); renderMyWork(); },
  // The home screen is looked at often: show it as things stand now.
  onSub(tab) { if (tab === 'overview') renderMyWork(); },
});
