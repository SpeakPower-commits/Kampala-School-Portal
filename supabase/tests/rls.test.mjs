/*
 * Row-level security tests for the online edition's database.
 *
 * Runs every file in supabase/migrations on PGlite — real Postgres compiled to
 * WebAssembly, so no Docker and no Supabase account are needed — on top of
 * supabase-stub.sql, which recreates the parts of Supabase the migrations use.
 * It then acts as each kind of user, setting the JWT claims exactly the way
 * Supabase does, and checks what they can and cannot read or change.
 *
 * Run from the repo root:
 *   npm install --no-save @electric-sql/pglite@0.5.15
 *   node supabase/tests/rls.test.mjs
 *
 * Exits with code 1 if any check fails.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const db = new PGlite();
await db.exec(readFileSync(join(here, 'supabase-stub.sql'), 'utf8'));
for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
}

// ── People ──────────────────────────────────────────────────────────────────
const U = {
  exec:      { id: '00000000-0000-4000-8000-000000000001', email: 'director@kampalahill.ug' },
  admin:     { id: '00000000-0000-4000-8000-000000000002', email: 'admin@kampalahill.ug' },
  bursar:    { id: '00000000-0000-4000-8000-000000000003', email: 'bursar@kampalahill.ug' },
  coach:     { id: '00000000-0000-4000-8000-000000000004', email: 'sports@kampalahill.ug' },
  teacherS4: { id: '00000000-0000-4000-8000-000000000005', email: 's4.teacher@kampalahill.ug' },
  teacherP7: { id: '00000000-0000-4000-8000-000000000006', email: 'p7.teacher@kampalahill.ug' },
  outsider:  { id: '00000000-0000-4000-8000-000000000007', email: 'director@lakeview.ug' },
  stranger:  { id: '00000000-0000-4000-8000-000000000008', email: 'someone@example.com' },
  parent:    { id: '00000000-0000-4000-8000-000000000009', phone: '256772000001' },
};
for (const u of Object.values(U)) {
  await db.query('insert into auth.users (id, email, phone) values ($1, $2, $3)', [u.id, u.email || null, u.phone || null]);
}

// Run SQL the way Supabase does for a request: as role "authenticated" with the
// user's JWT claims in request.jwt.claims, or as "anon" when user is null.
// Each call is its own transaction, so a failed statement leaves no trace.
async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    const claims = user
      ? { sub: user.id, role: 'authenticated', email: user.email, phone: user.phone }
      : { role: 'anon' };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
    return tx.query(sql, params);
  });
}
const pgArray = (list) => '{' + list.map(x => '"' + x + '"').join(',') + '}';

// ── Checks ──────────────────────────────────────────────────────────────────
const RLS = /row-level security/i;            // a policy refused the row
const PRIV = /permission denied/i;            // the role lacks the privilege outright
const CHECK = /check constraint/i;
const UNIQUE = /duplicate key|unique constraint/i;

let failures = 0;
function check(name, pass, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${pass || !detail ? '' : '  — ' + detail}`);
}
// Expect success; for UPDATE/DELETE also expect the given number of rows changed.
async function allowed(name, user, sql, params, rowsChanged) {
  try {
    const r = await as(user, sql, params);
    if (rowsChanged !== undefined) check(name, r.affectedRows === rowsChanged, `changed ${r.affectedRows} rows, expected ${rowsChanged}`);
    else check(name, true);
    return r;
  } catch (e) { check(name, false, e.message); return null; }
}
// Expect an error whose message matches the pattern.
async function denied(name, user, sql, params, pattern) {
  try { await as(user, sql, params); check(name, false, 'was allowed'); }
  catch (e) { check(name, pattern.test(e.message), e.message); }
}
// Expect an UPDATE/DELETE to quietly change nothing (RLS hides the rows).
async function noEffect(name, user, sql, params) {
  try { const r = await as(user, sql, params); check(name, r.affectedRows === 0, `changed ${r.affectedRows} rows`); }
  catch (e) { check(name, false, e.message); }
}
async function sees(name, user, sql, params, expected) {
  try { const r = await as(user, sql, params); const n = Number(r.rows[0].n); check(name, n === expected, `saw ${n}, expected ${expected}`); }
  catch (e) { check(name, false, e.message); }
}
const section = (title) => console.log('\n' + title);

// ── Setup: two schools and their staff ──────────────────────────────────────
const A = (await as(U.exec, "select public.create_school('Kampala Hill Primary & Secondary', 'Sarah Namubiru') as id")).rows[0].id;
const B = (await as(U.outsider, "select public.create_school('Lakeview College', 'John Okello') as id")).rows[0].id;

const invite = (u, role, name, classes = []) => as(U.exec,
  'insert into public.invites (school_id, email, role, display_name, assigned_classes) values ($1, $2, $3, $4, $5::text[])',
  [A, u.email, role, name, pgArray(classes)]);
await invite(U.admin, 'admin', 'Peter Ssemwogerere');
await invite(U.bursar, 'bursary', 'Grace Atim');
await invite(U.coach, 'coach', 'Moses Kato');
await invite(U.teacherS4, 'teacher', 'Ruth Nakato', ['S.4']);
await invite(U.teacherP7, 'teacher', 'Isaac Mugisha', ['P.7']);

section('Invites');
for (const [key, u] of Object.entries(U).filter(([k]) => ['admin', 'bursar', 'coach', 'teacherS4', 'teacherP7'].includes(k))) {
  const r = await allowed(`${key} claims their invite`, u, 'select public.claim_invites() as n');
  if (r) check(`${key} joined exactly one school`, Number(r.rows[0].n) === 1);
}
await sees('an invite cannot be claimed twice', U.admin, 'select public.claim_invites() as n', [], 0);
await sees('a stranger has no invites to claim', U.stranger, 'select public.claim_invites() as n', [], 0);
await sees('the director sees all 6 staff', U.exec, 'select count(*) as n from public.memberships where school_id = $1', [A], 6);
await sees('the administrator sees all 6 staff', U.admin, 'select count(*) as n from public.memberships where school_id = $1', [A], 6);
await sees('the bursar sees only their own membership', U.bursar, 'select count(*) as n from public.memberships', [], 1);
await sees('staff emails are recorded', U.exec, "select count(*) as n from public.memberships where school_id = $1 and email like '%@kampalahill.ug'", [A], 6);
await denied('a teacher cannot invite staff', U.teacherS4,
  "insert into public.invites (school_id, email, role) values ($1, 'friend@example.com', 'exec')", [A], RLS);
await denied('a parent account (phone only) cannot create a school', U.parent,
  "select public.create_school('Fake School', 'Me')", [], /email address/i);

// School data
await as(U.exec, "insert into public.terms (school_id, id, year, term, is_active) values ($1, 'T2026-1', '2026', 'Term 1', true)", [A]);
await as(U.exec, `insert into public.learners (school_id, id, admission_no, name, class, level) values
  ($1, 'L1', 'KHS/001', 'Achen Grace', 'S.4', 'O Level'),
  ($1, 'L2', 'KHP/014', 'Mukasa Brian', 'P.7', 'Primary'),
  ($1, 'L3', 'KHS/002', 'Nambi Joan', 'S.4', 'O Level')`, [A]);
await as(U.outsider, "insert into public.terms (school_id, id, year, term) values ($1, 'T2026-1', '2026', 'Term 1')", [B]);
await as(U.outsider, "insert into public.learners (school_id, id, admission_no, name, class) values ($1, 'L1', 'LV/001', 'Opio David', 'S.4')", [B]);

section('Teachers work only with their own classes');
await sees('S.4 teacher sees the 2 S.4 learners only', U.teacherS4, 'select count(*) as n from public.learners', [], 2);
await sees('P.7 teacher sees the 1 P.7 learner only', U.teacherP7, 'select count(*) as n from public.learners', [], 1);
await allowed('S.4 teacher enters a mark for an S.4 learner', U.teacherS4,
  "insert into public.marks (school_id, id, learner_id, term_id, exam_set, subject, score) values ($1, 'M1', 'L1', 'T2026-1', 'EOT', 'Mathematics', 78)", [A]);
await denied('S.4 teacher cannot enter a mark for a P.7 learner', U.teacherS4,
  "insert into public.marks (school_id, id, learner_id, term_id, exam_set, subject, score) values ($1, 'M2', 'L2', 'T2026-1', 'EOT', 'English', 60)", [A], RLS);
await sees('P.7 teacher cannot see S.4 marks', U.teacherP7, 'select count(*) as n from public.marks', [], 0);
await noEffect('P.7 teacher cannot change an S.4 mark', U.teacherP7, "update public.marks set score = 5 where school_id = $1 and id = 'M1'", [A]);
await allowed('S.4 teacher marks the S.4 register', U.teacherS4,
  "insert into public.registers (school_id, id, class, stream, reg_date, records) values ($1, 'R1', 'S.4', '', '2026-02-10', '[]')", [A]);
await denied('S.4 teacher cannot mark the P.7 register', U.teacherS4,
  "insert into public.registers (school_id, id, class, stream, reg_date, records) values ($1, 'R2', 'P.7', '', '2026-02-10', '[]')", [A], RLS);
await sees('P.7 teacher cannot see the S.4 register', U.teacherP7, 'select count(*) as n from public.registers', [], 0);
await allowed("S.4 teacher writes the class teacher's comment", U.teacherS4,
  "insert into public.comments (school_id, id, learner_id, term_id, class_teacher) values ($1, 'L1|T2026-1', 'L1', 'T2026-1', 'Hardworking and focused.')", [A]);
await denied("a teacher cannot write the head teacher's comment", U.teacherS4,
  "update public.comments set head_teacher = 'Promoted.' where school_id = $1 and id = 'L1|T2026-1'", [A], /head teacher/i);
await denied('P.7 teacher cannot comment on an S.4 learner', U.teacherP7,
  "insert into public.comments (school_id, id, learner_id, term_id, class_teacher) values ($1, 'L3|T2026-1', 'L3', 'T2026-1', 'Hi')", [A], RLS);
await allowed("the administrator writes the head teacher's comment", U.admin,
  "update public.comments set head_teacher = 'Promoted to S.5.' where school_id = $1 and id = 'L1|T2026-1'", [A], 1);
await sees('a teacher can read the terms', U.teacherS4, 'select count(*) as n from public.terms', [], 1);
await sees('a teacher sees no payments', U.teacherS4, 'select count(*) as n from public.payments', [], 0);
await sees('a teacher sees no bills', U.teacherS4, 'select count(*) as n from public.invoices', [], 0);
await sees('a teacher sees no fee structures', U.teacherS4, 'select count(*) as n from public.fee_structures', [], 0);
await noEffect("a teacher cannot edit a learner's details", U.teacherS4, "update public.learners set name = 'X' where school_id = $1 and id = 'L1'", [A]);
await noEffect('a teacher cannot give themselves more classes', U.teacherS4,
  "update public.memberships set assigned_classes = '{S.4,P.7}' where user_id = $1", [U.teacherS4.id]);
await denied('a teacher cannot make themselves the director', U.teacherS4,
  "insert into public.memberships (school_id, user_id, role) values ($1, $2, 'exec')", [A, U.teacherS4.id], RLS);

section('Money: the bursar records, nobody edits');
await allowed('the bursar records a payment as themselves', U.bursar,
  "insert into public.payments (school_id, id, learner_id, amount, method, recorded_by, recorded_by_name) values ($1, 'P1', 'L1', 250000, 'Mobile Money', $2, 'Grace Atim')", [A, U.bursar.id]);
await allowed('the bursar records a second payment', U.bursar,
  "insert into public.payments (school_id, id, learner_id, amount, recorded_by) values ($1, 'P2', 'L3', 100000, $2)", [A, U.bursar.id]);
await denied('a payment cannot be recorded in someone else\'s name', U.bursar,
  "insert into public.payments (school_id, id, learner_id, amount, recorded_by) values ($1, 'P3', 'L1', 5000, $2)", [A, U.exec.id], RLS);
await denied('a payment cannot be recorded already reversed', U.bursar,
  "insert into public.payments (school_id, id, learner_id, amount, recorded_by, void) values ($1, 'P4', 'L1', 5000, $2, true)", [A, U.bursar.id], RLS);
await denied('a payment of zero is refused', U.bursar,
  "insert into public.payments (school_id, id, learner_id, amount, recorded_by) values ($1, 'P5', 'L1', 0, $2)", [A, U.bursar.id], CHECK);
await denied('the bursar cannot edit a payment', U.bursar, "update public.payments set amount = 1 where school_id = $1 and id = 'P1'", [A], PRIV);
await denied('the director cannot edit a payment', U.exec, "update public.payments set amount = 1 where school_id = $1 and id = 'P1'", [A], PRIV);
await denied('nobody can delete a payment', U.exec, "delete from public.payments where school_id = $1", [A], PRIV);
try { await db.query("update public.payments set amount = 1 where id = 'P1'"); check('even the database owner cannot edit a payment directly', false, 'was allowed'); }
catch (e) { check('even the database owner cannot edit a payment directly', /cannot be edited/i.test(e.message), e.message); }
await allowed('the bursar bills a learner', U.bursar,
  "insert into public.invoices (school_id, id, learner_id, term_id, gross, total) values ($1, 'I1', 'L1', 'T2026-1', 900000, 900000)", [A]);
await sees('the bursar sees no marks', U.bursar, 'select count(*) as n from public.marks', [], 0);
await allowed('the bursar awards a bursary', U.bursar, "update public.learners set bursary_pct = 50 where school_id = $1 and id = 'L1'", [A], 1);
await denied("the bursar cannot change a learner's name", U.bursar, "update public.learners set name = 'X' where school_id = $1 and id = 'L1'", [A], /bursary percentage/i);
await denied('the administrator cannot award a bursary', U.admin, "update public.learners set bursary_pct = 10 where school_id = $1 and id = 'L1'", [A], /bursary/i);
await allowed("the administrator corrects a learner's name", U.admin, "update public.learners set name = 'Achen Grace M.' where school_id = $1 and id = 'L1'", [A], 1);

section('Reversing a payment');
await denied('the administrator cannot reverse a payment', U.admin, "select public.void_payment($1, 'P1', 'Mistake')", [A], /permission/i);
await denied('a teacher cannot reverse a payment', U.teacherS4, "select public.void_payment($1, 'P1', 'Mistake')", [A], /permission/i);
await denied('a reason is required', U.bursar, "select public.void_payment($1, 'P1', '  ')", [A], /reason/i);
await allowed('the director reverses a payment with a reason', U.exec, "select public.void_payment($1, 'P1', 'Entered twice')", [A]);
await sees('the reversal is kept on the payment', U.bursar,
  "select count(*) as n from public.payments where id = 'P1' and void and void_reason = 'Entered twice' and voided_by = 'Sarah Namubiru'", [], 1);
await denied('a payment cannot be reversed twice', U.bursar, "select public.void_payment($1, 'P1', 'Again')", [A], /already reversed/i);
await allowed('the bursar reverses a payment', U.bursar, "select public.void_payment($1, 'P2', 'Wrong learner')", [A]);
await sees('both reversals are in the audit trail', U.exec, "select count(*) as n from public.audit_log where action = 'PAYMENT_VOID'", [], 2);

section('Sports and other records');
await allowed("the coach updates a learner's sport level", U.coach, "update public.learners set skill = 'Advanced' where school_id = $1 and id = 'L1'", [A], 1);
await denied("the coach cannot change a learner's name", U.coach, "update public.learners set name = 'X' where school_id = $1 and id = 'L1'", [A], /sport details/i);
await denied("the coach cannot change a subject combination", U.coach, "update public.learners set combination = 'PCM' where school_id = $1 and id = 'L1'", [A], /sport details/i);
await sees('the coach sees no payments', U.coach, 'select count(*) as n from public.payments', [], 0);
await allowed('the coach saves a squad', U.coach, "insert into public.school_docs (school_id, collection, id, data) values ($1, 'squads', 'SQ1', '{}')", [A]);
await allowed('the administrator adds a training programme', U.admin, "insert into public.school_docs (school_id, collection, id, data) values ($1, 'programs', 'PR1', '{}')", [A]);
await denied('the administrator cannot manage squads', U.admin, "insert into public.school_docs (school_id, collection, id, data) values ($1, 'squads', 'SQ2', '{}')", [A], RLS);
await allowed('the coach posts a notice', U.coach, "insert into public.notices (school_id, id, title) values ($1, 'N1', 'Sports day on Friday')", [A]);
await sees('a teacher reads the notice', U.teacherS4, 'select count(*) as n from public.notices', [], 1);
await denied('a teacher cannot post a notice', U.teacherS4, "insert into public.notices (school_id, id, title) values ($1, 'N2', 'Hi')", [A], RLS);
await denied('a teacher cannot log conduct', U.teacherS4,
  "insert into public.conduct (school_id, id, learner_id, type, severity) values ($1, 'C1', 'L1', 'Lateness', 'Minor')", [A], RLS);

section('Audit trail');
await sees('the administrator cannot read the audit trail', U.admin, 'select count(*) as n from public.audit_log', [], 0);
await denied('nobody writes the audit trail directly', U.exec,
  "insert into public.audit_log (school_id, action) values ($1, 'FAKE')", [A], PRIV);
await allowed('staff add to the audit trail through log_audit', U.bursar, "select public.log_audit($1, 'RECEIPT_PRINT', 'P1')", [A]);
await sees('the entry is signed with their name', U.exec,
  "select count(*) as n from public.audit_log where action = 'RECEIPT_PRINT' and username = 'Grace Atim'", [], 1);
await denied('a non-member cannot write to a school\'s audit trail', U.stranger, "select public.log_audit($1, 'X', 'Y')", [A], /not a member/i);

section('Schools never see each other');
await sees("school B's director sees none of school A's learners", U.outsider, 'select count(*) as n from public.learners where school_id = $1', [A], 0);
await sees("school B's director sees only their own school", U.outsider, 'select count(*) as n from public.schools', [], 1);
await sees("school A's director sees only school A's 3 learners", U.exec, 'select count(*) as n from public.learners', [], 3);
await denied("school B's director cannot add a learner to school A", U.outsider,
  "insert into public.learners (school_id, id, admission_no, name) values ($1, 'X1', 'X1', 'Intruder')", [A], RLS);
await denied("school A's director cannot add a learner to school B", U.exec,
  "insert into public.learners (school_id, id, admission_no, name) values ($1, 'X1', 'X1', 'Intruder')", [B], RLS);
await denied("school B's director cannot reverse school A's payments", U.outsider, "select public.void_payment($1, 'P1', 'x')", [A], /permission/i);
await noEffect("school B's director cannot rename school A", U.outsider, "update public.schools set name = 'Hacked' where id = $1", [A]);
await sees('a signed-in stranger sees no schools', U.stranger, 'select count(*) as n from public.schools', [], 0);
await sees('a signed-in stranger sees no learners', U.stranger, 'select count(*) as n from public.learners', [], 0);
await sees('a signed-in stranger sees no terms', U.stranger, 'select count(*) as n from public.terms', [], 0);
await denied('a signed-out visitor cannot read learners', null, 'select count(*) from public.learners', [], PRIV);
await denied('a signed-out visitor cannot create a school', null, "select public.create_school('X', 'Y')", [], PRIV);
await denied('a signed-out visitor cannot call the role helpers', null, 'select public.is_member($1)', [A], PRIV);

section('Data rules');
await denied('admission numbers with spaces or symbols are refused', U.exec,
  "insert into public.learners (school_id, id, admission_no, name) values ($1, 'L9', 'bad id!', 'Test')", [A], CHECK);
await denied('admission numbers are unique regardless of case', U.exec,
  "insert into public.learners (school_id, id, admission_no, name) values ($1, 'L9', 'khs/001', 'Test')", [A], UNIQUE);
await denied('one mark per learner, term, exam and subject', U.teacherS4,
  "insert into public.marks (school_id, id, learner_id, term_id, exam_set, subject, score) values ($1, 'M9', 'L1', 'T2026-1', 'EOT', 'mathematics', 50)", [A], UNIQUE);
await denied('scores above 100 are refused', U.teacherS4,
  "insert into public.marks (school_id, id, learner_id, term_id, exam_set, subject, score) values ($1, 'M9', 'L3', 'T2026-1', 'EOT', 'English', 101)", [A], CHECK);
{
  const r = await db.query("select updated_at > created_at as touched from public.learners where school_id = $1 and id = 'L1'", [A]);
  check('changes stamp updated_at (triggers still run for signed-in users)', r.rows[0].touched === true);
}

section('Staff management');
await denied('the only director cannot step down', U.exec,
  "update public.memberships set role = 'admin' where school_id = $1 and user_id = $2", [A, U.exec.id], /at least one active Executive Director/i);
await denied('the only director cannot remove themselves', U.exec,
  'delete from public.memberships where school_id = $1 and user_id = $2', [A, U.exec.id], /at least one active Executive Director/i);
await allowed('the director turns off a teacher\'s access', U.exec,
  'update public.memberships set active = false where school_id = $1 and user_id = $2', [A, U.teacherP7.id], 1);
await sees('a teacher whose access is off sees no learners', U.teacherP7, 'select count(*) as n from public.learners', [], 0);
await sees('a teacher whose access is off sees no terms', U.teacherP7, 'select count(*) as n from public.terms', [], 0);
await noEffect('the administrator cannot change staff roles', U.admin,
  "update public.memberships set role = 'exec' where school_id = $1 and user_id = $2", [A, U.admin.id]);
await allowed('the director updates school settings', U.exec, `update public.schools set settings = '{"motto":"Excel"}' where id = $1`, [A], 1);
await noEffect('the administrator cannot change school settings', U.admin, `update public.schools set settings = '{}' where id = $1`, [A]);
await allowed('a director can create a second school', U.exec, "select public.create_school('Kampala Hill Annex', 'Sarah Namubiru')");
await allowed('… and a third', U.exec, "select public.create_school('Kampala Hill Nursery', 'Sarah Namubiru')");
await denied('… but not a fourth', U.exec, "select public.create_school('One Too Many', 'Sarah Namubiru')", [], /maximum number of schools/i);

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
