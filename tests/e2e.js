/*
 * End-to-end test for the School Management Portal.
 *
 * Drives the real app in headless Chromium: sign-in, forced password change,
 * settings, registration, payments, reversals, editing, academics, audit,
 * report cards and role gating.
 *
 * Run locally:
 *   python3 -m http.server 8099          (from the repo root)
 *   npm install playwright && npx playwright install chromium
 *   node tests/e2e.js
 *
 * Environment:
 *   BASE_URL     page to test (default http://localhost:8099/index.html)
 *   CHROME_PATH  optional Chromium executable to use instead of Playwright's
 *
 * Exits with code 1 if any check fails.
 */
'use strict';

let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }

const BASE = process.env.BASE_URL || 'http://localhost:8099/index.html';
const ORIGIN = new URL(BASE).origin;

const results = [];
const errors = [];

async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log('PASS  ' + name); }
  catch (e) { results.push([false, name]); console.log('FAIL  ' + name + ' :: ' + e.message.split('\n')[0]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function changePassword(page, current, next) {
  await page.waitForSelector('#cpCurrent', { timeout: 5000 });
  await page.fill('#cpCurrent', current);
  await page.fill('#cpNew', next);
  await page.fill('#cpConfirm', next);
  await page.click('#cpSave');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
}
async function signIn(page, user, pass) {
  await page.fill('#loginUsername', user);
  await page.fill('#loginPassword', pass);
  await page.click('#loginBtn');
}
// Open a module, and optionally one of its sub-tabs (cards on other sub-tabs are hidden).
async function tab(page, name, sub) {
  await page.click(`.nav-tab[data-tab="${name}"]`);
  if (sub) await page.click(`#subNav [data-sub="${sub}"]`);
}

(async () => {
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await step('static assets resolve (service worker, icons, manifest)', async () => {
    for (const path of ['/service-worker.js', '/manifest.json', '/icon192.png', '/icon512.png', '/core.js', '/app.js', '/auth.js', '/styles.css']) {
      const res = await page.request.get(ORIGIN + new URL(BASE).pathname.replace(/[^/]*$/, '') + path.slice(1));
      assert(res.ok(), path + ' returned ' + res.status());
    }
    const sw = await (await page.request.get(ORIGIN + new URL(BASE).pathname.replace(/[^/]*$/, '') + 'service-worker.js')).text();
    assert(/CACHE_VERSION/.test(sw) && /network-first/i.test(sw), 'service-worker.js is not the network-first v2 worker');
    const manifest = await (await page.request.get(ORIGIN + new URL(BASE).pathname.replace(/[^/]*$/, '') + 'manifest.json')).json();
    for (const icon of manifest.icons) {
      const res = await page.request.get(ORIGIN + new URL(BASE).pathname.replace(/[^/]*$/, '') + icon.src);
      assert(res.ok(), 'manifest icon ' + icon.src + ' returned ' + res.status());
    }
  });

  await step('sign-in screen shows, no quick-fill or default password hints', async () => {
    assert(await page.isVisible('#authScreen'), 'auth screen hidden');
    assert(!(await page.isVisible('.role-pill')), 'quick-fill pills present');
    const text = await page.textContent('#authScreen');
    assert(!/Exec@2026|Admin@2026/.test(text), 'default password shown on sign-in screen');
  });

  await step('wrong password is rejected', async () => {
    await signIn(page, 'exec', 'wrongpass1');
    await page.waitForSelector('#authError', { state: 'visible' });
  });

  await step('first sign-in forces a password change with no skip', async () => {
    await signIn(page, 'exec', 'Exec@2026');
    await page.waitForSelector('.modal', { timeout: 6000 });
    const labels = await page.$$eval('.modal button', bs => bs.map(b => b.textContent.trim()));
    assert(!labels.some(t => /skip|cancel/i.test(t)), 'forced change can be skipped: ' + labels.join(','));
    assert(!(await page.$('.modal [data-modal-close]')), 'forced change has a close button');
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5); // backdrop
    await page.waitForTimeout(150);
    assert(await page.$('#cpCurrent'), 'forced change dismissed by Escape or backdrop');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#cpCurrent', { timeout: 5000 }).catch(() => { throw new Error('forced change not shown again after reload'); });
    await changePassword(page, 'Exec@2026', 'Head2026Pass');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    assert(!(await page.$('#cpCurrent')), 'password prompt still shown after changing it');
  });

  await step('the director sees ten modules with plain names', async () => {
    assert(await page.isVisible('#appShell'), 'app shell hidden');
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["overview","directory","register","academics","payments","sports","conduct","reports","noticeboard","admin"]', 'modules ' + JSON.stringify(tabs));
    const labels = await page.$$eval('.nav-tab', ns => ns.map(n => n.textContent.trim()));
    assert(labels.join('|') === 'Dashboard|Students|Attendance|Academics|Fees|Sports|Discipline|Reports|Notices|Administration', 'labels ' + labels.join('|'));
  });

  await step('school settings apply across the app', async () => {
    await tab(page, 'admin', 'profile');
    await page.fill('#setSchoolName', 'Nakawa Progressive Academy');
    await page.fill('#setMotto', 'Effort · Discipline · Excellence');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForTimeout(200);
    assert(/Nakawa/.test(await page.textContent('.topbar-title .t-name')), 'school name not applied');
  });

  await step('register a student (Students → Admit a student)', async () => {
    await tab(page, 'directory', 'admit');
    assert(!(await page.isVisible('#studentTableBody')), 'student list shown on the Admit sub-tab');
    await page.fill('#registerForm input[name="admissionNo"]', 'NPA/2026/001');
    await page.fill('#registerForm input[name="name"]', 'Nakato Sarah');
    await page.selectOption('#classSelect', 'S.4');
    await page.fill('#registerForm input[name="guardian"]', '0772123456');
    await page.fill('#registerForm input[name="fee"]', '600000');
    await page.selectOption('#registerForm select[name="gender"]', 'Female');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(200);
    const count = await page.evaluate(() => window.KSA.state().students.length);
    assert(count === 1, 'expected 1 student, got ' + count);
  });

  await step('script-like admission number is rejected', async () => {
    await page.fill('#registerForm input[name="admissionNo"]', '<img src=x onerror=alert(1)>');
    await page.fill('#registerForm input[name="name"]', 'Bad Actor');
    await page.selectOption('#classSelect', 'P.5');
    await page.fill('#registerForm input[name="guardian"]', '0700000000');
    await page.fill('#registerForm input[name="fee"]', '100000');
    await page.selectOption('#registerForm select[name="gender"]', 'Male');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(200);
    const count = await page.evaluate(() => window.KSA.state().students.length);
    assert(count === 1, 'unsafe admission number accepted');
  });

  await step('record a payment (any whole amount accepted)', async () => {
    await tab(page, 'payments', 'record');
    await page.selectOption('#paymentStudent', 'NPA/2026/001');
    await page.fill('#paymentForm input[name="amount"]', '250000');
    await page.fill('#paymentForm input[name="reference"]', 'MoMo TID 998877');
    await page.click('#paymentForm button[type="submit"]');
    await page.waitForTimeout(200);
    assert(/250,000/.test(await page.textContent('#paymentsTableBody')), 'payment missing from ledger');
  });

  await step('reversing a payment restores the balance', async () => {
    await page.click('#paymentsTableBody button[data-act="voidPayment"]');
    await page.waitForSelector('#mdInput');
    await page.fill('#mdInput', 'Entered twice');
    await page.click('#mdOk');
    await page.waitForTimeout(200);
    const paid = await page.evaluate(() => window.KSA.state().students[0].paid);
    assert(paid === 0, 'paid after reversal = ' + paid);
  });

  await step('edit a student', async () => {
    await tab(page, 'directory', 'list');
    await page.click('#studentTableBody button[data-act="editStudent"]');
    await page.waitForSelector('#editStudentForm');
    await page.fill('#editStudentForm input[name="fee"]', '550000');
    await page.click('#editStudentSave');
    await page.waitForTimeout(200);
    const fee = await page.evaluate(() => window.KSA.state().students[0].fee);
    assert(fee === 550000, 'fee after edit = ' + fee);
  });

  await step('O-Level aggregate shows for a sitting', async () => {
    await tab(page, 'academics', 'marks');
    for (const [subj, score] of [['Mathematics', '82'], ['English Language', '75'], ['Physics', '68']]) {
      await page.selectOption('#academicStudent', 'NPA/2026/001');
      await page.selectOption('#academicForm select[name="examSet"]', 'EOT');
      await page.fill('#academicForm input[name="subject"]', subj);
      await page.fill('#academicForm input[name="score"]', score);
      await page.click('#academicForm button[type="submit"]');
      await page.waitForTimeout(120);
    }
    assert(/Aggregate/.test(await page.textContent('#academicTableBody')), 'no aggregate shown');
  });

  await step('switching to competency grading re-grades entries', async () => {
    await tab(page, 'admin', 'profile');
    await page.selectOption('#setGrading', 'cbc');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForTimeout(150);
    await tab(page, 'academics', 'marks');
    assert(/competency/.test(await page.textContent('#academicTableBody')), 'competency grades not shown');
  });

  await step('financial actions are audited', async () => {
    await tab(page, 'admin', 'staff');
    assert(await page.isVisible('#auditLogBody'), 'audit log not on Administration → Staff accounts');
    const audit = await page.textContent('#auditLogBody');
    for (const action of ['PAYMENT_RECORD', 'PAYMENT_VOID', 'STUDENT_REGISTER', 'STUDENT_EDIT']) {
      assert(audit.includes(action), action + ' not audited');
    }
  });

  await step('report card prints with school name and result', async () => {
    await tab(page, 'directory', 'list');
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('#studentTableBody button[data-act="reportCard"]');
    await page.waitForTimeout(150);
    const doc = await page.textContent('#printArea');
    assert(/NAKAWA PROGRESSIVE ACADEMY/i.test(doc), 'report card missing school name');
    assert(/competency|Aggregate/i.test(doc), 'report card missing academic result');
  });

  /* ───────────────────────── Phase 1: billing ───────────────────────── */
  const acct = id => page.evaluate(sid => { const s = state.students.find(x => x.id === sid); const a = studentAccount(s); return { arrears: a.arrears, balance: a.balance, currentDue: a.currentDue, currentBilled: a.currentBilled }; }, id);
  const confirmModal = async () => { await page.waitForSelector('#mdOk'); await page.click('#mdOk'); await page.waitForTimeout(200); };

  await step('learner is billed for the current term (edit re-bills)', async () => {
    const a = await acct('NPA/2026/001');
    assert(a.currentBilled === 550000, 'current-term bill = ' + a.currentBilled);
  });

  await step('fee structure with boarder-only item and installments re-bills the term', async () => {
    await tab(page, 'payments', 'terms');
    await page.click('#addFeeStructureBtn');
    await page.waitForSelector('#fsForm');
    await page.selectOption('#fsForm select[name="appliesTo"]', 'O Level');
    const items = page.locator('#fsForm .fs-item');
    await items.nth(0).locator('[name="itemAmount"]').fill('500000');
    await page.click('#fsAddItem');
    await items.nth(1).locator('[name="itemName"]').fill('Boarding');
    await items.nth(1).locator('[name="itemAmount"]').fill('300000');
    await items.nth(1).locator('[name="itemWho"]').selectOption('boarders');
    await page.click('#fsAddInst'); await page.click('#fsAddInst');
    const inst = page.locator('#fsForm .fs-inst');
    await inst.nth(0).locator('[name="instDate"]').fill('2026-09-20'); await inst.nth(0).locator('[name="instPct"]').fill('60');
    await inst.nth(1).locator('[name="instDate"]').fill('2026-10-20'); await inst.nth(1).locator('[name="instPct"]').fill('40');
    await page.click('#fsSave');
    await page.waitForSelector('#fsForm', { state: 'detached' });
    await page.click('#applyFeeStructuresBtn');
    await confirmModal();
    const a = await acct('NPA/2026/001');
    assert(a.currentBilled === 500000, 'day scholar should pay 500,000, got ' + a.currentBilled);
    const inst2 = await page.evaluate(() => state.invoices.find(i => i.studentId === 'NPA/2026/001' && i.termId === getCurrentTerm().id).installments.map(i => i.amount));
    assert(JSON.stringify(inst2) === '[300000,200000]', 'installments ' + JSON.stringify(inst2));
  });

  await step('opening a new term carries the unpaid balance forward as arrears', async () => {
    await tab(page, 'payments', 'record');
    await page.selectOption('#paymentStudent', 'NPA/2026/001');
    await page.fill('#paymentForm input[name="amount"]', '200000');
    await page.click('#paymentForm button[type="submit"]');
    await page.waitForTimeout(150);
    await tab(page, 'payments', 'terms');
    await page.fill('#termForm input[name="year"]', '2027');
    await page.selectOption('#termForm select[name="term"]', 'Term 1');
    await page.click('#termForm button[type="submit"]');
    await confirmModal();
    const label = await page.evaluate(() => termLabel(getCurrentTerm()));
    assert(label === 'Term 1 2027', 'current term = ' + label);
    const a = await acct('NPA/2026/001');
    assert(a.arrears === 300000 && a.currentDue === 500000 && a.balance === 800000, 'account ' + JSON.stringify(a));
  });

  await step('payments clear the oldest term first', async () => {
    await tab(page, 'payments', 'record');
    await page.selectOption('#paymentStudent', 'NPA/2026/001');
    await page.fill('#paymentForm input[name="amount"]', '400000');
    await page.click('#paymentForm button[type="submit"]');
    await page.waitForTimeout(150);
    const a = await acct('NPA/2026/001');
    assert(a.arrears === 0 && a.currentDue === 400000, 'account ' + JSON.stringify(a));
  });

  await step('payment receipt prints the amount in words', async () => {
    await page.click('#paymentsTableBody [data-act="paymentReceipt"] >> nth=0');
    await page.waitForTimeout(100);
    const doc = await page.textContent('#printArea');
    assert(/Four Hundred Thousand Uganda Shillings only/.test(doc), 'amount in words missing');
  });

  await step('Fees → Fees dashboard shows arrears, methods and defaulters, and nothing else', async () => {
    await tab(page, 'payments', 'dashboard');
    assert(await page.isVisible('#topDefaulters') && await page.isVisible('#bulkSmsBtn'), 'fees dashboard not shown');
    assert(!(await page.isVisible('#recPaymentCard')) && !(await page.isVisible('#termMgmtCard')), 'other Fees sub-tabs still showing');
    assert(!(await page.isVisible('#metricsRow')), 'KPI strip shown outside the Dashboard');
    assert(/is owed by/.test(await page.textContent('#arrearsHeadline')), 'arrears headline missing');
    assert(/Cash/.test(await page.textContent('#collectionsByMethod')), 'collections by method missing');
    assert(/Nakato Sarah/.test(await page.textContent('#topDefaulters')), 'defaulter missing');
  });

  /* ───────────────────────── Phase 1: academics ───────────────────────── */
  let secondId;
  await step('class mark sheet saves a whole class and ranks positions', async () => {
    await tab(page, 'directory', 'admit');
    await page.fill('#registerForm input[name="name"]', 'Mugisha Brian');
    await page.selectOption('#classSelect', 'S.4');
    await page.fill('#registerForm input[name="guardian"]', '0772000111');
    await page.fill('#registerForm input[name="fee"]', '500000');
    await page.selectOption('#registerForm select[name="gender"]', 'Male');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(150);
    secondId = await page.evaluate(() => state.students.find(s => s.name === 'Mugisha Brian').id);
    await tab(page, 'academics', 'marksheet');
    await page.selectOption('#msClass', 'S.4');
    await page.fill('#msSubject', 'Biology');
    await page.click('#msLoadBtn');
    await page.fill('#markSheetRoster .ms-score[data-student="NPA/2026/001"]', '77');
    await page.fill(`#markSheetRoster .ms-score[data-student="${secondId}"]`, '60');
    await page.click('#msSaveBtn');
    await page.waitForTimeout(150);
    const pos = await page.evaluate(() => classPositions(getCurrentTerm().id, 'S.4'));
    assert(pos['NPA/2026/001'].pos === 1 && pos[secondId].pos === 2 && pos[secondId].of === 2, 'positions ' + JSON.stringify(pos));
    assert(/1 \/ 2/.test(await page.textContent('#academicTableBody')), 'position not shown in results table');
  });

  await step('Primary uses PLE grading: four subjects, aggregate and division', async () => {
    await tab(page, 'directory', 'admit');
    await page.fill('#registerForm input[name="name"]', 'Achieng Mary');
    await page.selectOption('#classSelect', 'P.7');
    await page.fill('#registerForm input[name="guardian"]', '0772000222');
    await page.fill('#registerForm input[name="fee"]', '350000');
    await page.selectOption('#registerForm select[name="gender"]', 'Female');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(150);
    const pid = await page.evaluate(() => state.students.find(s => s.name === 'Achieng Mary').id);
    await tab(page, 'academics', 'marks');
    for (const [subj, score] of [['English Language', '85'], ['Mathematics', '72'], ['Science', '66'], ['Social Studies', '58']]) {
      await page.selectOption('#academicStudent', pid);
      await page.fill('#academicForm input[name="subject"]', subj);
      await page.fill('#academicForm input[name="score"]', score);
      await page.click('#academicForm button[type="submit"]');
      await page.waitForTimeout(100);
    }
    const label = await page.evaluate(id => studentTermResult(state.students.find(s => s.id === id), getCurrentTerm().id).label, pid);
    assert(label === 'Aggregate 11 · Division I', 'PLE result = ' + label);
  });

  await step('grading scales can be edited and restored (Academics → Grading scales)', async () => {
    await tab(page, 'academics', 'grading');
    const text = await page.inputValue('#bands-primary');
    await page.fill('#bands-primary', text.replace('D1 80 1', 'D1 90 1'));
    await page.click('#bandsSaveBtn');
    await page.waitForTimeout(150);
    let label = await page.evaluate(() => studentTermResult(state.students.find(s => s.name === 'Achieng Mary'), getCurrentTerm().id).label);
    assert(label === 'Aggregate 12 · Division I', 'after edit = ' + label);
    await page.click('#bandsResetBtn');
    await confirmModal();
    label = await page.evaluate(() => studentTermResult(state.students.find(s => s.name === 'Achieng Mary'), getCurrentTerm().id).label);
    assert(label === 'Aggregate 11 · Division I', 'after reset = ' + label);
  });

  await step('report-card comments are saved per term', async () => {
    await tab(page, 'academics', 'comments');
    await page.selectOption('#cmClass', 'S.4');
    await page.click('#cmSuggestBtn');
    await page.click('#cmSaveBtn');
    await page.waitForTimeout(100);
    const c = await page.evaluate(() => (state.students.find(s => s.id === 'NPA/2026/001').comments || {})[getCurrentTerm().id]);
    assert(c && c.classTeacher && c.headTeacher, 'comments ' + JSON.stringify(c));
  });

  await step('a whole class of report cards prints, one per learner, with positions', async () => {
    await tab(page, 'academics', 'reportcards');
    await page.selectOption('#rcClass', 'S.4');
    await page.fill('#rcNextBegins', '2027-05-24');
    await page.click('#rcPrintBtn');
    await page.waitForTimeout(150);
    const cards = await page.$$eval('#printArea .report-card', n => n.length);
    assert(cards === 2, 'report cards printed = ' + cards);
    const doc = await page.textContent('#printArea');
    assert(/1st of 2/.test(doc) && /2nd of 2/.test(doc), 'positions missing on report cards');
    assert(/2027-05-24/.test(doc), 'next term date missing');
  });

  /* ───────────────────────── Phase 1: register ───────────────────────── */
  await step('class register records absences and offers guardian SMS (Attendance → Daily register)', async () => {
    await tab(page, 'register', 'daily');
    await page.selectOption('#regClass', 'S.4');
    await page.click(`#registerRoster .reg-row[data-student="${secondId}"] [data-set-status="A"]`);
    await page.click('#regSaveBtn');
    await page.waitForTimeout(150);
    const rec = await page.evaluate(id => state.registers[0].records.find(r => r.studentId === id).status, secondId);
    assert(rec === 'A', 'status saved = ' + rec);
    assert(/Mugisha Brian/.test(await page.textContent('#registerAbsentees')), 'absentee list missing');
  });

  await step("the dashboard shows today's class attendance, not sports", async () => {
    await tab(page, 'overview');
    assert(await page.isVisible('#metricsRow'), 'KPI strip missing on the Dashboard');
    const text = (await page.textContent('#attTodayBody')).replace(/\s+/g, ' ');
    // S.4 was marked (one present, one absent); P.7 was not.
    assert(/Registers marked\s*1 \/ 2/.test(text), 'registers marked: ' + text);
    assert(/Present\s*1 \(50%\)/.test(text) && /Absent\s*1/.test(text), 'counts: ' + text);
    assert(/Not marked yet: P\.7/.test(text), 'unmarked class missing: ' + text);
  });

  await step("What's new opens the right sub-tab and stays hidden once dismissed", async () => {
    assert(await page.isVisible('#whatsNewCard'), "What's new not shown");
    const items = await page.$$eval('#whatsNewList [data-to]', bs => bs.map(b => b.dataset.to));
    for (const to of ['register/daily', 'payments/terms', 'payments/bursaries', 'admin/staff']) assert(items.includes(to), `missing ${to} in ${items.join(' ')}`);
    await page.click('#whatsNewList [data-to="payments/terms"]');
    assert(await page.isVisible('#termMgmtCard') && !(await page.isVisible('#recPaymentCard')), 'did not land on Fees → Terms');
    const active = await page.$eval('#subNav [aria-selected="true"]', b => b.textContent);
    assert(active === 'Terms & fee structures', 'active sub-tab: ' + active);
    await tab(page, 'overview');
    await page.click('[data-act="dismissWhatsNew"]');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#appShell', { state: 'visible' });
    assert(await page.isVisible('#attTodayCard') && !(await page.isVisible('#whatsNewCard')), "What's new came back after a reload");
  });

  await step('a teacher account can be limited to chosen classes', async () => {
    await tab(page, 'admin', 'staff');
    await page.click('#userMgmtCard summary');
    await page.fill('#editUsername', 'tkato');
    await page.fill('#editDisplayName', 'Mr. Kato');
    await page.selectOption('#editRole', 'teacher');
    await page.check('#editAssignedClasses input[value="S.4"]');
    await page.fill('#editPassword', 'Teach2026x');
    await page.click('#userEditForm button[type="submit"]');
    await page.waitForTimeout(400);
    assert(/Mr\. Kato/.test(await page.textContent('#usersList')), 'teacher not listed');
  });

  /* ───────────────────────── Phase 1: tools ───────────────────────── */
  await step('CSV import previews, rejects bad rows and adds opening balances', async () => {
    await tab(page, 'directory', 'import');
    const csv = [
      'admission_no,name,class,stream,gender,guardian_phone,termly_fee,boarding,uneb_index,special_needs,sport,opening_balance',
      'NPA/2026/050,Opio Daniel,s2,East,M,0772 555 111,"450,000",Day,,,,120000',
      ',Bad Class,S.9,,F,0772555222,300000,Day,,,,0',
      'NPA/2026/001,Duplicate Admission,S.1,,F,0772555333,300000,Day,,,,0',
      ',=HYPERLINK(1),P.3,,F,0772555444,200000,Day,,,,0',
    ].join('\n');
    await page.setInputFiles('#importLearnersInput', { name: 'learners.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('#importGo');
    assert(/Import 2 learners/.test(await page.textContent('#importGo')), 'expected 2 good rows');
    await page.click('#importGo');
    await page.waitForTimeout(200);
    const opio = await page.evaluate(() => { const s = state.students.find(x => x.id === 'NPA/2026/050'); return s && { cls: s.class, stream: s.stream, arrears: studentAccount(s).arrears }; });
    assert(opio && opio.cls === 'S.2' && opio.stream === 'East' && opio.arrears === 120000, 'imported learner ' + JSON.stringify(opio));
  });

  await step('CSV export neutralises spreadsheet formulas', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportLearnersBtn')]);
    const text = require('fs').readFileSync(await dl.path(), 'utf8');
    assert(text.includes("\"'=HYPERLINK(1)\""), 'formula not neutralised');
  });

  await step('logo and school colour apply', async () => {
    await tab(page, 'admin', 'profile');
    await page.setInputFiles('#logoInput', require('path').join(__dirname, '..', 'icon192.png'));
    await page.waitForTimeout(600);
    assert(await page.evaluate(() => /^data:image\//.test(state.settings.logo || '')), 'logo not stored');
    assert(await page.$('#topCrest img'), 'logo not shown in top bar');
    await page.click('.swatch:has(input[value="maroon"])');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForTimeout(150);
    const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
    assert(brand === '#7a1f2b', 'brand colour = ' + brand);
  });

  await step('a daily snapshot is kept and listed for restore', async () => {
    await page.waitForTimeout(300);
    await tab(page, 'admin', 'data');
    await page.click('#snapshotsBtn');
    await page.waitForSelector('[data-snap]');
    const today = await page.evaluate(() => todayISO());
    assert(await page.$(`[data-snap="${today}"]`), 'no snapshot for today');
    await page.click('.modal [data-modal-close]');
  });

  await step('sign out', async () => {
    await page.click('#logoutBtn');
    await page.waitForSelector('#mdOk');
    await page.click('#mdOk');
    await page.waitForSelector('#authScreen', { state: 'visible' });
  });

  await step('Head of Sports gets one Sports module (with competitions and training inside) and no fees', async () => {
    await signIn(page, 'coach', 'Coach@2026');
    await changePassword(page, 'Coach@2026', 'Coach2026Xyz');
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["sports","noticeboard"]', 'coach modules ' + JSON.stringify(tabs));
    const subs = await page.$$eval('#subNav [data-sub]', bs => bs.map(b => b.textContent));
    assert(subs.join('|') === 'Programmes|Training attendance|Competitions & squads|Athletes|Bursary candidates', 'sports sub-tabs ' + subs.join('|'));
    await page.click('#subNav [data-sub="training"]');
    assert(await page.isVisible('#saveAttendanceBtn') && !(await page.isVisible('#programsGrid')), 'training sub-tab not shown on its own');
    await page.click('#subNav [data-sub="competitions"]');
    assert(await page.isVisible('#addCompetitionBtn') && await page.isVisible('#squadsGrid'), 'competitions & squads missing');
    await page.click('#subNav [data-sub="programmes"]');
    await page.fill('#programForm input[name="name"]', 'Football U-16');
    await page.fill('#programForm input[name="sport"]', 'Football');
    await page.click('#programForm button[type="submit"]');
    await page.waitForTimeout(150);
    assert(/Football U-16/.test(await page.textContent('#programsGrid')), 'programme not added from Sports → Programmes');
  });

  await step('signing in right after someone signs out keeps you signed in', async () => {
    await page.click('#logoutBtn');
    await page.waitForSelector('#mdOk');
    await page.click('#mdOk');
    await signIn(page, 'admin', 'Admin@2026');
    await changePassword(page, 'Admin@2026', 'Admin2026New');
    await page.waitForTimeout(3500);
    assert(await page.isVisible('#appShell'), 'signed out unexpectedly');
    const who = await page.evaluate(() => (AUTH.getSession() || {}).username);
    assert(who === 'admin', 'session = ' + who);
  });

  await step('forms submit once after signing out and back in', async () => {
    const before = await page.evaluate(() => state.students.length);
    await tab(page, 'directory', 'admit');
    await page.fill('#registerForm input[name="name"]', 'Kizza Paul');
    await page.selectOption('#classSelect', 'P.1');
    await page.fill('#registerForm input[name="guardian"]', '0772000333');
    await page.fill('#registerForm input[name="fee"]', '250000');
    await page.selectOption('#registerForm select[name="gender"]', 'Male');
    await page.click('#registerForm button[type="submit"]');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => state.students.length);
    assert(after === before + 1, `expected one new learner, got ${after - before}`);
  });

  await step('the administrator can view Sports and add a programme, but not act for the coach', async () => {
    await tab(page, 'sports', 'training');
    assert(await page.isVisible('#attendanceTableBody') && !(await page.isVisible('#trainingFormCard')), 'admin can mark training attendance');
    await page.click('#subNav [data-sub="competitions"]');
    assert(!(await page.isVisible('#addCompetitionBtn')) && !(await page.isVisible('#addSquadBtn')), 'admin can log results or create squads');
    await page.click('#subNav [data-sub="athletes"]');
    assert(!(await page.$('#athleteProfilesBody [data-act="athleteProfile"]')), 'admin can edit athlete profiles');
    await page.click('#subNav [data-sub="programmes"]');
    assert(await page.isVisible('#addProgramCard'), 'admin lost Add programme');
    await tab(page, 'payments');
    const subs = await page.$$eval('#subNav [data-sub]', bs => bs.map(b => b.dataset.sub));
    assert(!subs.includes('bursaries'), 'admin can award bursaries');
  });

  await step('the bursar gives any learner a bursary from Fees → Bursaries and the bill drops', async () => {
    await page.click('#logoutBtn');
    await page.waitForSelector('#mdOk');
    await page.click('#mdOk');
    await signIn(page, 'bursary', 'Bursary@2026');
    await changePassword(page, 'Bursary@2026', 'Bursar2026Xyz');
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["payments","reports","noticeboard"]', 'bursar modules ' + JSON.stringify(tabs));
    await tab(page, 'payments', 'bursaries');
    const pid = await page.evaluate(() => state.students.find(s => s.name === 'Achieng Mary').id);   // a P.7 pupil, not an athlete
    const before = (await acct(pid)).currentBilled;
    await page.selectOption('#bursaryStudent', pid);
    await page.click('#bursarySetBtn');
    await page.waitForSelector('#mdInput');
    await page.fill('#mdInput', '20');
    await page.click('#mdOk');
    await page.waitForTimeout(200);
    const after = (await acct(pid)).currentBilled;
    assert(before === 350000 && after === 280000, `bill ${before} → ${after}`);
    const list = await page.textContent('#bursaryListBody');
    assert(/Achieng Mary/.test(list) && /20%/.test(list) && /70,000/.test(list), 'bursary list: ' + list);
  });

  await step('teacher sees only the register, academics and assigned classes', async () => {
    await page.click('#logoutBtn');
    await page.waitForSelector('#mdOk');
    await page.click('#mdOk');
    await signIn(page, 'tkato', 'Teach2026x');
    await page.waitForSelector('#appShell', { state: 'visible' });
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["register","academics","noticeboard"]', 'teacher tabs ' + JSON.stringify(tabs));
    const labels = await page.$$eval('.nav-tab', ns => ns.map(n => n.textContent.trim()));
    assert(labels.join('|') === 'Attendance|Academics|Notices', 'teacher labels ' + labels.join('|'));
    await tab(page, 'register');
    const classes = await page.$$eval('#regClass option', o => o.map(x => x.value).filter(Boolean));
    assert(JSON.stringify(classes) === '["S.4"]', 'teacher classes ' + JSON.stringify(classes));
    const learners = await page.$$eval('#academicStudent option', o => o.map(x => x.textContent).filter(t => t !== 'Choose…'));
    assert(learners.length && learners.every(t => /S\.4/.test(t)), 'teacher sees other classes: ' + learners.join(' | '));
    await tab(page, 'academics');
    const subs = await page.$$eval('#subNav [data-sub]', bs => bs.map(b => b.dataset.sub));
    assert(JSON.stringify(subs) === '["marks","marksheet","comments","reportcards"]', 'teacher academics sub-tabs ' + JSON.stringify(subs));
  });

  /* ───────────────────────── Migration from v4 ───────────────────────── */
  await step('upgrading v4 data keeps every balance and maps marks to terms', async () => {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    p2.on('pageerror', e => errors.push('pageerror (migration): ' + e.message));
    const v4 = {
      version: 4, settings: { schoolName: 'Old School' },
      students: [
        { id: 'OLD1', name: 'Old One', class: 'S.1', level: 'O Level', fee: 600000, bursaryPct: 25, paid: 100000, academics: [{ id: 'a1', term: 'Term 2', subject: 'Mathematics', score: 70, grade: 'C3', points: 3, date: '2026-06-01' }], performanceNotes: [] },
        { id: 'OLD2', name: 'Old Two', class: 'P.4', level: 'Primary', fee: 333333, bursaryPct: 10, paid: 0, academics: [], performanceNotes: [] },
      ],
      payments: [{ id: 'P1', studentId: 'OLD1', amount: 100000, date: '2026-05-02', method: 'Cash', reference: '', recordedBy: '-', recordedByName: 'x', ts: '2026-05-02T00:00:00Z', void: false }],
      terms: [{ id: 'T2', year: '2026', term: 'Term 2', isActive: true }],
      attendance: [], conduct: [], programs: [], competitions: [], squads: [], notices: [], feeComponents: [],
    };
    await p2.addInitScript(data => { if (!localStorage.getItem('kampala_school_portal_state')) localStorage.setItem('kampala_school_portal_state', data); }, JSON.stringify(v4));
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    const r = await p2.evaluate(() => ({
      version: state.version,
      balances: state.students.map(s => studentBalance(s)),
      termId: state.students[0].academics[0].termId,
      invoices: state.invoices.length,
    }));
    // v4: round(600000 × 0.75) − 100000 = 350000 ; round(333333 × 0.9) = 300000
    assert(r.version === 5, 'version ' + r.version);
    assert(JSON.stringify(r.balances) === '[350000,300000]', 'balances ' + JSON.stringify(r.balances));
    assert(r.termId === 'T2' && r.invoices === 2, 'migration ' + JSON.stringify(r));
    await ctx.close();
  });

  await step('no runtime errors', async () => {
    assert(!errors.length, errors.join(' | '));
  });

  await browser.close();
  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test run crashed:', err); process.exit(1); });
