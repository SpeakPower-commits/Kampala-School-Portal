/*
 * Tests for the Cloudflare Worker's SMS API (worker/index.js).
 *
 * Runs the real Worker inside the local stand-in for Supabase
 * (supabase/dev/server.mjs: real Postgres in WebAssembly with the real
 * migrations), with a pretend Africa's Talking that records every SMS. No
 * browser is needed. It covers the signed sign-in-code hook, a school saving
 * its Africa's Talking account (checked, then stored only encrypted), the
 * balance and test SMS, phone sign-in end to end, and sending a message run in
 * batches, including a number the network refuses.
 *
 * Run from the repo root:
 *   npm install --no-save @electric-sql/pglite
 *   node tests/worker.test.mjs
 *
 * Exits with code 1 if any check fails.
 */
import { createHmac } from 'node:crypto';
import { HOOK_SECRET, startStandIn } from '../supabase/dev/server.mjs';

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log('PASS  ' + name); }
  catch (e) { results.push(false); console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const S = await startStandIn({ port: 0 });
const api = (path, { method = 'GET', token, body, headers = {} } = {}) => fetch(S.url + path, {
  method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers },
});
const jsonOf = async res => ({ status: res.status, headers: res.headers, body: await res.json().catch(() => null) });
async function signIn(email, password) {
  const r = await fetch(`${S.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: S.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
async function rpc(token, fn, args) {
  const r = await fetch(`${S.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: S.anonKey, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error((data && data.message) || 'HTTP ' + r.status);
  return data;
}
const one = async (text, params = []) => (await S.sql(text, params)).rows[0];
const signHook = (payload, { ts = Math.floor(Date.now() / 1000), secret = HOOK_SECRET } = {}) => {
  const id = 'msg_test_' + Math.random().toString(36).slice(2), body = JSON.stringify(payload);
  const key = Buffer.from(secret.slice('v1,whsec_'.length), 'base64');
  const sig = 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { body, headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig } };
};

// ── A school: director, bursar, S.4 teacher, 45 S.4 learners each owing UGX 100,000 except the first ──
const DIRECTOR = 'director@hill.ug', BURSAR = 'bursar@hill.ug', TEACHER = 'teacher@hill.ug', OTHER = 'director@lakeview.ug';
await S.addUser(DIRECTOR, 'Director2026');
await S.addUser(OTHER, 'Lakeview2026');
const school = (await S.sql("select public.create_school('Kampala Hill School', 'Sarah Namubiru') as id", [], DIRECTOR)).rows[0].id;
const other = (await S.sql("select public.create_school('Lakeview College', 'John Okello') as id", [], OTHER)).rows[0].id;
await S.sql("insert into public.invites (school_id, email, role, display_name) values ($1, $2, 'bursary', 'Grace Atim')", [school, BURSAR], DIRECTOR);
await S.sql("insert into public.invites (school_id, email, role, display_name, assigned_classes) values ($1, $2, 'teacher', 'Ruth Nakato', '{S.4}')", [school, TEACHER], DIRECTOR);
await S.addUser(BURSAR, 'Bursar2026'); await S.sql('select public.claim_invites()', [], BURSAR);
await S.addUser(TEACHER, 'Teacher2026'); await S.sql('select public.claim_invites()', [], TEACHER);
await S.sql("insert into public.terms (school_id, id, year, term, is_active) values ($1, 'T1', '2026', 'Term 3', true)", [school], DIRECTOR);
const learners = Array.from({ length: 45 }, (_, i) => {
  const n = i + 1, id = 'K' + String(n).padStart(3, '0');
  const phone = n === 44 ? 'no number' : n === 45 ? '0772 999 999' : '07721' + String(n).padStart(5, '0');
  return { id, name: 'Learner ' + n, phone };
});
for (const l of learners) {
  await S.sql("insert into public.learners (school_id, id, admission_no, name, class, level, guardian_phone) values ($1, $2, $2, $3, 'S.4', 'O Level', $4)", [school, l.id, l.name, l.phone], DIRECTOR);
  await S.sql("insert into public.invoices (school_id, id, learner_id, term_id, gross, total) values ($1, $2, $3, 'T1', 100000, 100000)", [school, 'INV-' + l.id, l.id], DIRECTOR);
}
await S.sql("update public.learners set guardian2_phone = '0701 200 002' where school_id = $1 and id = 'K002'", [school], DIRECTOR);
const directorId = (await one('select id from auth.users where email = $1', [DIRECTOR])).id;
await S.sql("insert into public.payments (school_id, id, learner_id, amount, recorded_by) values ($1, 'P1', 'K001', 100000, $2)", [school, directorId], DIRECTOR);
const tDirector = await signIn(DIRECTOR, 'Director2026'), tBursar = await signIn(BURSAR, 'Bursar2026');
const tTeacher = await signIn(TEACHER, 'Teacher2026'), tOther = await signIn(OTHER, 'Lakeview2026');
const AT_KEY = 'atsk_live_ABCDEFGHIJKL1234';

try {
  await step('the health check answers, with security headers', async () => {
    const r = await jsonOf(await api('/api/health'));
    assert(r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    assert(r.headers.get('x-content-type-options') === 'nosniff' && /default-src 'none'/.test(r.headers.get('content-security-policy')), 'security headers missing');
  });

  await step('unknown paths and wrong methods are refused', async () => {
    assert((await api('/api/nothing-here')).status === 404, 'unknown path not 404');
    const r = await api('/api/sms/settings');
    assert(r.status === 405 && r.headers.get('allow') === 'POST', 'GET settings: ' + r.status);
  });

  await step('saving the SMS account needs a signed-in director', async () => {
    const body = { school_id: school, username: 'sandbox', api_key: AT_KEY, sender_id: 'HILLSCH', sandbox: true };
    assert((await api('/api/sms/settings', { method: 'POST', body })).status === 401, 'no token accepted');
    const r = await jsonOf(await api('/api/sms/settings', { method: 'POST', token: tBursar, body }));
    assert(r.status === 403 && /Executive Director/.test(r.body.error), JSON.stringify(r));
    assert(r.headers.get('x-frame-options') === 'DENY', 'security headers missing on a refusal');
  });

  await step("a key Africa's Talking refuses is not saved", async () => {
    const r = await jsonOf(await api('/api/sms/settings', { method: 'POST', token: tDirector, body: { school_id: school, username: 'sandbox', api_key: 'atsk_bad_key_000000', sandbox: true } }));
    assert(r.status === 400 && /did not accept/.test(r.body.error), JSON.stringify(r));
    assert(!(await one('select count(*)::int as n from public.school_sms')).n, 'a refused key was stored');
  });

  await step('the director saves the account; only an encrypted copy of the key is stored', async () => {
    const r = await jsonOf(await api('/api/sms/settings', { method: 'POST', token: tDirector, body: { school_id: school, username: 'sandbox', api_key: AT_KEY, sender_id: 'HILLSCH', sandbox: true } }));
    assert(r.status === 200 && r.body.balance === 'UGX 5000.0000', JSON.stringify(r));
    const row = await one('select at_username, sender_id, key_cipher, key_hint from public.school_sms where school_id = $1', [school]);
    assert(row && row.at_username === 'sandbox' && row.sender_id === 'HILLSCH' && row.key_hint === '1234', JSON.stringify(row));
    assert(/^v1\./.test(row.key_cipher) && !row.key_cipher.includes(AT_KEY) && !row.key_cipher.includes('ABCDEFGHIJKL'), 'key stored in readable form');
  });

  await step('an encrypted key moved to another school does not work there', async () => {
    await S.sql("insert into public.school_sms (school_id, at_username, key_cipher) select $2, at_username, key_cipher from public.school_sms where school_id = $1", [school, other]);
    const r = await jsonOf(await api(`/api/sms/balance?school=${other}`, { token: tOther }));
    assert(r.status === 500 && /saved again/.test(r.body.error), JSON.stringify(r));
    await S.sql('delete from public.school_sms where school_id = $1', [other]);
  });

  await step('staff see whether SMS is set up and the balance; outsiders do not', async () => {
    const r = await jsonOf(await api(`/api/sms/balance?school=${school}`, { token: tTeacher }));
    assert(r.status === 200 && r.body.configured && r.body.balance === 'UGX 5000.0000' && !('key_cipher' in r.body), JSON.stringify(r.body));
    assert((await api(`/api/sms/balance?school=${school}`, { token: tOther })).status === 403, 'another school saw the balance');
  });

  await step('the director sends a test SMS from the school sender ID', async () => {
    const r = await jsonOf(await api('/api/sms/test', { method: 'POST', token: tDirector, body: { school_id: school, to: '0772 123 456' } }));
    assert(r.status === 200 && r.body.ok, JSON.stringify(r));
    const last = S.smsOutbox.at(-1);
    assert(last.to === '+256772123456' && last.from === 'HILLSCH' && /Kampala Hill School/.test(last.message), JSON.stringify(last));
    assert((await api('/api/sms/test', { method: 'POST', token: tBursar, body: { school_id: school, to: '0772123456' } })).status === 403, 'bursar sent a test');
  });

  await step('the sign-in hook refuses a bad or stale signature', async () => {
    const payload = { user: { phone: '256772100002' }, sms: { otp: '123456' } };
    const good = signHook(payload);
    const tampered = await api('/api/hooks/send-sms', { method: 'POST', body: good.body.replace('123456', '654321'), headers: good.headers });
    assert(tampered.status === 401, 'tampered body accepted: ' + tampered.status);
    const stale = signHook(payload, { ts: Math.floor(Date.now() / 1000) - 600 });
    assert((await api('/api/hooks/send-sms', { method: 'POST', body: stale.body, headers: stale.headers })).status === 401, 'stale signature accepted');
    const other = signHook(payload, { secret: 'v1,whsec_' + Buffer.alloc(32, 1).toString('base64') });
    assert((await api('/api/hooks/send-sms', { method: 'POST', body: other.body, headers: other.headers })).status === 401, 'wrong secret accepted');
  });

  await step('a sign-in code goes only to a guardian, through their school\'s account', async () => {
    const before = S.smsOutbox.length;
    const stranger = signHook({ user: { phone: '256700000123' }, sms: { otp: '111222' } });
    const r = await jsonOf(await api('/api/hooks/send-sms', { method: 'POST', body: stranger.body, headers: stranger.headers }));
    assert(r.status === 400 && /not on record/.test(r.body.error.message), JSON.stringify(r));
    assert(S.smsOutbox.length === before, 'a stranger was texted');
    const guardian = signHook({ user: { phone: '+256772100002' }, sms: { otp: '333444' } });
    const ok = await api('/api/hooks/send-sms', { method: 'POST', body: guardian.body, headers: guardian.headers });
    assert(ok.status === 200, 'hook status ' + ok.status);
    const sms = S.smsOutbox.at(-1);
    assert(sms.to === '+256772100002' && sms.username === 'sandbox' && /^333444 is your Kampala Hill School parent portal code/.test(sms.message), JSON.stringify(sms));
  });

  await step('a parent signs in with an SMS code and sees their child', async () => {
    const otp = await fetch(`${S.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: S.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+256701200002' }) });
    assert(otp.status === 200, 'otp status ' + otp.status);
    const code = /^(\d{6}) is your/.exec(S.smsOutbox.at(-1).message)[1];
    const verify = body => fetch(`${S.url}/auth/v1/verify`, { method: 'POST', headers: { apikey: S.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert((await verify({ type: 'sms', phone: '+256701200002', token: code === '000000' ? '000001' : '000000' })).status === 403, 'a wrong code was accepted');
    const session = await (await verify({ type: 'sms', phone: '+256701200002', token: code })).json();
    assert(session.access_token, 'no session');
    const portal = await rpc(session.access_token, 'parent_portal', {});
    assert(JSON.stringify(portal.schools.map(s => s.learners.map(l => l.id))) === '[["K002"]]', JSON.stringify(portal.schools.map(s => s.learners.map(l => l.id))));
    const unknown = await fetch(`${S.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: S.anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+256700000124' }) });
    assert(unknown.status === 400 && /not on record/.test((await unknown.json()).msg), 'unknown number status ' + unknown.status);
  });

  let fees;
  await step('the bursar prepares fee reminders: 43 messages, 1 learner without a number', async () => {
    fees = await rpc(tBursar, 'sms_create_campaign', { p_school: school, p_kind: 'fees', p_options: {} });
    assert(fees.recipients === 43 && fees.skipped === 1, JSON.stringify(fees));
  });

  await step('another teacher cannot send the bursar\'s run', async () => {
    const r = await jsonOf(await api(`/api/sms/campaigns/${fees.campaign_id}/send`, { method: 'POST', token: tTeacher }));
    assert(r.status === 403, JSON.stringify(r));
  });

  await step('sending goes in batches of 40, one personal message per request', async () => {
    const before = S.smsOutbox.length;
    const first = await jsonOf(await api(`/api/sms/campaigns/${fees.campaign_id}/send`, { method: 'POST', token: tBursar }));
    assert(first.status === 200 && first.body.sent + first.body.failed === 40 && first.body.remaining === 3 && !first.body.done, JSON.stringify(first.body));
    const second = await jsonOf(await api(`/api/sms/campaigns/${fees.campaign_id}/send`, { method: 'POST', token: tBursar }));
    assert(second.body.sent + second.body.failed === 3 && second.body.remaining === 0 && second.body.done, JSON.stringify(second.body));
    assert(second.body.totals.sent === 42 && second.body.totals.failed === 1, JSON.stringify(second.body.totals));
    const sent = S.smsOutbox.slice(before);
    assert(sent.length === 43 && new Set(sent.map(m => m.request)).size === 43, `texts ${sent.length}, requests ${new Set(sent.map(m => m.request)).size}`);
    const k3 = sent.find(m => m.to === '+256772100003');
    assert(k3 && /Learner 3 \(S\.4\) is UGX 100,000/.test(k3.message) && k3.from === 'HILLSCH', JSON.stringify(k3));
  });

  await step('each result is recorded, including the number the network refused', async () => {
    const c = await one('select status, sent, failed from public.sms_campaigns where id = $1', [fees.campaign_id]);
    assert(c.status === 'done' && c.sent === 42 && c.failed === 1, JSON.stringify(c));
    const bad = await one("select status, error from public.sms_messages where campaign_id = $1 and to_msisdn = '256772999999'", [fees.campaign_id]);
    assert(bad.status === 'failed' && bad.error === 'InvalidPhoneNumber', JSON.stringify(bad));
    assert((await one("select count(*)::int as n from public.audit_log where school_id = $1 and action = 'SMS_SENT'", [school])).n === 1, 'no SMS_SENT audit entry');
  });

  await step('a finished run sends nothing more', async () => {
    const before = S.smsOutbox.length;
    const r = await api(`/api/sms/campaigns/${fees.campaign_id}/send`, { method: 'POST', token: tBursar });
    assert(r.status === 403 && S.smsOutbox.length === before, 'status ' + r.status);
  });

  await step('a notice to every guardian goes in one request per batch', async () => {
    const news = await rpc(tDirector, 'sms_create_campaign', { p_school: school, p_kind: 'broadcast', p_options: { message: 'Visiting day is Saturday.', both: true } });
    assert(news.recipients === 45, JSON.stringify(news));   // 44 first numbers + one second guardian
    const before = S.smsOutbox.length;
    for (let i = 0; i < 3; i++) {
      const r = await jsonOf(await api(`/api/sms/campaigns/${news.campaign_id}/send`, { method: 'POST', token: tDirector }));
      if (r.body.done) break;
    }
    const sent = S.smsOutbox.slice(before);
    assert(sent.length === 45 && new Set(sent.map(m => m.request)).size === 2, `texts ${sent.length}, requests ${new Set(sent.map(m => m.request)).size}`);
    assert(sent.every(m => m.message === 'Visiting day is Saturday. - Kampala Hill School'), sent[0].message);
  });

  await step('the browser never sees the key', async () => {
    const all = JSON.stringify(await rpc(tDirector, 'sms_can', { p_school: school, p_action: 'settings' })) +
      JSON.stringify(await (await api(`/api/sms/balance?school=${school}`, { token: tDirector })).json());
    assert(!all.includes(AT_KEY) && !all.includes('key_cipher'), 'key material reached a browser response');
  });
} finally {
  await S.close();
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} worker checks passed`);
process.exit(failed ? 1 : 0);
