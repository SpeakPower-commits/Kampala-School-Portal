/*
 * Cloudflare Worker for the School Portal.
 *
 * The portal's own files (index.html, app.js, parent.html, …) are served
 * straight from Cloudflare's edge as static assets. This code runs only for
 * /api/* (see run_worker_first in wrangler.jsonc). It does the few things a
 * browser must never do itself, because they need a secret:
 *
 *   POST /api/hooks/send-sms           Supabase Auth's "Send SMS" hook: texts a parent's sign-in code
 *   POST /api/sms/settings             the director saves the school's Africa's Talking account
 *   GET  /api/sms/balance?school=…     whether SMS is set up, and the account balance
 *   POST /api/sms/test                 the director sends a test SMS
 *   POST /api/sms/campaigns/:id/send   send the next batch (≤ 40) of a prepared message run
 *
 * Who may do what is decided by the database (migration 0002), using the
 * caller's own session. The Supabase secret key is used only for the steps no
 * browser may take: reading the encrypted account, taking a batch and
 * recording what Africa's Talking said.
 *
 * Each school's Africa's Talking key is encrypted here with AES-GCM before it
 * is stored, bound to the school's id, under the Worker secret SMS_KEY_SECRET.
 * It is decrypted only to send, and never returned to any browser.
 *
 * Secrets:    SUPABASE_SECRET_KEY, SEND_SMS_HOOK_SECRET (v1,whsec_…), SMS_KEY_SECRET (32 bytes, base64)
 * Plain vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
 * Tests only: AT_BASE_URL (a stand-in for Africa's Talking)
 */

// The _headers file protects the app's files but not responses made here, so
// API responses carry the same protections.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
};
const AT_LIVE = 'https://api.africastalking.com';
const AT_SANDBOX = 'https://api.sandbox.africastalking.com';
const BATCH = 40;              // ≤ 50 outside requests per call on the free plan
const AT_CONCURRENCY = 5;
const HOOK_TOLERANCE_S = 300;  // Standard Webhooks: refuse signatures older or newer than 5 minutes
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders },
  });
}
function only(request, method) {
  if (request.method !== method) throw Object.assign(new HttpError(405, 'Method not allowed'), { allow: method });
}

