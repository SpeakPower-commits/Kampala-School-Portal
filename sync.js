/*
 * sync.js — the online edition's link between the app and the school database.
 *
 * The app keeps working on one in-memory `state`, exactly as in the offline
 * edition. Online:
 *   • loadSchool() fills `state` from the school's tables. The database's
 *     row-level security means each person receives only what their role may
 *     see (a teacher gets only their own classes).
 *   • push() compares `state` with the copy last saved to the database and
 *     sends only the rows that changed.
 *
 * Money is handled strictly. A payment row is only ever added, a reversal goes
 * through the database's void_payment() function, and bills and payments are
 * never deleted: removing a learner marks them as left and keeps their history.
 *
 * Unused in the offline edition.
 */
'use strict';

window.SYNC = (function () {
  let sb = null;             // Supabase client (set by auth-online.js)
  let schoolId = null;
  let role = null;
  let snapshot = null;       // the state as loaded, handed to the app once
  let last = null;           // { table: Map(key -> JSON) } as last saved
  let lastSettings = null;
  let running = null;        // the push in progress
  let rerun = false;
  let timer = null;
  let status = 'idle';
  let lastError = '';
  let importing = false;     // an offline backup is part-way in (payments are paused)

  // What each role may write, mirroring the database's row-level security:
  //   rw  add, change and remove rows    u  change existing rows only
  //   i   add rows only (the payment ledger)
  const WRITE = {
    exec:    { terms: 'rw', learners: 'rw', fee_structures: 'rw', invoices: 'rw', payments: 'i', marks: 'rw', comments: 'rw', registers: 'rw', conduct: 'rw', notices: 'rw', school_docs: 'rw' },
    admin:   { terms: 'rw', learners: 'rw', fee_structures: 'rw', invoices: 'rw', payments: 'i', marks: 'rw', comments: 'rw', registers: 'rw', conduct: 'rw', notices: 'rw', school_docs: 'rw' },
    bursary: { learners: 'u', invoices: 'rw', payments: 'i' },
    coach:   { learners: 'u', notices: 'rw', school_docs: 'rw' },
    teacher: { marks: 'rw', comments: 'rw', registers: 'rw' },
  };
  // Parents before children, so references always resolve.
  const TABLES = ['terms', 'learners', 'fee_structures', 'invoices', 'payments', 'marks', 'comments', 'registers', 'conduct', 'notices', 'school_docs'];
  const DOCS = ['programs', 'attendance', 'competitions', 'squads'];
  const PAGE = 1000;   // Supabase returns at most 1,000 rows per request
  const BATCH = 500;

  const num = v => Number(v) || 0;
  const day = v => (v ? String(v).slice(0, 10) : null);
  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

  /* ── The app's state → database rows ─────────────────────────────────── */
  function rowsFromState(st) {
    const out = {};
    TABLES.forEach(t => { out[t] = new Map(); });
    const put = (table, key, row) => out[table].set(key, row);

    (st.terms || []).forEach(t => put('terms', t.id, {
      id: t.id, year: String(t.year), term: t.term, start_date: day(t.startDate), end_date: day(t.endDate),
      is_active: !!t.isActive, opened_at: t.openedAt || null, results_published: !!t.resultsPublished,
    }));
    (st.students || []).forEach(s => {
      put('learners', s.id, {
        id: s.id, admission_no: s.id, name: s.name, class: s.class || '', stream: s.stream || '',
        level: s.level || 'Other', combination: s.combination || '', gender: s.gender || '',
        boarding: s.boardingStatus || 'Day', guardian_phone: s.guardian || '', fee: Math.round(num(s.fee)),
        bursary_pct: num(s.bursaryPct), uneb_index: s.unebIndexNo || '', sen: s.senFlag || '',
        sport: s.sport || '', skill: s.skillLevel || '',
        extra: { performanceNotes: s.performanceNotes || [], injuryLog: s.injuryLog || [], athleteProfile: s.athleteProfile || {} },
        deleted_at: null,
      });
      (s.academics || []).forEach(a => {
        if (!a.termId) return;   // a mark must belong to a term
        put('marks', a.id, {
          id: a.id, learner_id: s.id, term_id: a.termId, exam_set: a.examSet || 'EOT',
          subject: a.subject, score: num(a.score), recorded_on: day(a.date),
        });
      });
      Object.keys(s.comments || {}).forEach(termId => {
        const c = s.comments[termId];
        if (!c || (!c.classTeacher && !c.headTeacher)) return;
        const id = s.id + '|' + termId;
        put('comments', id, { id, learner_id: s.id, term_id: termId, class_teacher: c.classTeacher || '', head_teacher: c.headTeacher || '' });
      });
    });
    (st.feeStructures || []).forEach(f => put('fee_structures', f.id, {
      id: f.id, term_id: f.termId, applies_to: f.appliesTo || 'All', items: f.items || [],
      installments: f.installments || [], draft: !!f.draft,
    }));
    (st.invoices || []).forEach(i => put('invoices', i.id, {
      id: i.id, learner_id: i.studentId, term_id: i.termId || null, lines: i.lines || [], bursary_pct: num(i.bursaryPct),
      gross: Math.round(num(i.gross)), discount: Math.round(num(i.discount)), total: Math.round(num(i.total)),
      installments: i.installments || [], created_on: day(i.createdAt),
    }));
    (st.payments || []).forEach(p => put('payments', p.id, {
      id: p.id, learner_id: p.studentId, amount: Math.round(num(p.amount)), method: p.method || 'Cash',
      reference: p.reference || '', paid_on: day(p.date), recorded_by: isUuid(p.recordedBy) ? p.recordedBy : null,
      recorded_by_name: p.recordedByName || '', ts: p.ts || null, void: !!p.void,
      void_reason: p.voidReason || null, voided_by: p.voidedBy || null, voided_at: p.voidedAt || null,
    }));
    (st.registers || []).forEach(r => put('registers', r.id, {
      id: r.id, class: r.class, stream: r.stream || '', reg_date: day(r.date), records: r.records || [], marked_by: r.markedBy || '',
    }));
    (st.conduct || []).forEach(c => put('conduct', c.id, {
      id: c.id, learner_id: c.studentId, occurred_on: day(c.date), type: c.type || '', severity: c.severity || '',
      description: c.description || '', reported_by: c.reportedBy || '',
    }));
    (st.notices || []).forEach(n => put('notices', n.id, {
      id: n.id, title: n.title, body: n.body || '', category: n.category || 'General', posted_by: n.postedBy || '', posted_at: n.postedAt || null,
    }));
    DOCS.forEach(col => (st[col] || []).forEach(d => put('school_docs', col + '/' + d.id, { collection: col, id: d.id, data: d })));
    return out;
  }

  /* ── Database rows → the app's state ─────────────────────────────────── */
  function stateFromRows(r, settings) {
    const st = {
      version: 5, settings: settings || {}, students: [], payments: [], attendance: [], conduct: [], programs: [],
      competitions: [], squads: [], notices: [], terms: [], feeComponents: [], invoices: [], feeStructures: [], registers: [],
    };
    const termName = {};
    st.terms = r.terms.map(t => {
      termName[t.id] = t.term;
      return { id: t.id, year: t.year, term: t.term, startDate: t.start_date || '', endDate: t.end_date || '', isActive: !!t.is_active, openedAt: t.opened_at || '', resultsPublished: !!t.results_published };
    });
    const byId = {};
    r.learners.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach(l => {
      const x = l.extra || {};
      const s = {
        id: l.id, name: l.name, class: l.class, stream: l.stream, level: l.level, combination: l.combination,
        guardian: l.guardian_phone, fee: num(l.fee), paid: 0, gender: l.gender, boardingStatus: l.boarding,
        unebIndexNo: l.uneb_index, senFlag: l.sen, sport: l.sport, skillLevel: l.skill, bursaryPct: num(l.bursary_pct),
        performanceNotes: x.performanceNotes || [], injuryLog: x.injuryLog || [], athleteProfile: x.athleteProfile || {},
        academics: [], comments: {}, feeComponents: [], createdAt: String(l.created_at || '').slice(0, 10),
      };
      byId[l.id] = s; st.students.push(s);
    });
    // Records of learners who have left stay in the database but not on screen,
    // just as removing a learner hides them in the offline edition.
    const live = id => Object.prototype.hasOwnProperty.call(byId, id);
    r.marks.forEach(m => {
      if (!live(m.learner_id)) return;
      byId[m.learner_id].academics.push({ id: m.id, termId: m.term_id, examSet: m.exam_set, term: termName[m.term_id] || '', subject: m.subject, score: num(m.score), grade: '', points: 0, date: m.recorded_on || '' });
    });
    r.comments.forEach(c => {
      if (!live(c.learner_id)) return;
      byId[c.learner_id].comments[c.term_id] = { classTeacher: c.class_teacher, headTeacher: c.head_teacher };
    });
    st.feeStructures = r.fee_structures.map(f => ({ id: f.id, termId: f.term_id, appliesTo: f.applies_to, items: f.items || [], installments: f.installments || [], draft: !!f.draft }));
    st.invoices = r.invoices.filter(i => live(i.learner_id)).map(i => ({
      id: i.id, studentId: i.learner_id, termId: i.term_id, lines: i.lines || [], bursaryPct: num(i.bursary_pct),
      gross: num(i.gross), discount: num(i.discount), total: num(i.total), installments: i.installments || [], createdAt: i.created_on || '',
    }));
    st.payments = r.payments.filter(p => live(p.learner_id)).sort((a, b) => String(a.ts).localeCompare(String(b.ts))).map(p => ({
      id: p.id, studentId: p.learner_id, amount: num(p.amount), method: p.method, reference: p.reference, date: p.paid_on,
      recordedBy: p.recorded_by || '-', recordedByName: p.recorded_by_name, ts: p.ts, void: !!p.void,
      voidReason: p.void_reason || '', voidedBy: p.voided_by || '', voidedAt: p.voided_at || '',
    }));
    st.registers = r.registers.sort((a, b) => String(a.reg_date).localeCompare(String(b.reg_date))).map(g => ({ id: g.id, class: g.class, stream: g.stream, date: g.reg_date, records: g.records || [], markedBy: g.marked_by }));
    st.conduct = r.conduct.filter(c => live(c.learner_id)).sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on))).map(c => ({ id: c.id, studentId: c.learner_id, date: c.occurred_on, type: c.type, severity: c.severity, description: c.description, reportedBy: c.reported_by }));
    st.notices = r.notices.sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at))).map(n => ({ id: n.id, title: n.title, body: n.body, category: n.category, postedBy: n.posted_by, postedAt: n.posted_at }));
    r.school_docs.forEach(d => { if (DOCS.includes(d.collection)) st[d.collection].push(d.data); });
    return st;
  }

  function fingerprint(st) {
    const rows = rowsFromState(st), out = {};
    TABLES.forEach(t => { out[t] = new Map(); rows[t].forEach((row, key) => out[t].set(key, JSON.stringify(row))); });
    return out;
  }

  /* ── Loading ─────────────────────────────────────────────────────────── */
  async function fetchAll(table, extra) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select('*').eq('school_id', schoolId);
      if (extra) q = extra(q);
      q = table === 'school_docs' ? q.order('collection').order('id') : q.order('id');
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  async function loadSchool(id, roleName) {
    schoolId = id; role = roleName;
    const { data: schools, error } = await sb.from('schools').select('id,name,settings,importing').eq('id', id);
    if (error) throw error;
    if (!schools.length) throw new Error('This school could not be found.');
    importing = !!schools[0].importing;
    const [terms, learners, feeStructures, invoices, payments, marks, comments, registers, conduct, notices, docs] = await Promise.all([
      fetchAll('terms'), fetchAll('learners', q => q.is('deleted_at', null)), fetchAll('fee_structures'), fetchAll('invoices'),
      fetchAll('payments'), fetchAll('marks'), fetchAll('comments'), fetchAll('registers'), fetchAll('conduct'),
      fetchAll('notices'), fetchAll('school_docs'),
    ]);
    const settings = Object.assign({}, schools[0].settings || {});
    if (!settings.schoolName) settings.schoolName = schools[0].name;
    snapshot = stateFromRows({ terms, learners, fee_structures: feeStructures, invoices, payments, marks, comments, registers, conduct, notices, school_docs: docs }, settings);
    last = fingerprint(snapshot);
    lastSettings = JSON.stringify(snapshot.settings);
    setStatus('saved');
    return snapshot;
  }

  /* ── Saving ──────────────────────────────────────────────────────────── */
  const conflictKey = table => (table === 'school_docs' ? 'school_id,collection,id' : 'school_id,id');
  const withSchool = row => Object.assign({ school_id: schoolId }, row);

  async function writeRows(table, items, mode) {
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      const rows = chunk.map(it => withSchool(it.row));
      const { error } = mode === 'insert'
        ? await sb.from(table).insert(rows)
        : await sb.from(table).upsert(rows, { onConflict: conflictKey(table) });
      if (error) {
        // A payment saved by an earlier attempt that lost its reply: add the
        // others one at a time and skip the ones already there.
        if (mode === 'insert' && error.code === '23505') {
          for (const it of chunk) {
            const one = await sb.from(table).insert([withSchool(it.row)]);
            if (one.error && one.error.code !== '23505') throw one.error;
            last[table].set(it.key, it.json);
          }
          continue;
        }
        throw error;
      }
      chunk.forEach(it => last[table].set(it.key, it.json));
    }
  }

  async function saveTable(table, right, cur) {
    const before = last[table];
    const added = [], changed = [], removed = [];
    cur.forEach((row, key) => {
      const json = JSON.stringify(row), prev = before.get(key);
      if (prev === undefined) added.push({ key, row, json });
      else if (prev !== json) changed.push({ key, row, json, prev: JSON.parse(prev) });
    });
    before.forEach((json, key) => { if (!cur.has(key)) removed.push({ key, row: JSON.parse(json) }); });
    if (!added.length && !changed.length && !removed.length) return;

    if (table === 'payments') {
      if (added.length) await writeRows(table, added, 'insert');
      for (const it of changed) {
        if (it.row.void && !it.prev.void) {
          const { error } = await sb.rpc('void_payment', { p_school: schoolId, p_id: it.row.id, p_reason: it.row.void_reason || 'Reversed' });
          if (error && !/already reversed/i.test(error.message || '')) throw error;
        }
        before.set(it.key, it.json);   // nothing else about a payment ever changes
      }
      removed.forEach(it => before.delete(it.key));   // the ledger keeps every payment
      return;
    }

    if (right === 'rw') {
      if (added.length || changed.length) await writeRows(table, added.concat(changed), 'upsert');
    } else if (right === 'u') {
      for (const it of changed) {
        const values = Object.assign({}, it.row); delete values.id;
        const { error } = await sb.from(table).update(values).eq('school_id', schoolId).eq('id', it.row.id);
        if (error) throw error;
        before.set(it.key, it.json);
      }
    }
    if (!removed.length) return;
    if (table === 'invoices' || right !== 'rw') { removed.forEach(it => before.delete(it.key)); return; }
    if (table === 'learners') {
      const ids = removed.map(it => it.row.id);
      const { error } = await sb.from('learners').update({ deleted_at: new Date().toISOString() }).eq('school_id', schoolId).in('id', ids);
      if (error) throw error;
    } else if (table === 'school_docs') {
      for (const col of DOCS) {
        const ids = removed.filter(it => it.row.collection === col).map(it => it.row.id);
        if (!ids.length) continue;
        const { error } = await sb.from('school_docs').delete().eq('school_id', schoolId).eq('collection', col).in('id', ids);
        if (error) throw error;
      }
    } else {
      const { error } = await sb.from(table).delete().eq('school_id', schoolId).in('id', removed.map(it => it.row.id));
      if (error) throw error;
    }
    removed.forEach(it => before.delete(it.key));
  }

  async function pushOnce() {
    const app = window.KSA && window.KSA.state ? window.KSA.state() : null;
    if (!sb || !schoolId || !last || !app) return { ok: true };
    const rights = WRITE[role] || {};
    const cur = rowsFromState(app);
    let failure = null;
    for (const table of TABLES) {
      if (!rights[table]) continue;   // not this role's to change
      try { await saveTable(table, rights[table], cur[table]); }
      catch (e) { if (!failure) failure = e; }
    }
    if (role === 'exec') {
      const settingsJson = JSON.stringify(app.settings || {});
      if (settingsJson !== lastSettings) {
        const name = String((app.settings && app.settings.schoolName) || '').trim();
        const values = { settings: app.settings || {} };
        if (name.length >= 2) values.name = name.slice(0, 120);
        const { error } = await sb.from('schools').update(values).eq('id', schoolId);
        if (error) { if (!failure) failure = error; } else lastSettings = settingsJson;
      }
    }
    if (failure) return { ok: false, error: describe(failure), offline: isNetwork(failure) };
    return { ok: true };
  }

  function isNetwork(e) {
    const m = String((e && e.message) || e || '');
    return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed/i.test(m);
  }
  function describe(e) {
    if (isNetwork(e)) return 'No internet connection.';
    const m = String((e && e.message) || e || '');
    if (e && e.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Your role is not allowed to make this change.';
    return m || 'The school database did not accept the change.';
  }

  function setStatus(s, msg) {
    status = s; lastError = msg || '';
    const pill = document.getElementById('syncStatus');
    if (!pill) return;
    const text = { saving: 'Saving…', saved: 'All changes saved', offline: 'Offline — not saved yet', error: 'Not saved' }[s];
    if (!text) { pill.style.display = 'none'; return; }
    pill.style.display = '';
    pill.className = 'sync-pill sync-' + s;
    pill.textContent = text;
    pill.title = msg || text;
  }

  /* Save now; resolves to { ok, error } once the database has answered. */
  async function flush() {
    clearTimeout(timer); timer = null;
    if (running) { rerun = true; return running; }
    setStatus('saving');
    running = (async () => {
      let result;
      do { rerun = false; result = await pushOnce(); } while (rerun);
      return result;
    })();
    try {
      const result = await running;
      setStatus(result.ok ? 'saved' : (result.offline ? 'offline' : 'error'), result.error);
      return result;
    } finally { running = null; }
  }

  function schedule() {
    if (!sb || !schoolId || !last) return;
    setStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(() => { flush(); }, 400);
  }

  window.addEventListener('online', () => { if (status === 'offline' || status === 'error') schedule(); });

  /* ── Bringing in a school's offline backup ───────────────────────────── */
  /* Older offline records can lack a date or time the database requires. */
  function normalizeForImport(st) {
    const today = new Date().toISOString().slice(0, 10);
    (st.payments || []).forEach(p => {
      if (!p.date) p.date = (p.ts || today).slice(0, 10);
      if (!p.ts) p.ts = p.date + 'T00:00:00.000Z';
    });
    (st.notices || []).forEach(n => { if (!n.postedAt) n.postedAt = (n.date || today) + (n.date && n.date.length > 10 ? '' : 'T00:00:00.000Z'); });
    (st.conduct || []).forEach(c => { if (!c.date) c.date = today; });
    st.registers = (st.registers || []).filter(r => r.date && r.class);
    return st;
  }

  /* Billed and paid per learner: what the balance check compares. */
  function balancesOf(st) {
    const out = {};
    (st.students || []).forEach(s => { out[s.id] = { name: s.name, billed: 0, paid: 0 }; });
    (st.invoices || []).forEach(i => { if (out[i.studentId]) out[i.studentId].billed += Math.round(num(i.total)); });
    (st.payments || []).forEach(p => { if (!p.void && out[p.studentId]) out[p.studentId].paid += Math.round(num(p.amount)); });
    return out;
  }

  async function importBackup(st, progress) {
    const rows = rowsFromState(normalizeForImport(st));
    // Records that point at a learner or term not in the backup cannot be
    // filed; they are left out and counted.
    let skipped = 0;
    const learners = new Set(rows.learners.keys()), terms = new Set(rows.terms.keys());
    const drop = (table, test) => rows[table].forEach((row, key) => { if (test(row)) { rows[table].delete(key); skipped++; } });
    ['invoices', 'payments', 'marks', 'comments', 'conduct'].forEach(t => drop(t, r => !learners.has(r.learner_id)));
    ['marks', 'comments', 'fee_structures'].forEach(t => drop(t, r => !terms.has(r.term_id)));
    drop('invoices', r => r.term_id && !terms.has(r.term_id));

    const begin = await sb.rpc('begin_import', { p_school: schoolId });
    if (begin.error) throw begin.error;
    const total = TABLES.reduce((a, t) => a + rows[t].size, 0);
    let done = 0;
    for (const table of TABLES) {
      const list = [...rows[table].values()];
      for (let i = 0; i < list.length; i += BATCH) {
        const { error } = await sb.rpc('import_rows', { p_school: schoolId, p_table: table, p_rows: list.slice(i, i + BATCH) });
        if (error) throw error;
        done += Math.min(BATCH, list.length - i);
        if (progress) progress(done, total);
      }
    }
    const values = { settings: st.settings || {} };
    const name = String((st.settings && st.settings.schoolName) || '').trim();
    if (name.length >= 2) values.name = name.slice(0, 120);
    const { error } = await sb.from('schools').update(values).eq('id', schoolId);
    if (error) throw error;
    return { total, skipped };
  }

  return {
    attach(client) { sb = client; },
    detach() { clearTimeout(timer); timer = null; schoolId = null; role = null; snapshot = null; last = null; lastSettings = null; importing = false; setStatus('idle'); },
    loadSchool,
    /* For app.js loadState(): the loaded school as JSON, or null before sign-in. */
    read() { return snapshot ? JSON.stringify(snapshot) : null; },
    schedule,
    flush,
    status: () => ({ status, error: lastError }),
    schoolId: () => schoolId,
    client: () => sb,
    audit(action, detail) {
      if (!sb || !schoolId) return;
      sb.rpc('log_audit', { p_school: schoolId, p_action: String(action).slice(0, 40), p_detail: String(detail || '').slice(0, 200) })
        .then(({ error }) => { if (error) console.warn('Audit entry not saved:', error.message); }, () => {});
    },
    importBackup,
    balancesOf,
    async finishImport(summary) {
      const { error } = await sb.rpc('finish_import', { p_school: schoolId, p_summary: String(summary || '').slice(0, 200) });
      if (error) throw error;
      importing = false;
    },
    async cancelImport() {
      const { error } = await sb.rpc('cancel_import', { p_school: schoolId });
      if (error) throw error;
      importing = false;
    },
    importing: () => importing,
    role: () => role,
    // Exposed for the automated tests.
    _rowsFromState: rowsFromState,
    _stateFromRows: stateFromRows,
  };
})();
