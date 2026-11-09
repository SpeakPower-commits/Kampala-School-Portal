/*
 * End-to-end tests for the ONLINE edition.
 *
 * Starts the local stand-in for Supabase (supabase/dev/server.mjs: real
 * Postgres in WebAssembly with the real migrations and row-level security),
 * then drives the portal in headless Chromium using the official supabase-js
 * client. It covers signing in, loading a school, saving changes, payments and
 * reversals, inviting staff, a teacher creating their own account, and what
 * each role can and cannot see. It checks the database itself, not just the
 * screen.
 *
 * Run from the repo root:
 *   npm install --no-save playwright @electric-sql/pglite
 *   npx playwright install chromium
 *   node tests/online.e2e.mjs
 *
 * Exits with code 1 if any check fails.
 */
import { createRequire } from 'node:module';
import { startStandIn } from '../supabase/dev/server.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }

const results = [];
const errors = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log('PASS  ' + name); }
  catch (e) { results.push(false); console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── A school on the stand-in: a director, an invited bursar, one P.7 learner ──
const S = await startStandIn({ port: 0 });
const DIRECTOR = 'director@kampalahill.ug', BURSAR = 'bursar@kampalahill.ug', TEACHER = 'ruth.teacher@kampalahill.ug';
const directorId = await S.addUser(DIRECTOR, 'Director2026');
const school = (await S.sql("select public.create_school('Kampala Hill Primary & Secondary', 'Sarah Namubiru') as id", [], DIRECTOR)).rows[0].id;
await S.sql("insert into public.invites (school_id, email, role, display_name) values ($1, $2, 'bursary', 'Grace Atim')", [school, BURSAR], DIRECTOR);
const bursarId = await S.addUser(BURSAR, 'Bursar2026');
await S.sql("insert into public.learners (school_id, id, admission_no, name, class, level) values ($1, 'KHP/007', 'KHP/007', 'Okello Peter', 'P.7', 'Primary')", [school], DIRECTOR);
const one = async (text, params = []) => (await S.sql(text, params)).rows[0];
const count = async (table, extra = '', params = []) => Number((await one(`select count(*) as n from public.${table} where school_id = $1 ${extra}`, [school, ...params])).n);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

// Open a module, and optionally one of its sub-tabs (cards on other sub-tabs are hidden).
const tab = async (name, sub) => {
  await page.click(`.nav-tab[data-tab="${name}"]`);
  if (sub) await page.click(`#subNav [data-sub="${sub}"]`);
};
const app = fn => page.evaluate(fn);
const saved = async () => { const r = await page.evaluate(() => SYNC.flush()); assert(r.ok, 'not saved: ' + r.error); };
// Poll the database (from the test, not the page) until a check comes true.
async function eventually(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 50));
  }
}
// Wait until a check run inside the page comes true. This polls with
// page.evaluate instead of page.waitForFunction: some Playwright versions run
// waitForFunction's check as eval inside the page, which the portal's
// Content-Security-Policy (script-src 'self') rightly forbids.
async function until(check, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try { ok = await page.evaluate(check); }
    catch (e) { if (!/context was destroyed|navigat/i.test(e.message)) throw e; }   // mid-navigation: try again
    if (ok) return;
    if (Date.now() > end) throw new Error('timed out waiting for: ' + String(check).slice(6, 110));
    await new Promise(r => setTimeout(r, 50));
  }
}
async function signIn(email, password) {
  await page.fill('#loginUsername', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginBtn');
}
async function signOut() {
  await page.click('#logoutBtn');
  await page.click('#mdOk');
  await page.waitForSelector('#authScreen', { state: 'visible' });
}

try {
  await step('the online edition opens on an email sign-in screen', async () => {
    await page.goto(S.url + '/');
    await until(() => document.getElementById('loginBtn').textContent === 'Sign in');
    assert(await app(() => PORTAL.edition) === 'online', 'edition is not online');
    assert(await page.textContent('label[for="loginUsername"]') === 'Email address', 'label is not "Email address"');
    assert(await page.isVisible('#signUpBtn') && await page.isVisible('#forgotPwdBtn'), 'account links missing');
  });

  await step('a wrong password is refused', async () => {
    await signIn(DIRECTOR, 'wrong-password1');
    await page.waitForSelector('#authError', { state: 'visible' });
    assert(/Incorrect email or password/.test(await page.textContent('#authError')), await page.textContent('#authError'));
  });

  await step('the director signs in and the school opens', async () => {
    await signIn(DIRECTOR, 'Director2026');
    await page.waitForSelector('#appShell', { state: 'visible' });
    assert(await page.textContent('#roleChip') === 'Executive', 'role chip ' + await page.textContent('#roleChip'));
    assert(await page.textContent('#userName') === 'Sarah Namubiru', 'user name ' + await page.textContent('#userName'));
    const names = await app(() => window.KSA.state().students.map(s => s.name));
    assert(JSON.stringify(names) === '["Okello Peter"]', 'learners ' + JSON.stringify(names));
    assert(await page.isVisible('#syncStatus'), 'save indicator hidden');
    await tab('admin', 'data');
    assert(await page.isVisible('#adminExportBtn'), 'Data & backup not shown');
    assert(!(await page.isVisible('#resetCard')) && !(await page.isVisible('#snapshotsBtn')) && !(await page.isVisible('#importLabel')), 'device-only tools shown online');
  });

  await step('registering a learner saves the learner, the term and the bill to the database', async () => {
    await tab('directory', 'admit');
    await page.fill('#registerForm input[name="admissionNo"]', 'KHS/2026/001');
    await page.fill('#registerForm input[name="name"]', 'Nakato Sarah');
    await page.selectOption('#classSelect', 'S.4');
    await page.fill('#registerForm input[name="guardian"]', '0772123456');
    await page.fill('#registerForm input[name="guardian2"]', '0701234567');
    await page.fill('#registerForm input[name="fee"]', '600000');
    await page.selectOption('#registerForm select[name="gender"]', 'Female');
    await page.click('#registerForm button[type="submit"]');
    await saved();
    assert(await count('learners') === 2, 'learners in database: ' + await count('learners'));
    const g = await one("select guardian_phone, guardian2_phone from public.learners where school_id = $1 and id = 'KHS/2026/001'", [school]);
    assert(g.guardian_phone === '0772123456' && g.guardian2_phone === '0701234567', 'guardians in database: ' + JSON.stringify(g));
    assert(await count('terms') === 1, 'terms in database: ' + await count('terms'));
    const bill = await one("select total, term_id from public.invoices where school_id = $1 and learner_id = 'KHS/2026/001'", [school]);
    assert(bill && Number(bill.total) === 600000 && bill.term_id, 'bill ' + JSON.stringify(bill));
    assert(await page.textContent('#syncStatus') === 'All changes saved', 'indicator: ' + await page.textContent('#syncStatus'));
  });

  await step('a payment is stored in the database, signed by the director', async () => {
    await tab('payments', 'record');
    await page.selectOption('#paymentStudent', 'KHS/2026/001');
    await page.fill('#paymentForm input[name="amount"]', '250000');
    await page.fill('#paymentForm input[name="reference"]', 'MoMo TID 998877');
    await page.click('#paymentForm button[type="submit"]');
    await until(() => window.KSA.state().payments.length === 1 && SYNC.status().status === 'saved');
    const p = await one('select amount, recorded_by, recorded_by_name, method from public.payments where school_id = $1', [school]);
    assert(p && Number(p.amount) === 250000, 'payment row ' + JSON.stringify(p));
    assert(p.recorded_by === directorId && p.recorded_by_name === 'Sarah Namubiru', 'signed by ' + p.recorded_by_name);
  });

  await step('reversing a payment goes through the database and the audit trail', async () => {
    await page.click('#paymentsTableBody button[data-act="voidPayment"]');
    await page.fill('#mdInput', 'Entered twice');
    await page.click('#mdOk');
    await until(() => window.KSA.state().payments[0].void && SYNC.status().status === 'saved');
    const p = await one('select void, void_reason, voided_by from public.payments where school_id = $1', [school]);
    assert(p.void === true && p.void_reason === 'Entered twice' && p.voided_by === 'Sarah Namubiru', 'void ' + JSON.stringify(p));
    assert(await count('audit_log', "and action = 'PAYMENT_VOID'") === 1, 'no PAYMENT_VOID audit entry');
    assert(await app(() => window.KSA.state().students.find(s => s.id === 'KHS/2026/001').paid) === 0, 'balance not restored');
  });

  await step('without internet, recording a payment is refused and nothing is saved', async () => {
    await context.setOffline(true);
    let msg;
    try {
      await page.selectOption('#paymentStudent', 'KHS/2026/001');
      await page.fill('#paymentForm input[name="amount"]', '1000');
      await page.click('#paymentForm button[type="submit"]');
      await until(() => /internet connection/.test(document.getElementById('toastHost').textContent));
      msg = await page.textContent('#toastHost');
    } finally { await context.setOffline(false); }
    assert(/needs an internet connection/.test(msg), 'message: ' + msg);
    assert(await app(() => window.KSA.state().payments.length) === 1, 'payment kept locally while offline');
    assert(await count('payments') === 1, 'payment reached the database');
  });

  await step('after a reload the school opens again from the database', async () => {
    await page.reload();
    await page.waitForSelector('#appShell', { state: 'visible' });
    const st = await app(() => ({ learners: window.KSA.state().students.length, payments: window.KSA.state().payments.length, voided: window.KSA.state().payments[0] && window.KSA.state().payments[0].void }));
    assert(st.learners === 2 && st.payments === 1 && st.voided === true, 'after reload ' + JSON.stringify(st));
  });

  await step('a payment whose reply is lost is kept and saved once, never doubled', async () => {
    // The database stores the payment, then the reply is lost, as on a flaky connection.
    let dropped = 0;
    await page.route('**/rest/v1/payments*', async route => {
      if (route.request().method() === 'POST' && !dropped) { dropped++; await route.fetch(); return route.abort('failed'); }
      return route.continue();
    });
    try {
      await tab('payments', 'record');
      await page.selectOption('#paymentStudent', 'KHS/2026/001');
      await page.fill('#paymentForm input[name="amount"]', '75000');
      await page.click('#paymentForm button[type="submit"]');
      await until(() => /Connection lost while saving/.test(document.getElementById('toastHost').textContent));
    } finally { await page.unroute('**/rest/v1/payments*'); }
    assert(await count('payments', 'and amount = 75000') === 1, 'the database did not keep the payment');
    assert(await app(() => window.KSA.state().payments.some(p => p.amount === 75000)), 'the payment vanished from the screen');
    await saved();   // the retry finds the payment already stored and does not add another
    assert(await count('payments', 'and amount = 75000') === 1, 'payment doubled: ' + await count('payments', 'and amount = 75000'));
  });

  await step('the director invites a teacher for S.4', async () => {
    await tab('admin', 'staff');
    await page.click('#userMgmtCard summary');
    assert(!(await page.isVisible('#editPassword')), 'password box shown online');
    await page.fill('#editUsername', TEACHER);
    await page.fill('#editDisplayName', 'Ruth Nakato');
    await page.selectOption('#editRole', 'teacher');
    await page.check('#editAssignedClasses input[value="S.4"]');
    await page.click('#userEditForm button[type="submit"]');
    await until(() => /Invited/.test(document.getElementById('usersList').textContent));
    const inv = await one('select role, assigned_classes from public.invites where school_id = $1 and email = $2', [school, TEACHER]);
    assert(inv && inv.role === 'teacher' && JSON.stringify(inv.assigned_classes) === '["S.4"]', 'invite ' + JSON.stringify(inv));
  });

  await step("the director sets up SMS with the school's Africa's Talking account", async () => {
    await tab('admin', 'sms');
    await until(() => /SMS is not set up/.test(document.getElementById('smsStatus').textContent));
    await page.fill('#smsUsername', 'sandbox');
    await page.fill('#smsApiKey', 'atsk_test_KHS_0001');
    await page.fill('#smsSender', 'KHILL');
    await page.check('#smsSandbox');
    await page.click('#smsSettingsForm button[type="submit"]');
    await until(() => /SMS is set up/.test(document.getElementById('smsStatus').textContent));
    assert(/UGX 5,000/.test(await page.textContent('#smsStatus')), 'balance not shown: ' + await page.textContent('#smsStatus'));
    const row = await one('select at_username, sender_id, key_hint, key_cipher from public.school_sms where school_id = $1', [school]);
    assert(row && row.at_username === 'sandbox' && row.sender_id === 'KHILL' && row.key_hint === '0001' && !row.key_cipher.includes('atsk_test'), JSON.stringify(row));
    assert(!(await page.inputValue('#smsApiKey')), 'the key stayed in the form');
  });

  await step('signing out leaves nothing of the school in memory', async () => {
    await signOut();
    assert(await app(() => window.KSA.state().students.length) === 0, 'learners still in memory');
  });

  await step('the teacher creates their own account and joins as an S.4 teacher', async () => {
    await page.click('#signUpBtn');
    await page.fill('#suEmail', TEACHER);
    await page.fill('#suPwd', 'Teacher2026');
    await page.fill('#suConfirm', 'Teacher2026');
    await page.click('#suSave');
    await page.waitForSelector('#appShell', { state: 'visible' });
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["register","academics","noticeboard"]', 'teacher tabs ' + JSON.stringify(tabs));
    const names = await app(() => window.KSA.state().students.map(s => s.name));
    assert(JSON.stringify(names) === '["Nakato Sarah"]', 'teacher sees ' + JSON.stringify(names));
    assert(await app(() => window.KSA.state().payments.length + window.KSA.state().invoices.length) === 0, 'teacher received money records');
  });

  await step("the teacher's register reaches the database", async () => {
    await tab('register', 'daily');
    await page.selectOption('#regClass', 'S.4');
    await page.click('#registerRoster .reg-row[data-student="KHS/2026/001"] [data-set-status="A"]');
    await page.click('#regSaveBtn');
    await saved();
    const reg = await one("select class, records from public.registers where school_id = $1", [school]);
    assert(reg && reg.class === 'S.4' && reg.records.some(r => r.studentId === 'KHS/2026/001' && r.status === 'A'), 'register ' + JSON.stringify(reg));
  });

  await step("the teacher texts the absent learner's guardian", async () => {
    const before = S.smsOutbox.length;
    await page.click('#registerAbsentees [data-act="smsAbsentees"]');
    await page.waitForSelector('#smsSend');
    assert(/1<\/strong> message\b/.test(await page.innerHTML('#smsSummary')), 'summary: ' + await page.textContent('#smsSummary'));
    await page.click('#smsSend');
    await until(() => /1 sent/.test(document.getElementById('smsProgressText').textContent));
    await page.click('#smsCancel');
    const sms = S.smsOutbox.slice(before);
    assert(sms.length === 1 && sms[0].to === '+256772123456' && sms[0].from === 'KHILL' && /Nakato Sarah \(S\.4\) was absent from school/.test(sms[0].message), JSON.stringify(sms));
  });

  await step('the bursar sees money but no marks, and records a payment', async () => {
    await signOut();
    await signIn(BURSAR, 'Bursar2026');
    await page.waitForSelector('#appShell', { state: 'visible' });
    assert(await page.textContent('#roleChip') === 'Bursary', 'role ' + await page.textContent('#roleChip'));
    assert(await app(() => window.KSA.state().payments.length) === 2, 'bursar cannot see the ledger');
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(JSON.stringify(tabs) === '["payments","reports","noticeboard"]', 'bursar modules ' + JSON.stringify(tabs));
    await tab('payments', 'record');
    await page.selectOption('#paymentStudent', 'KHS/2026/001');
    await page.fill('#paymentForm input[name="amount"]', '100000');
    await page.click('#paymentForm button[type="submit"]');
    await until(() => window.KSA.state().payments.length === 3 && SYNC.status().status === 'saved');
    const p = await one('select recorded_by from public.payments where school_id = $1 and amount = 100000', [school]);
    assert(p && p.recorded_by === bursarId, 'payment not signed by the bursar');
  });

  await step("the bursar's bursary shows the new bill first, waits for the database, and is refused without internet", async () => {
    await tab('payments', 'bursaries');
    await page.selectOption('#bursaryClass', 'S.4');
    await page.selectOption('#bursaryStudent', 'KHS/2026/001');
    await page.click('#bursarySetBtn');
    await page.fill('#mdInput', '25');
    const preview = (await page.textContent('#bursaryPreview')).replace(/\s+/g, ' ');
    assert(/UGX 600,000 → UGX 450,000/.test(preview) && /UGX 150,000 off/.test(preview), 'preview: ' + preview);
    await page.click('#mdOk');
    // The "bill is now" message comes only once the database has the change.
    await until(() => /This term's bill is now UGX 450,000/.test(document.getElementById('toastHost').textContent));
    const l = await one("select bursary_pct from public.learners where school_id = $1 and id = 'KHS/2026/001'", [school]);
    assert(l && Number(l.bursary_pct) === 25, 'bursary in database: ' + JSON.stringify(l));
    const bill = await one("select total from public.invoices where school_id = $1 and learner_id = 'KHS/2026/001'", [school]);
    assert(bill && Number(bill.total) === 450000, 'bill in database: ' + JSON.stringify(bill));
    assert(await eventually(async () => await count('audit_log', "and action = 'BURSARY_AWARD'") === 1), 'no BURSARY_AWARD audit entry');
    await context.setOffline(true);
    try {
      await page.click('#bursarySetBtn');
      await page.fill('#mdInput', '40');
      await page.click('#mdOk');
      await until(() => /needs an internet connection/.test(document.getElementById('toastHost').textContent));
    } finally { await context.setOffline(false); }
    assert(await app(() => window.KSA.state().students.find(s => s.id === 'KHS/2026/001').bursaryPct) === 25, 'bursary changed without internet');
    await saved();
    const again = await one("select bursary_pct from public.learners where school_id = $1 and id = 'KHS/2026/001'", [school]);
    assert(Number(again.bursary_pct) === 25, 'bursary in database after the refusal: ' + JSON.stringify(again));
  });

  await step('the bursar sends fee reminders by SMS to both guardians, with the balance', async () => {
    const before = S.smsOutbox.length;
    await tab('payments', 'dashboard');
    // Who owes, one class at a time: nobody in P.7 owes; in S.4, Nakato Sarah.
    await page.selectOption('#oweClass', 'P.7');
    assert(await page.isDisabled('#bulkSmsBtn') && /Nobody in P\.7 owes fees/.test(await page.textContent('#oweSummary')), 'P.7: ' + await page.textContent('#oweSummary'));
    await page.selectOption('#oweClass', 'S.4');
    assert((await page.textContent('#bulkSmsBtn')).trim() === 'Text all 1 guardian in S.4', 'button: ' + await page.textContent('#bulkSmsBtn'));
    await page.click('#bulkSmsBtn');
    await page.waitForSelector('#smsSend');
    await page.check('#smsBoth');
    await until(() => document.getElementById('smsSend').textContent === 'Send 2 SMS' && !document.getElementById('smsSend').disabled);
    await page.click('#smsSend');
    await until(() => /2 sent/.test(document.getElementById('smsProgressText').textContent));
    await page.click('#smsCancel');
    const sms = S.smsOutbox.slice(before);
    // Bill 450,000 after the 25% bursary; paid 75,000 + 100,000 (the 250,000 was reversed).
    assert(sms.length === 2 && sms.every(m => /Nakato Sarah \(S\.4\) is UGX 275,000/.test(m.message)), JSON.stringify(sms));
    assert(JSON.stringify(sms.map(m => m.to).sort()) === '["+256701234567","+256772123456"]', 'numbers ' + sms.map(m => m.to));
    const camp = await one("select options from public.sms_campaigns where school_id = $1 and kind = 'fees' and status <> 'draft' order by created_at desc limit 1", [school]);
    assert(camp && camp.options.class === 'S.4', 'the reminders were not limited to S.4: ' + JSON.stringify(camp));
  });

  await step('the director publishes the term to parents and posts a notice for them by SMS', async () => {
    await signOut();
    await signIn(DIRECTOR, 'Director2026');
    await page.waitForSelector('#appShell', { state: 'visible' });
    await tab('academics', 'marks');
    await page.selectOption('#msClass', 'S.4');
    await page.selectOption('#msSubject', 'Mathematics');
    await page.fill('#markSheetRoster .ms-score[data-student="KHS/2026/001"]', '82');
    await page.click('#msSaveBtn');
    await saved();
    await tab('academics', 'reportcards');
    await until(() => /is not published/.test(document.getElementById('publishStatus').textContent));
    await page.click('#publishBtn');
    await page.click('#mdOk');
    await until(() => /is published/.test(document.getElementById('publishStatus').textContent));
    const r = await one("select position, out_of, result from public.term_results where school_id = $1 and learner_id = 'KHS/2026/001'", [school]);
    assert(r && r.position === 1 && r.out_of === 1 && r.result, 'published result ' + JSON.stringify(r));
    assert((await one('select bool_and(results_published) as p from public.terms where school_id = $1', [school])).p === true, 'term not marked published');

    const before = S.smsOutbox.length;
    await tab('noticeboard');
    await page.fill('#noticeForm input[name="title"]', 'Visiting day is Saturday');
    await page.fill('#noticeForm textarea[name="body"]', 'Parents are welcome from 10am.');
    await page.selectOption('#noticeAudience', 'all');
    await page.check('#noticeForm input[name="sms"]');
    await page.click('#noticeForm button[type="submit"]');
    await page.waitForSelector('#smsSend');
    await page.click('#smsSend');
    await until(() => /1 sent/.test(document.getElementById('smsProgressText').textContent));
    await page.click('#smsCancel');
    const sms = S.smsOutbox.slice(before);
    assert(sms.length === 1 && sms[0].message === 'Visiting day is Saturday: Parents are welcome from 10am. - Kampala Hill Primary & Secondary', JSON.stringify(sms));
    await saved();
    assert(await count('notices', "and audience = 'all'") === 1, 'the notice is not marked for parents');
  });

  await step('the SMS log lists the three runs that went out, and not the preview that was changed', async () => {
    await tab('admin', 'sms');
    await until(() => document.querySelectorAll('#smsLogBody tr td:nth-child(2)').length === 3);
    const log = await page.textContent('#smsLogBody');
    assert(/Notice to guardians/.test(log) && /Fee reminders/.test(log) && /Absence messages · S\.4/.test(log), log);
    assert(await count('sms_campaigns') === 3, 'runs in the database: ' + await count('sms_campaigns'));
  });

  await step("a programme's athletes, chosen by name, reach the database", async () => {
    await tab('sports', 'programmes');
    await page.fill('#programForm input[name="name"]', 'Netball A');
    await page.fill('#programForm input[name="sport"]', 'Netball');
    await page.click('#programForm button[type="submit"]');
    await saved();
    const id = await app(() => window.KSA.state().programs.find(p => p.name === 'Netball A').id);
    await page.click(`#programsGrid [data-act="programAthletes"][data-id="${id}"]`);
    await page.check('.modal .pa-tick[value="KHS/2026/001"]');
    await page.click('#paSave');
    await saved();
    const doc = await one("select data from public.school_docs where school_id = $1 and collection = 'programs' and id = $2", [school, id]);
    assert(doc && JSON.stringify(doc.data.athleteIds) === '["KHS/2026/001"]', JSON.stringify(doc));
  });

  // ── The parent portal, as a guardian would use it on their phone ──
  const pp = await context.newPage();
  pp.setDefaultTimeout(10000);
  pp.on('pageerror', e => errors.push('parent pageerror: ' + e.message));
  pp.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('parent console: ' + m.text()); });
  const codeAfter = before => { const m = S.smsOutbox.slice(before).find(x => /parent portal code/.test(x.message)); return m && /^(\d{6})/.exec(m.message)[1]; };

  await step('a number the school does not hold gets no sign-in code', async () => {
    await pp.goto(S.url + '/parent.html');
    await pp.waitForSelector('#pPhoneForm', { state: 'visible' });
    const before = S.smsOutbox.length;
    await pp.fill('#pPhone', '0700 000 555');
    await pp.click('#pSendCode');
    await pp.waitForSelector('#pError', { state: 'visible' });
    assert(/not on record/.test(await pp.textContent('#pError')), await pp.textContent('#pError'));
    assert(S.smsOutbox.length === before, 'a stranger was texted');
  });

  await step('a guardian signs in with an SMS code and sees only their child, with the same balance', async () => {
    const before = S.smsOutbox.length;
    await pp.fill('#pPhone', '0772 123 456');
    await pp.click('#pSendCode');
    await pp.waitForSelector('#pCodeForm', { state: 'visible' });
    const code = codeAfter(before);
    assert(code && S.smsOutbox.at(-1).to === '+256772123456' && S.smsOutbox.at(-1).from === 'KHILL', JSON.stringify(S.smsOutbox.at(-1)));
    await pp.fill('#pCode', code === '000000' ? '111111' : '000000');
    await pp.click('#pVerify');
    await pp.waitForSelector('#pError', { state: 'visible' });
    assert(/wrong or has expired/.test(await pp.textContent('#pError')), await pp.textContent('#pError'));
    await pp.fill('#pCode', code);
    await pp.click('#pVerify');
    await pp.waitForSelector('#pChild', { state: 'visible' });
    assert(/Nakato Sarah/.test(await pp.textContent('#pChildHead')) && !/Okello/.test(await pp.textContent('body')), 'wrong child shown');
    assert(/UGX 275,000/.test(await pp.textContent('#pBalance')), 'balance ' + await pp.textContent('#pBalance'));
  });

  await step('the parent sees the published report card, attendance and notices for parents only', async () => {
    await S.sql("insert into public.notices (school_id, id, title) values ($1, 'NSTAFF', 'Staff meeting at 4pm')", [school], DIRECTOR);
    await pp.reload();
    await pp.waitForSelector('#pChild', { state: 'visible' });
    await pp.click('#pTabs [data-ptab="results"]');
    const results = await pp.textContent('#pTabBody');
    assert(/Mathematics/.test(results) && /Position 1st of 1/.test(results), results);
    await pp.click('[data-act="pReport"]');
    await pp.waitForSelector('.modal .report-card');
    const card = await pp.textContent('.modal .report-card');
    assert(/Nakato Sarah/.test(card) && /Position in class:\s*1st of 1/.test(card) && /UGX 275,000/.test(card), card.slice(0, 300));
    await pp.click('.modal [data-modal-close]');
    await pp.click('#pTabs [data-ptab="attendance"]');
    assert((await pp.textContent('#pAbsent')).trim() === '1', 'absences ' + await pp.textContent('#pAbsent'));
    await pp.click('#pTabs [data-ptab="notices"]');
    const notices = await pp.textContent('#pTabBody');
    assert(/Visiting day is Saturday/.test(notices) && !/Staff meeting/.test(notices), notices);
  });

  await step('the second guardian signs in too', async () => {
    await pp.click('#pSignOut');
    await pp.waitForSelector('#pPhoneForm', { state: 'visible' });
    const before = S.smsOutbox.length;
    await pp.fill('#pPhone', '0701 234 567');
    await pp.click('#pSendCode');
    await pp.waitForSelector('#pCodeForm', { state: 'visible' });
    await pp.fill('#pCode', codeAfter(before));
    await pp.click('#pVerify');
    await pp.waitForSelector('#pChild', { state: 'visible' });
    assert(/Nakato Sarah/.test(await pp.textContent('#pChildHead')), 'second guardian did not see the child');
    await pp.close();
  });

  await step('"Forgot your password?" sends a reset link', async () => {
    await signOut();
    await page.click('#forgotPwdBtn');
    await page.fill('#fpEmail', BURSAR);
    await page.click('#fpSend');
    await until(() => !document.getElementById('fpEmail'));
    assert(S.outbox.some(m => m.to === BURSAR && m.kind === 'reset'), 'no reset link sent');
  });

  const HEAD = 'head@mbalehillside.ug';
  await S.addUser(HEAD, 'Hillside2026');
  let newSchool = null;

  await step('a director with no school yet starts one from the sign-in screen', async () => {
    await page.fill('#loginUsername', HEAD);
    await page.fill('#loginPassword', 'Hillside2026');
    await page.click('#loginBtn');
    await page.waitForSelector('#nsName');
    await page.fill('#nsName', 'Mbale Hillside School');
    await page.fill('#nsYou', 'Moses Wanyama');
    await page.click('#nsCreate');
    await page.waitForSelector('#appShell', { state: 'visible' });
    assert(await page.textContent('#roleChip') === 'Executive', 'role ' + await page.textContent('#roleChip'));
    newSchool = (await one("select id from public.schools where name = 'Mbale Hillside School'")).id;
    assert(newSchool, 'school not in the database');
    await tab('admin', 'data');
    assert(await page.isVisible('#onlineImportLabel'), 'import option not offered to a new school');
  });

  await step("the offline school's backup comes in and every balance is checked", async () => {
    const termId = 'TRMa1';
    const learner = (id, name, cls, fee, extra = {}) => Object.assign({ id, name, class: cls, level: 'Primary', guardian: '256772000111', fee, stream: '', gender: 'Female', boardingStatus: 'Day', bursaryPct: 0, academics: [], comments: {}, performanceNotes: [], injuryLog: [], athleteProfile: {}, feeComponents: [], createdAt: '2026-01-10' }, extra);
    const bill = (id, studentId, total, extra = {}) => Object.assign({ id, studentId, termId, lines: [{ name: 'Tuition', amount: total }], bursaryPct: 0, gross: total, discount: 0, total, installments: [], createdAt: '2026-02-01' }, extra);
    const pay = (id, studentId, amount, extra = {}) => Object.assign({ id, studentId, amount, method: 'Cash', reference: '', date: '2026-02-03', recordedBy: 'U003', recordedByName: 'Bursary Officer', ts: '2026-02-03T09:00:00.000Z', void: false }, extra);
    const backup = {
      version: 5,
      settings: { schoolName: 'Mbale Hillside School', currency: 'UGX', motto: 'Rise and shine' },
      terms: [{ id: termId, year: '2026', term: 'Term 1', startDate: '', endDate: '', isActive: true, openedAt: '2026-02-01T08:00:00.000Z' }],
      students: [
        learner('MHS/001', 'Achieng Mary', 'P.6', 450000, { academics: [{ id: 'AC1', termId, examSet: 'EOT', term: 'Term 1', subject: 'Mathematics', score: 81, date: '2026-04-01' }] }),
        learner('MHS/002', 'Kato John', 'P.7', 500000, { bursaryPct: 20, gender: 'Male' }),
        learner('MHS/003', 'Nabirye Ruth', 'P.3', 350000),
      ],
      invoices: [
        bill('INV1', 'MHS/001', 450000),
        bill('INV2', 'MHS/002', 400000, { lines: [{ name: 'Tuition', amount: 500000 }], bursaryPct: 20, gross: 500000, discount: 100000 }),
        bill('INV3', 'MHS/003', 350000),
        bill('INV0', 'MHS/003', 50000, { termId: null, lines: [{ name: 'Balance brought forward', amount: 50000 }] }),
      ],
      payments: [
        pay('P1', 'MHS/001', 200000),
        pay('P2', 'MHS/001', 50000, { void: true, voidReason: 'Entered twice', voidedBy: 'Executive Director', voidedAt: '2026-02-04T10:00:00.000Z' }),
        pay('P3', 'MHS/002', 400000, { method: 'Mobile Money (MTN)' }),
        pay('P4', 'GONE/001', 10000),   // a learner removed long ago: belongs to no one
      ],
      feeStructures: [], registers: [], conduct: [], programs: [], attendance: [], competitions: [], squads: [], feeComponents: [],
      notices: [{ id: 'N1', title: 'Welcome back', body: 'Term starts Monday.', category: 'General', postedBy: 'Head Teacher', postedAt: '2026-02-01T08:00:00.000Z' }],
    };
    await page.setInputFiles('#onlineImportInput', { name: 'school-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.click('#mdOk');
    await until(() => /balances match the backup/.test(document.getElementById('toastHost').textContent), 30000);
    const msg = await page.textContent('#toastHost');
    assert(/All 3 learners/.test(msg) && /1 records? that belonged to no learner/.test(msg), 'message: ' + msg);
    const n = async t => Number((await one(`select count(*) as n from public.${t} where school_id = $1`, [newSchool])).n);
    assert(await n('learners') === 3 && await n('invoices') === 4 && await n('payments') === 3 && await n('marks') === 1 && await n('notices') === 1,
      `database: ${await n('learners')} learners, ${await n('invoices')} bills, ${await n('payments')} payments, ${await n('marks')} marks`);
    const p2 = await one("select void, void_reason, recorded_by, recorded_by_name from public.payments where school_id = $1 and id = 'P2'", [newSchool]);
    assert(p2.void === true && p2.void_reason === 'Entered twice' && p2.recorded_by === null && p2.recorded_by_name === 'Bursary Officer', 'reversal ' + JSON.stringify(p2));
    const sch = await one('select importing, settings from public.schools where id = $1', [newSchool]);
    assert(sch.importing === false && sch.settings.motto === 'Rise and shine', 'school ' + JSON.stringify(sch));
    assert(Number((await one("select count(*) as n from public.audit_log where school_id = $1 and action = 'IMPORT_DONE'", [newSchool])).n) === 1, 'no IMPORT_DONE entry');
    const balances = await app(() => window.KSA.state().students.map(s => [s.id, studentBalance(s)]));
    assert(JSON.stringify(balances) === '[["MHS/001",250000],["MHS/002",0],["MHS/003",400000]]', 'balances ' + JSON.stringify(balances));
    assert(!(await page.isVisible('#onlineImportLabel')), 'import still offered after the school has learners');
  });

  await step('an interrupted import is offered again at sign-in, and payments resume', async () => {
    await S.sql('update public.schools set importing = true where id = $1', [newSchool]);   // as if the tab had closed mid-import
    await page.reload();
    await page.waitForSelector('#impKeep');
    await page.click('#impKeep');
    await until(() => /import is finished/.test(document.getElementById('toastHost').textContent));
    assert((await one('select importing from public.schools where id = $1', [newSchool])).importing === false, 'school still importing');
    assert(Number((await one("select count(*) as n from public.audit_log where school_id = $1 and action = 'IMPORT_DONE'", [newSchool])).n) === 2, 'finish not recorded');
  });

  await step('no runtime errors', async () => {
    assert(!errors.length, errors.join(' | '));
  });
} finally {
  await browser.close();
  await S.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} online checks passed`);
process.exit(passed === results.length ? 0 : 1);