/* ── Small helpers ─────────────────────────────────────────────────────── */
const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/* Phone numbers as digits with the country code, like public.msisdn(). */
function msisdn(raw) {
  const d = String(raw || '').replace(/[^0-9]/g, '');
  if (/^0[0-9]{9}$/.test(d)) return '256' + d.slice(1);
  if (/^[1-9][0-9]{8}$/.test(d)) return '256' + d;
  if (/^[1-9][0-9]{10,14}$/.test(d)) return d;
  return '';
}
function text(v, field, min, max) {
  const s = String(v == null ? '' : v).trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${field} must be ${min ? `${min}–${max}` : `at most ${max}`} characters.`);
  return s;
}
function uuid(v, field) {
  if (!UUID.test(String(v || ''))) throw new HttpError(400, `${field} is missing or not valid.`);
  return String(v).toLowerCase();
}
async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new HttpError(413, 'Request too large.');
  try { return await request.json(); } catch (_) { throw new HttpError(400, 'The request is not valid JSON.'); }
}
function bearer(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!m) throw new HttpError(401, 'Please sign in again.');
  return m[1];
}
function configured(env, ...names) {
  for (const n of names) if (!env[n]) throw new HttpError(503, 'SMS is not configured on this server yet.');
}

/* ── Supabase ──────────────────────────────────────────────────────────── */
/* Call a database function as the signed-in user (token) or, for the few
   trusted steps, with the secret key ('service'). */
async function rpc(env, fn, args, auth) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth === 'service') headers.apikey = env.SUPABASE_SECRET_KEY;
  else { headers.apikey = env.SUPABASE_PUBLISHABLE_KEY; headers.Authorization = 'Bearer ' + auth; }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }
  if (res.ok) return data;
  const code = data && data.code;
  // The database's own refusals carry a message meant for people.
  if (code === '42501') throw new HttpError(403, data.message || 'You do not have permission to do that.');
  if (code === 'P0002') throw new HttpError(404, data.message || 'Not found.');
  if (code === '22023') throw new HttpError(400, data.message || 'That request is not valid.');
  if (res.status === 401) throw new HttpError(401, 'Please sign in again.');
  console.error('database call failed', fn, res.status, raw.slice(0, 300));
  throw new HttpError(502, 'The school database did not answer. Please try again.');
}

/* ── The Africa's Talking key, encrypted at rest ───────────────────────── */
async function aesKey(env) {
  const raw = unb64(env.SMS_KEY_SECRET);
  if (raw.length !== 32) throw new HttpError(503, 'SMS is not configured on this server yet.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
// The school's id is bound in as additional data, so a stored key cannot be
// moved to another school.
async function encryptKey(env, schoolId, apiKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(schoolId) }, await aesKey(env), enc.encode(apiKey));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
async function decryptKey(env, schoolId, cipher) {
  const [v, iv, ct] = String(cipher || '').split('.');
  if (v !== 'v1' || !iv || !ct) throw new HttpError(500, "The school's SMS account needs to be saved again.");
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(schoolId) }, await aesKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch (_) { throw new HttpError(500, "The school's SMS account needs to be saved again."); }
}

/* ── Africa's Talking ──────────────────────────────────────────────────── */
function atBase(env, settings) {
  return env.AT_BASE_URL || (settings.sandbox || settings.username === 'sandbox' ? AT_SANDBOX : AT_LIVE);
}
async function atFetch(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
/* Send one text to one or more numbers ('+256…'). One result per number. */
async function atSend(env, settings, apiKey, numbers, message, ms = 10000) {
  const form = new URLSearchParams({ username: settings.username, to: numbers.join(','), message });
  if (settings.sender_id) form.set('from', settings.sender_id);
  let res, data = null;
  try {
    res = await atFetch(atBase(env, settings) + '/version1/messaging', {
      method: 'POST',
      headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }, ms);
    const raw = await res.text();
    try { data = JSON.parse(raw); } catch (_) { data = { text: raw }; }
  } catch (_) {
    return numbers.map(number => ({ number, ok: false, error: "Africa's Talking could not be reached." }));
  }
  const smd = data && data.SMSMessageData;
  const recipients = (smd && smd.Recipients) || [];
  return numbers.map(number => {
    const r = recipients.find(x => x.number === number);
    // 100 Processed, 101 Sent, 102 Queued: accepted for delivery.
    const ok = !!r && [100, 101, 102].includes(Number(r.statusCode));
    return {
      number, ok,
      message_id: r && r.messageId || null,
      cost: r && r.cost || null,
      error: ok ? null : (r && r.status) || (smd && smd.Message) || (data && data.text) || `HTTP ${res.status}`,
    };
  });
}
async function atBalance(env, settings, apiKey) {
  try {
    const res = await atFetch(`${atBase(env, settings)}/version1/user?username=${encodeURIComponent(settings.username)}`,
      { headers: { apiKey, Accept: 'application/json' } }, 8000);
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const u = data.UserData || data.userData || {};
    return { ok: true, balance: u.balance || null };
  } catch (_) { return { ok: false }; }
}
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/* ── Supabase Auth "Send SMS" hook (Standard Webhooks) ─────────────────── */
async function verifyWebhook(secrets, headers, body) {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sig = headers.get('webhook-signature');
  if (!id || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > HOOK_TOLERANCE_S) return false;
  const data = enc.encode(`${id}.${ts}.${body}`);
  const given = sig.split(' ').map(s => s.split(',')).filter(p => p[0] === 'v1' && p[1]).map(p => p[1]);
  for (const secret of String(secrets || '').split('|')) {
    const m = /^v1,whsec_(.+)$/.exec(secret.trim());
    if (!m) continue;
    const key = await crypto.subtle.importKey('raw', unb64(m[1]), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const g of given) {
      let bytes;
      try { bytes = unb64(g); } catch (_) { continue; }
      if (await crypto.subtle.verify('HMAC', key, bytes, data)) return true;   // constant-time comparison
    }
  }
  return false;
}
const hookError = (status, message) => json({ error: { http_code: status, message } }, status);

async function sendSmsHook(request, env) {
  only(request, 'POST');
  if (!env.SEND_SMS_HOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return hookError(500, 'SMS sign-in is not configured.');
  const body = await request.text();
  if (!(await verifyWebhook(env.SEND_SMS_HOOK_SECRET, request.headers, body))) return hookError(401, 'Invalid signature.');
  let payload;
  try { payload = JSON.parse(body); } catch (_) { return hookError(400, 'Invalid payload.'); }
  const phone = msisdn(payload && payload.user && payload.user.phone);
  const otp = String(payload && payload.sms && payload.sms.otp || '');
  if (!phone || !/^[0-9]{6}$/.test(otp)) return hookError(400, 'Invalid payload.');
  // Codes go only to guardians of a school that sends SMS, through that
  // school's own account; random numbers get nothing.
  const found = await rpc(env, 'sms_hook_lookup', { p_phone: phone }, 'service');
  if (!found) return hookError(400, 'This number is not on record with a school that uses the parent portal. Ask the school to check the number they have for you.');
  const apiKey = await decryptKey(env, found.school_id, found.settings.key_cipher);
  const [r] = await atSend(env, found.settings, apiKey, ['+' + phone],
    `${otp} is your ${found.school_name} parent portal code. Do not share it.`, 3500);
  if (!r.ok) return hookError(502, 'The SMS could not be sent just now. Please try again in a minute.');
  return json({});
}

/* ── The school's account ──────────────────────────────────────────────── */
async function saveSettings(request, env) {
  only(request, 'POST');
  configured(env, 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SMS_KEY_SECRET');
  const token = bearer(request);
  const b = await readJson(request);
  const school = uuid(b.school_id, 'School');
  const settings = {
    username: text(b.username, "The Africa's Talking username", 1, 60),
    sender_id: text(b.sender_id, 'The sender ID', 0, 11),
    sandbox: !!b.sandbox,
  };
  const apiKey = text(b.api_key, 'The API key', 10, 200);
  const user = await rpc(env, 'sms_can', { p_school: school, p_action: 'settings' }, token);
  if (!user) throw new HttpError(403, 'Only the Executive Director can set up SMS.');
  const bal = await atBalance(env, settings, apiKey);   // proves the username and key work
  if (!bal.ok) throw new HttpError(400, "Africa's Talking did not accept that username and API key. Check them and try again.");
  await rpc(env, 'sms_store_settings', {
    p_school: school, p_user: user, p_username: settings.username, p_sender: settings.sender_id,
    p_sandbox: settings.sandbox, p_cipher: await encryptKey(env, school, apiKey), p_hint: apiKey.slice(-4),
  }, 'service');
  return json({ ok: true, balance: bal.balance });
}

async function balance(request, env, url) {
  only(request, 'GET');
  configured(env, 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SMS_KEY_SECRET');
  const token = bearer(request);
  const school = uuid(url.searchParams.get('school'), 'School');
  if (!(await rpc(env, 'sms_can', { p_school: school, p_action: 'balance' }, token))) throw new HttpError(403, 'You do not have permission to do that.');
  const s = await rpc(env, 'sms_settings_for', { p_school: school }, 'service');
  if (!s) return json({ configured: false });
  const bal = await atBalance(env, s, await decryptKey(env, school, s.key_cipher));
  return json({ configured: true, username: s.username, sender_id: s.sender_id, sandbox: !!s.sandbox,
    balance: bal.ok ? bal.balance : null, reachable: bal.ok });
}

async function testSms(request, env) {
  only(request, 'POST');
  configured(env, 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SMS_KEY_SECRET');
  const token = bearer(request);
  const b = await readJson(request);
  const school = uuid(b.school_id, 'School');
  const to = msisdn(b.to);
  if (!to) throw new HttpError(400, 'Enter a valid phone number.');
  if (!(await rpc(env, 'sms_can', { p_school: school, p_action: 'settings' }, token))) throw new HttpError(403, 'Only the Executive Director can send a test SMS.');
  const s = await rpc(env, 'sms_settings_for', { p_school: school }, 'service');
  if (!s) throw new HttpError(404, 'Save the school\'s Africa\'s Talking account first.');
  const [r] = await atSend(env, s, await decryptKey(env, school, s.key_cipher), ['+' + to],
    `Test message from the ${s.school_name} school portal. SMS is working.`);
  return json({ ok: r.ok, error: r.error });
}

/* ── Sending a prepared message run ────────────────────────────────────── */
async function sendBatch(request, env, campaignId) {
  only(request, 'POST');
  configured(env, 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SMS_KEY_SECRET');
  const token = bearer(request);
  const id = uuid(campaignId, 'Message run');
  if (!(await rpc(env, 'sms_can_send', { p_campaign: id }, token))) {
    throw new HttpError(403, 'This message run has finished, was stopped, or is not yours to send.');
  }
  const batch = await rpc(env, 'sms_take_batch', { p_campaign: id, p_limit: BATCH }, 'service');
  if (batch.stopped || !batch.messages.length) return json({ sent: 0, failed: 0, remaining: batch.remaining || 0, done: true });
  const apiKey = await decryptKey(env, batch.school_id, batch.settings.key_cipher);
  // Messages with the same text (a notice to every guardian) go in one
  // request; personal ones (fees, absences) one request each.
  const groups = new Map();
  batch.messages.forEach(m => { if (!groups.has(m.body)) groups.set(m.body, []); groups.get(m.body).push(m); });
  const outcomes = await pool([...groups.entries()], AT_CONCURRENCY,
    ([body, msgs]) => atSend(env, batch.settings, apiKey, msgs.map(m => '+' + m.to), body).then(rs => rs.map((r, i) => ({ m: msgs[i], r }))));
  const results = outcomes.flat().map(({ m, r }) => ({ id: m.id, ok: r.ok, message_id: r.message_id, cost: r.cost, error: r.error }));
  const rec = await rpc(env, 'sms_record_results', { p_campaign: id, p_results: results }, 'service');
  return json({
    sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length,
    remaining: rec.remaining, done: rec.status !== 'sending', totals: { sent: rec.sent, failed: rec.failed },
  });
}

/* ── Routing ───────────────────────────────────────────────────────────── */
async function api(request, env, url) {
  const p = url.pathname;
  if (p === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
    return json({ ok: true, service: 'school-portal' });
  }
  if (p === '/api/hooks/send-sms') return sendSmsHook(request, env);
  if (p === '/api/sms/settings') return saveSettings(request, env);
  if (p === '/api/sms/balance') return balance(request, env, url);
  if (p === '/api/sms/test') return testSms(request, env);
  const send = /^\/api\/sms\/campaigns\/([^/]+)\/send$/.exec(p);
  if (send) return sendBatch(request, env, send[1]);
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status, e.allow ? { Allow: e.allow } : {});
        console.error('unexpected error', e && e.stack || e);
        return json({ error: 'Something went wrong. Please try again.' }, 500);
      }
    }
    // Anything else that reaches the Worker is not a known app file; the asset
    // server answers it (with a 404).
    return env.ASSETS.fetch(request);
  },
};
