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
async function tab(page, name) { await page.click(`.nav-tab[data-tab="${name}"]`); }

(async () => {
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  await step('static assets resolve (service worker, icons, manifest)', async () => {
    for (const path of ['/service-worker.js', '/manifest.json', '/icon192.png', '/icon512.png', '/app.js', '/auth.js', '/styles.css']) {
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

  await step('app shell and navigation render', async () => {
    assert(await page.isVisible('#appShell'), 'app shell hidden');
    const tabs = await page.$$eval('.nav-tab', ns => ns.length);
    assert(tabs >= 10, 'too few nav tabs: ' + tabs);
  });

  await step('school settings apply across the app', async () => {
    await tab(page, 'admin');
    await page.fill('#setSchoolName', 'Nakawa Progressive Academy');
    await page.fill('#setMotto', 'Effort · Discipline · Excellence');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForTimeout(200);
    assert(/Nakawa/.test(await page.textContent('.topbar-title .t-name')), 'school name not applied');
  });

  await step('register a student', async () => {
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
    await tab(page, 'payments');
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
    await tab(page, 'directory');
    await page.click('#studentTableBody button[data-act="editStudent"]');
    await page.waitForSelector('#editStudentForm');
    await page.fill('#editStudentForm input[name="fee"]', '550000');
    await page.click('#editStudentSave');
    await page.waitForTimeout(200);
    const fee = await page.evaluate(() => window.KSA.state().students[0].fee);
    assert(fee === 550000, 'fee after edit = ' + fee);
  });

  await step('O-Level aggregate shows for a sitting', async () => {
    await tab(page, 'academics');
    for (const [subj, score] of [['Mathematics', '82'], ['English Language', '75'], ['Physics', '68']]) {
      await page.selectOption('#academicStudent', 'NPA/2026/001');
      await page.selectOption('#academicForm select[name="term"]', 'Term 1');
      await page.fill('#academicForm input[name="subject"]', subj);
      await page.fill('#academicForm input[name="score"]', score);
      await page.click('#academicForm button[type="submit"]');
      await page.waitForTimeout(120);
    }
    assert(/Aggregate/.test(await page.textContent('#academicTableBody')), 'no aggregate shown');
  });

  await step('switching to competency grading re-grades entries', async () => {
    await tab(page, 'admin');
    await page.selectOption('#setGrading', 'cbc');
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForTimeout(150);
    await tab(page, 'academics');
    assert(/competency/.test(await page.textContent('#academicTableBody')), 'competency grades not shown');
  });

  await step('financial actions are audited', async () => {
    await tab(page, 'admin');
    const audit = await page.textContent('#auditLogBody');
    for (const action of ['PAYMENT_RECORD', 'PAYMENT_VOID', 'STUDENT_REGISTER', 'STUDENT_EDIT']) {
      assert(audit.includes(action), action + ' not audited');
    }
  });

  await step('report card prints with school name and result', async () => {
    await tab(page, 'directory');
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('#studentTableBody button[data-act="reportCard"]');
    await page.waitForTimeout(150);
    const doc = await page.textContent('#printArea');
    assert(/NAKAWA PROGRESSIVE ACADEMY/i.test(doc), 'report card missing school name');
    assert(/competency|Aggregate/i.test(doc), 'report card missing academic result');
  });

  await step('sign out', async () => {
    await page.click('#logoutBtn');
    await page.waitForSelector('#mdOk');
    await page.click('#mdOk');
    await page.waitForSelector('#authScreen', { state: 'visible' });
  });

  await step('sports role cannot see payments', async () => {
    await signIn(page, 'coach', 'Coach@2026');
    await changePassword(page, 'Coach@2026', 'Coach2026Xyz');
    const tabs = await page.$$eval('.nav-tab', ns => ns.map(n => n.dataset.tab));
    assert(!tabs.includes('payments'), 'coach sees payments');
    assert(tabs.includes('sports'), 'coach missing sports');
  });

  await step('no runtime errors', async () => {
    assert(!errors.length, errors.join(' | '));
  });

  await browser.close();
  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test run crashed:', err); process.exit(1); });
