/* =========================================================================
   learner.js — one page for one child.

   Details, attendance this term (with the dates absent), marks and the
   report card, fees, sports and discipline, in one place. It opens from any
   child's name (data-act="learner"). Each section shows only for staff who
   use that part of the app, and teachers can open only their own classes.
   ========================================================================= */
'use strict';

const LEARNER_SECTIONS = [
  ['details', 'Details', () => true],
  ['attendance', 'Attendance', () => can('canMarkRegister') || hasTab('overview')],
  ['marks', 'Marks', () => hasTab('academics')],
  ['fees', 'Fees', () => hasTab('payments')],
  ['sports', 'Sports', () => hasTab('sports')],
  ['discipline', 'Discipline', () => hasTab('conduct')],
];

/* The sports programmes a learner is in (programAthletes is in app.js). */
function learnerProgrammes(s) {
  return (state.programs || []).filter(p => programAthletes(p).some(x => x.id === s.id));
}

const lpRow = (label, value) => `<div class="lp-row"><div class="lp-label">${label}</div><div>${value}</div></div>`;
const lpTile = (label, value, color) => `<div class="tile"><div class="stat-label">${label}</div><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div></div>`;
const lpDates = list => list.map(d => escapeHtml(fmtDay(d))).join(', ');

const LEARNER_HTML = {
  details(s) {
    const phone = p => {
      const n = normalizePhone(p);
      return n ? `<a href="tel:${escapeHtml(n)}">${escapeHtml(p)}</a>` : escapeHtml(p || '—');
    };
    const edit = can('canEditStudents') ? `<button class="btn btn-outline btn-sm" type="button" data-act="editStudent" data-id="${escapeHtml(s.id)}" data-back="1">Edit details</button>` : '';
    return `<div class="lp-rows">
      ${lpRow('Class', escapeHtml(s.class + (s.stream ? ' ' + s.stream : '')))}
      ${lpRow('Admission no.', escapeHtml(s.id))}
      ${lpRow('Gender', escapeHtml(s.gender || '—'))}
      ${lpRow('Day or boarding', escapeHtml(s.boardingStatus || 'Day'))}
      ${lpRow('Guardian', phone(s.guardian))}
      ${s.guardian2 ? lpRow('Second guardian', phone(s.guardian2)) : ''}
      ${s.combination ? lpRow('Subjects', escapeHtml(s.combination)) : ''}
      ${s.unebIndexNo ? lpRow('UNEB index', escapeHtml(s.unebIndexNo)) : ''}
      ${s.senFlag ? lpRow('Special needs', escapeHtml(s.senFlag)) : ''}
    </div>${edit ? `<div class="toolbar" style="margin-top:12px">${edit}</div>` : ''}`;
  },

  attendance(s) {
    const t = getCurrentTerm();
    const a = learnerAttendance(s, t && t.startDate, t && t.endDate);
    if (!a.total) return `<p class="card-desc">No class registers taken for ${escapeHtml(s.name)} this term yet.</p>`;
    return `<p class="card-desc" style="margin:0 0 10px">${escapeHtml(termLabel(t))}: ${a.total} day${a.total === 1 ? '' : 's'} with a register.</p>
      <div class="grid lp-tiles">
        ${lpTile('Present', `${a.present} <span class="card-desc">of ${a.total}</span>`, 'var(--success)')}
        ${lpTile('Absent', a.absent.length, a.absent.length ? 'var(--danger)' : '')}
        ${lpTile('Late', a.late.length, a.late.length ? 'var(--warn)' : '')}
        ${lpTile('Rate', a.rate + '%', a.rate >= 90 ? 'var(--success)' : a.rate >= 75 ? 'var(--warn)' : 'var(--danger)')}
      </div>
      <div class="lp-rows" style="margin-top:12px">
        ${lpRow('Days absent', a.absent.length ? `<span class="t-bad">${lpDates(a.absent)}</span>` : '<span class="t-ok">Never absent this term</span>')}
        ${a.late.length ? lpRow('Days late', lpDates(a.late)) : ''}
        ${a.excused.length ? lpRow('Days excused', lpDates(a.excused)) : ''}
      </div>
      <p class="card-desc" style="margin-top:10px">Days late count as days present, as on the report card.</p>`;
  },

  marks(s) {
    const terms = termsWithMarks(s);
    const cur = getCurrentTerm();
    const termId = cur && terms.includes(cur.id) ? cur.id : terms[terms.length - 1];
    if (!termId) return `<p class="card-desc">No marks recorded for ${escapeHtml(s.name)} yet.</p>`;
    const r = studentTermResult(s, termId);
    const p = classPositions(termId, s.class)[s.id];
    const cell = v => v === null || v === undefined ? '<span class="t-muted">—</span>' : v;
    // Only the exams that were sat (BOT, MOT, EOT), so the table fits a phone.
    const sets = ['BOT', 'MOT', 'EOT'].filter(k => r.results.some(x => x[k] !== null && x[k] !== undefined));
    return `<p class="card-desc" style="margin:0 0 10px">${escapeHtml(termLabel(termById(termId)))}</p>
      <div class="grid lp-tiles">
        ${lpTile('Average', r.avg + '%')}
        ${lpTile('Result', escapeHtml(r.label))}
        ${lpTile('Position in class', p ? `${ordinal(p.pos)} <span class="card-desc">of ${p.of}</span>` : '—')}
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="lp-marks"><thead><tr><th>Subject</th>${sets.map(k => `<th class="t-center">${k}</th>`).join('')}<th class="t-center">Final</th><th class="t-center">Grade</th></tr></thead><tbody>
      ${r.results.map(x => `<tr><td>${escapeHtml(x.subject)}</td>${sets.map(k => `<td class="t-center">${cell(x[k])}</td>`).join('')}<td class="t-center" style="font-weight:700">${x.final}</td><td class="t-center" style="font-weight:700;color:var(--brand)">${escapeHtml(x.grade)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="toolbar" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" type="button" data-act="previewReport" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(termId)}" data-back="1">View report card</button>
        <button class="btn btn-outline btn-sm" type="button" data-act="reportCard" data-id="${escapeHtml(s.id)}" data-term="${escapeHtml(termId)}">Print report card</button>
      </div>`;
  },

  fees(s) {
    const a = studentAccount(s);
    const pays = state.payments.filter(p => p.studentId === s.id && !p.void).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 6);
    const record = can('canRecordPayment') ? `<button class="btn btn-primary btn-sm" type="button" data-act="payFor" data-id="${escapeHtml(s.id)}">Record a payment</button>` : '';
    return `<div class="grid lp-tiles">
        ${lpTile('Balance owed', fmtMoney(a.balance), a.balance > 0 ? 'var(--danger)' : 'var(--success)')}
        ${lpTile("This term's bill", fmtMoney(a.currentBilled))}
        ${lpTile('Paid this term', fmtMoney(a.currentPaid))}
        ${a.arrears > 0 ? lpTile('From earlier terms', fmtMoney(a.arrears), 'var(--danger)') : ''}
      </div>
      <div class="form-label" style="margin-top:14px">Recent payments</div>
      ${pays.length ? `<div class="lp-rows">${pays.map(p => lpRow(escapeHtml(fmtDay(p.date)), `${fmtMoney(p.amount)} <span class="card-desc">· ${escapeHtml(p.method || '')}${p.reference ? ' · ' + escapeHtml(p.reference) : ''}</span>`)).join('')}</div>` : '<p class="card-desc">No payments yet.</p>'}
      <div class="toolbar" style="margin-top:12px">${record}<button class="btn btn-outline btn-sm" type="button" data-act="feeReceipt" data-id="${escapeHtml(s.id)}">Print fee statement</button>
        ${a.balance > 0 ? `<button class="btn btn-outline btn-sm" type="button" data-act="smsBalance" data-id="${escapeHtml(s.id)}">SMS reminder</button><button class="btn btn-outline btn-sm" type="button" data-act="waBalance" data-id="${escapeHtml(s.id)}">WhatsApp reminder</button>` : ''}</div>`;
  },

  sports(s) {
    const progs = learnerProgrammes(s);
    const prof = s.athleteProfile || {};
    const edit = can('canLogPerformance') ? `<button class="btn btn-outline btn-sm" type="button" data-act="athleteProfile" data-id="${escapeHtml(s.id)}">Edit athlete details</button>` : '';
    if (!progs.length) return `<p class="card-desc">${escapeHtml(s.name)} is not in any sports programme.</p>${edit ? `<div class="toolbar" style="margin-top:12px">${edit}</div>` : ''}`;
    const blocks = progs.map(p => {
      const sessions = (state.attendance || []).filter(a => a.programId === p.id).map(a => ({ date: a.date, rec: (a.records || []).find(r => r.studentId === s.id) })).filter(x => x.rec);
      const missed = sessions.filter(x => !x.rec.present).map(x => x.date).sort().reverse();
      const came = sessions.length - missed.length;
      return `<div class="tile" style="margin-bottom:10px"><div style="font-weight:700">${escapeHtml(p.name)}</div>
        <div class="card-desc">${escapeHtml(p.sport)}${p.coach ? ' · Coach ' + escapeHtml(p.coach) : ''}${(p.days || []).length ? ' · ' + escapeHtml(p.days.join(', ')) : ''}</div>
        <div style="margin-top:8px">${sessions.length ? `Came to <strong>${came} of ${sessions.length}</strong> training sessions` : 'No training sessions recorded yet.'}</div>
        ${missed.length ? `<div style="margin-top:4px"><span class="abs-label t-bad">Missed:</span> ${lpDates(missed)}</div>` : ''}</div>`;
    }).join('');
    const details = [s.skillLevel && lpRow('Skill level', escapeHtml(s.skillLevel)), prof.position && lpRow('Position', escapeHtml(prof.position)),
      prof.personalBest && lpRow('Personal best', escapeHtml(prof.personalBest)), prof.injuryStatus && lpRow('Injury', escapeHtml(prof.injuryStatus))].filter(Boolean).join('');
    return blocks + (details ? `<div class="lp-rows">${details}</div>` : '') + (edit ? `<div class="toolbar" style="margin-top:12px">${edit}</div>` : '');
  },

  discipline(s) {
    const t = getCurrentTerm();
    const all = (state.conduct || []).filter(c => c.studentId === s.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const term = all.filter(c => inTermWindow(c.date, t));
    const n = { good: 0, concern: 0, serious: 0 };
    term.forEach(c => { n[conductKind(c).group]++; });
    const log = can('canLogConduct') ? `<button class="btn btn-primary btn-sm" type="button" data-act="logConductFor" data-id="${escapeHtml(s.id)}">Log a conduct entry</button>` : '';
    const row = c => { const k = conductKind(c); return lpRow(escapeHtml(fmtDay(c.date)), `<span class="badge ${CONDUCT_GROUPS[k.group][1]}">${escapeHtml(k.label)}</span>${c.description ? ' ' + escapeHtml(c.description) : ''}${c.reportedBy ? `<div class="card-desc">Reported by ${escapeHtml(c.reportedBy)}</div>` : ''}`); };
    const earlier = all.filter(c => !term.includes(c));
    return `<div class="grid lp-tiles lp-tiles-3">
        ${lpTile('Good', n.good, n.good ? 'var(--success)' : '')}
        ${lpTile('Concerns', n.concern, n.concern ? 'var(--warn)' : '')}
        ${lpTile('Serious', n.serious, n.serious ? 'var(--danger)' : '')}
      </div>
      <div class="form-label" style="margin-top:14px">${escapeHtml(termLabel(t))}</div>
      ${term.length ? `<div class="lp-rows">${term.map(row).join('')}</div>` : '<p class="card-desc">No conduct entries this term.</p>'}
      ${earlier.length ? `<div class="form-label" style="margin-top:14px">Earlier terms</div><div class="lp-rows">${earlier.slice(0, 8).map(row).join('')}</div>${earlier.length > 8 ? `<p class="card-desc">and ${earlier.length - 8} more.</p>` : ''}` : ''}
      ${log ? `<div class="toolbar" style="margin-top:12px">${log}</div>` : ''}`;
  },
};

function openLearner(id, section) {
  const s = visibleStudents().find(x => x.id === id);
  if (!s) return toast('That learner is not in your classes.', 'error');
  const sections = LEARNER_SECTIONS.filter(([, , ok]) => ok());
  let cur = sections.some(([k]) => k === section) ? section : sections[0][0];
  openModal({
    title: escapeHtml(s.name), wide: true,
    bodyHtml: `<p class="card-desc" style="margin:-6px 0 12px">${escapeHtml(s.class + (s.stream ? ' ' + s.stream : ''))} · Admission no. ${escapeHtml(s.id)}</p>
      ${sections.length > 1 ? `<nav class="subnav lp-tabs" role="tablist" aria-label="About ${escapeHtml(s.name)}">${sections.map(([k, label]) => `<button type="button" role="tab" data-lsec="${k}" aria-selected="${k === cur}">${label}</button>`).join('')}</nav>` : ''}
      <div id="learnerBody">${LEARNER_HTML[cur](s)}</div>`,
    footHtml: '<button class="btn btn-ghost" data-modal-close>Close</button>',
    onOpen(root) {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-lsec]'); if (!b) return;
        cur = b.dataset.lsec;
        root.querySelectorAll('[data-lsec]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.lsec === cur)));
        root.querySelector('#learnerBody').innerHTML = LEARNER_HTML[cur](s);
      });
    },
  });
}

Object.assign(ACTIONS, {
  learner: d => openLearner(d.id, d.section),
  // From a learner's Discipline: open the conduct form with them chosen.
  logConductFor: d => {
    closeModal();
    switchTab('conduct');
    chooseConductLearner(d.id);
    const t = el('conductType'); if (t) t.focus();
  },
  // From a learner's Fees: open Record payment with them chosen.
  payFor: d => {
    closeModal();
    switchTab('payments', 'record');
    choosePayLearner(d.id);
    const amt = el('payAmount'); if (amt) amt.focus();
  },
});
