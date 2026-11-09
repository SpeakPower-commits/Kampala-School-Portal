/*
 * supabase/dev/server.mjs — a local stand-in for Supabase. TESTS AND DEMOS ONLY.
 *
 * Serves the portal's files and answers the parts of Supabase's Auth (/auth/v1)
 * and REST (/rest/v1) APIs that the online edition uses, on top of PGlite (real
 * Postgres compiled to WebAssembly) running the real migrations. The official
 * supabase-js client, the real row-level security and the real database
 * functions are therefore exercised end to end, without a Supabase account.
 *
 *   node supabase/dev/server.mjs      then open http://127.0.0.1:54321
 *
 * It is not a full Supabase. It understands the requests auth-online.js,
 * sync.js and parent.js make: password sign-in, sign-up, password change and
 * reset; phone sign-in with an SMS code (sent through the Send SMS hook, i.e.
 * the real Worker); select, insert, upsert, update and delete with
 * eq/neq/is/in/gt/gte/lt/lte filters, ordering and paging; database function
 * calls (rpc); and the secret key, which runs as service_role.
 *
 * It also runs the real Cloudflare Worker (worker/index.js) for /api/*, and a
 * pretend Africa's Talking at /__at/* that records every SMS in smsOutbox.
 */
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../worker/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const SECRET = 'local-stand-in-only';   // signs the stand-in's own test tokens
export const ANON_KEY = 'local-anon-key';
export const SECRET_KEY = 'local-secret-key';          // the Supabase secret key: runs as service_role
// Test-only Worker secrets (fixed, so tests can sign hooks themselves).
export const HOOK_SECRET = 'v1,whsec_' + Buffer.alloc(32, 7).toString('base64');
export const SMS_KEY_SECRET = Buffer.alloc(32, 9).toString('base64');
// The pretend Africa's Talking accepts API keys that start with this.
export const AT_TEST_KEY_PREFIX = 'atsk_';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const IDENT = /^[a-z_][a-z0-9_]*$/;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const q = name => { if (!IDENT.test(name)) throw httpError(400, 'PGRST100', `"${name}" is not a valid name`); return `"${name}"`; };

function httpError(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
const b64url = v => Buffer.from(v).toString('base64url');

export async function startStandIn({ port = 54321, host = '127.0.0.1', autoConfirm = true } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(join(repo, 'supabase/tests/supabase-stub.sql'), 'utf8'));
  for (const f of readdirSync(join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(repo, 'supabase/migrations', f), 'utf8'));
  }

  const users = new Map();      // email, or 'phone:<digits>' -> { id, email, phone, password, confirmed, phoneConfirmedAt, createdAt }
  const refresh = new Map();    // refresh token -> users key
  const outbox = [];            // emails the stand-in "sent" (sign-up confirmations, reset links)
  const smsOutbox = [];         // texts the pretend Africa's Talking "sent"
  const otps = new Map();       // phone digits -> { code, expires }
  let atMessageId = 0, atRequests = 0;

  /* ── Tokens ──────────────────────────────────────────────────────────── */
  function sign(payload) {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url')}`;
  }
  function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const expected = Buffer.from(createHmac('sha256', SECRET).update(parts[0] + '.' + parts[1]).digest('base64url'));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
  }
  const userJson = u => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email || '', phone: u.phone || '',
    email_confirmed_at: u.confirmed ? u.createdAt : null, phone_confirmed_at: u.phoneConfirmedAt || null,
    confirmed_at: u.confirmed ? u.createdAt : u.phoneConfirmedAt || null,
    app_metadata: { provider: u.phone ? 'phone' : 'email', providers: [u.phone ? 'phone' : 'email'] }, user_metadata: {}, identities: [],
    created_at: u.createdAt, updated_at: u.createdAt, is_anonymous: false,
  });
  const keyOf = u => (u.email ? u.email : 'phone:' + u.phone);
  function session(u) {
    const now = Math.floor(Date.now() / 1000), ttl = 3600;
    const token = randomUUID().replace(/-/g, '');
    refresh.set(token, keyOf(u));
    return {
      access_token: sign({ sub: u.id, email: u.email || '', phone: u.phone || '', role: 'authenticated', aud: 'authenticated', iat: now, exp: now + ttl, session_id: randomUUID(), aal: 'aal1' }),
      token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: token, user: userJson(u),
    };
  }

  /* ── The Worker and the Send SMS hook ────────────────────────────────── */
  const workerEnv = origin => ({
    SUPABASE_URL: origin, SUPABASE_PUBLISHABLE_KEY: ANON_KEY, SUPABASE_SECRET_KEY: SECRET_KEY,
    SEND_SMS_HOOK_SECRET: HOOK_SECRET, SMS_KEY_SECRET, AT_BASE_URL: origin + '/__at',
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
  });
  // Supabase Auth calls the hook with a Standard Webhooks signature.
  async function callSmsHook(origin, payload) {
    const id = 'msg_' + randomUUID(), ts = String(Math.floor(Date.now() / 1000)), body = JSON.stringify(payload);
    const key = Buffer.from(HOOK_SECRET.slice('v1,whsec_'.length), 'base64');
    const signature = 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    const res = await worker.fetch(new Request(origin + '/api/hooks/send-sms', {
      method: 'POST', body,
      headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': signature },
    }), workerEnv(origin));
    const out = await res.json().catch(() => ({}));
    return { status: res.status, message: out && out.error && out.error.message };
  }
  async function addUser(email, password, { confirmed = true } = {}) {
    email = String(email).toLowerCase();
    const u = { id: randomUUID(), email, password, confirmed, createdAt: new Date().toISOString() };
    await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, email]);
    users.set(email, u);
    return u.id;
  }

  /* ── Running SQL as the caller, the way Supabase does ────────────────── */
  function asCaller(claims, fn) {
    const role = claims && ['authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
    return db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: 'anon' })]);
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
  }

  /* ── /auth/v1 ────────────────────────────────────────────────────────── */
  const authFail = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
  async function auth(method, path, url, body, bearer, origin) {
    // Phone sign-in: a 6-digit code goes out through the Send SMS hook.
    if (method === 'POST' && path === 'otp' && body.phone) {
      const phone = String(body.phone).replace(/[^0-9]/g, '');
      if (phone.length < 9) return authFail(422, 'validation_failed', 'Invalid phone number format (E.164 required)');
      let u = users.get('phone:' + phone);
      if (!u) {
        u = { id: randomUUID(), email: '', phone, confirmed: false, phoneConfirmedAt: null, createdAt: new Date().toISOString() };
        await db.query('insert into auth.users (id, email, phone) values ($1, null, $2)', [u.id, phone]);
        users.set('phone:' + phone, u);
      }
      const code = String(randomInt(0, 1e6)).padStart(6, '0');
      otps.set(phone, { code, expires: Date.now() + 300000 });
      const hook = await callSmsHook(origin, { user: userJson(u), sms: { otp: code } });
      if (hook.status !== 200) return { status: hook.status >= 400 && hook.status < 600 ? hook.status : 500, body: { code: hook.status, error_code: 'hook_error', msg: hook.message || 'Error sending SMS' } };
      return { status: 200, body: {} };
    }
    if (method === 'POST' && path === 'verify' && body.type === 'sms') {
      const phone = String(body.phone || '').replace(/[^0-9]/g, '');
      const pending = otps.get(phone), u = users.get('phone:' + phone);
      if (!u || !pending || pending.expires < Date.now() || pending.code !== String(body.token || '')) {
        return authFail(403, 'otp_expired', 'Token has expired or is invalid');
      }
      otps.delete(phone);
      if (!u.phoneConfirmedAt) {
        u.phoneConfirmedAt = new Date().toISOString();
        await db.query('update auth.users set phone_confirmed_at = $2 where id = $1', [u.id, u.phoneConfirmedAt]);
      }
      return { status: 200, body: session(u) };
    }
    if (method === 'POST' && path === 'token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(String(body.email || '').toLowerCase());
        if (!u || u.password !== body.password) return authFail(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) return authFail(400, 'email_not_confirmed', 'Email not confirmed');
        return { status: 200, body: session(u) };
      }
      if (grant === 'refresh_token') {
        const key = refresh.get(body.refresh_token);
        if (!key) return authFail(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(body.refresh_token);
        return { status: 200, body: session(users.get(key)) };
      }
      return authFail(400, 'validation_failed', 'Unsupported grant type');
    }
    if (method === 'POST' && path === 'signup') {
      const email = String(body.email || '').toLowerCase();
      if (users.has(email)) return authFail(422, 'user_already_exists', 'User already registered');
      if (String(body.password || '').length < 6) return authFail(422, 'weak_password', 'Password should be at least 6 characters.');
      await addUser(email, body.password, { confirmed: autoConfirm });
      const u = users.get(email);
      if (!autoConfirm) { outbox.push({ to: email, kind: 'confirm' }); return { status: 200, body: userJson(u) }; }
      return { status: 200, body: session(u) };
    }
    if (method === 'POST' && path === 'recover') {
      outbox.push({ to: String(body.email || '').toLowerCase(), kind: 'reset' });
      return { status: 200, body: {} };
    }
    const claims = verify(bearer);
    const u = claims && [...users.values()].find(x => x.id === claims.sub);
    if (path === 'user' && method === 'GET') return u ? { status: 200, body: userJson(u) } : authFail(401, 'bad_jwt', 'invalid JWT');
    if (path === 'user' && method === 'PUT') {
      if (!u) return authFail(401, 'bad_jwt', 'invalid JWT');
      if (body.password) u.password = body.password;
      return { status: 200, body: userJson(u) };
    }
    if (path === 'logout' && method === 'POST') return { status: 204 };
    return authFail(404, 'not_found', 'Not found');
  }

  /* ── /rest/v1 ────────────────────────────────────────────────────────── */
  function parseList(raw) {
    const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
    const out = []; let cur = '', quoted = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === '\\' && quoted) { cur += inner[++i]; continue; }
      if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (inner.length) out.push(cur);
    return out;
  }
  const pgArray = list => '{' + list.map(x => '"' + String(x).replace(/["\\]/g, m => '\\' + m) + '"').join(',') + '}';

  function whereClause(params, values) {
    const parts = [];
    for (const [col, raw] of params) {
      if (RESERVED.has(col)) continue;
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot), val = raw.slice(dot + 1);
      const c = q(col);
      if (op === 'is') {
        if (!['null', 'true', 'false'].includes(val)) throw httpError(400, 'PGRST100', 'Unsupported is. filter');
        parts.push(`${c} is ${val}`);
      } else if (op === 'in') {
        values.push(pgArray(parseList(val)));
        parts.push(`${c}::text = any($${values.length}::text[])`);
      } else if (op === 'eq' || op === 'neq') {
        values.push(val);
        parts.push(`${c}::text ${op === 'eq' ? '=' : '<>'} $${values.length}`);
      } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
        values.push(val);
        parts.push(`${c} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} $${values.length}`);
      } else throw httpError(400, 'PGRST100', `Unsupported filter "${op}"`);
    }
    return parts.length ? ' where ' + parts.join(' and ') : '';
  }

  async function rest(method, path, url, body, headers, claims) {
    const prefer = String(headers.prefer || '');
    const wantRows = /return=representation/.test(prefer);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      const info = await db.query(
        `select p.proargnames as names, pg_get_function_result(p.oid) as result from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (!info.rows.length || !IDENT.test(fn)) throw httpError(404, 'PGRST202', `Could not find the function public.${fn}`);
      const args = body || {}, values = [], named = [];
      for (const name of Object.keys(args)) {
        const v = args[name];
        values.push(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
        named.push(`${q(name)} => $${values.length}`);
      }
      const call = `public.${q(fn)}(${named.join(', ')})`;
      if (info.rows[0].result === 'void') { await asCaller(claims, tx => tx.query(`select ${call}`, values)); return { status: 204 }; }
      const r = await asCaller(claims, tx => tx.query(`select to_jsonb(${call}) as j`, values));
      return { status: 200, body: r.rows[0].j };
    }

    const table = `public.${q(path)}`;
    const values = [];
    if (method === 'GET') {
      const sel = url.searchParams.get('select') || '*';
      const cols = sel === '*' ? '*' : sel.split(',').map(s => q(s.trim())).join(', ');
      let sql = `select to_jsonb(r) as j from (select ${cols} from ${table} as x${whereClause(url.searchParams, values)}`;
      const order = url.searchParams.get('order');
      if (order) {
        sql += ' order by ' + order.split(',').map(part => {
          const [col, dir, nulls] = part.split('.');
          return `${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
        }).join(', ');
      }
      const limit = url.searchParams.get('limit'), offset = url.searchParams.get('offset');
      if (limit) sql += ` limit ${Math.max(0, parseInt(limit, 10) || 0)}`;
      if (offset) sql += ` offset ${Math.max(0, parseInt(offset, 10) || 0)}`;
      sql += ') r';
      const r = await asCaller(claims, tx => tx.query(sql, values));
      return { status: 200, body: r.rows.map(x => x.j) };
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length) return { status: 201, body: wantRows ? [] : undefined };
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const list = cols.map(q).join(', ');
      values.push(JSON.stringify(rows));
      let sql = `insert into ${table} as x (${list}) select ${list} from jsonb_populate_recordset(null::${table}, $1::jsonb)`;
      const conflict = url.searchParams.get('on_conflict');
      if (/resolution=merge-duplicates/.test(prefer) && conflict) {
        const keys = conflict.split(',').map(s => s.trim());
        const sets = cols.filter(c => !keys.includes(c)).map(c => `${q(c)} = excluded.${q(c)}`);
        sql += ` on conflict (${keys.map(q).join(', ')}) do ${sets.length ? 'update set ' + sets.join(', ') : 'nothing'}`;
      } else if (/resolution=ignore-duplicates/.test(prefer)) sql += ' on conflict do nothing';
      if (wantRows) sql += ' returning to_jsonb(x.*) as j';
      const r = await asCaller(claims, tx => tx.query(sql, values));
      return { status: 201, body: wantRows ? r.rows.map(x => x.j) : undefined };
    }
    if (method === 'PATCH') {
      const cols = Object.keys(body || {});
      if (!cols.length) return { status: 204 };
      values.push(JSON.stringify(body));
      const list = cols.map(q).join(', ');
      let sql = `update ${table} as x set (${list}) = (select ${list} from jsonb_populate_record(null::${table}, $1::jsonb))${whereClause(url.searchParams, values)}`;
      if (wantRows) sql += ' returning to_jsonb(x.*) as j';
      const r = await asCaller(claims, tx => tx.query(sql, values));
      return wantRows ? { status: 200, body: r.rows.map(x => x.j) } : { status: 204 };
    }
    if (method === 'DELETE') {
      let sql = `delete from ${table} as x${whereClause(url.searchParams, values)}`;
      if (wantRows) sql += ' returning to_jsonb(x.*) as j';
      const r = await asCaller(claims, tx => tx.query(sql, values));
      return wantRows ? { status: 200, body: r.rows.map(x => x.j) } : { status: 204 };
    }
    throw httpError(405, 'PGRST000', 'Method not allowed');
  }

  /* ── A pretend Africa's Talking (tests only) ─────────────────────────── */
  // Keys starting with atsk_ are accepted. A number ending in 999 is refused,
  // as an invalid number would be.
  function pretendAfricasTalking(req, url, raw, send) {
    const key = String(req.headers.apikey || '');
    if (!key.startsWith(AT_TEST_KEY_PREFIX) || key.includes('bad')) return send(401, 'The supplied authentication is invalid', 'text/plain');
    if (url.pathname === '/__at/version1/user' && req.method === 'GET') {
      return send(200, { UserData: { balance: 'UGX 5000.0000' } });
    }
    if (url.pathname === '/__at/version1/messaging' && req.method === 'POST') {
      const form = new URLSearchParams(raw);
      const to = String(form.get('to') || '').split(',').filter(Boolean);
      const request = ++atRequests;   // which request each text came in, to check grouping
      const recipients = to.map(number => {
        const ok = !number.endsWith('999');
        smsOutbox.push({ request, username: form.get('username'), from: form.get('from') || '', to: number, message: form.get('message'), ok });
        return ok
          ? { statusCode: 101, number, status: 'Success', cost: 'UGX 25.0000', messageId: 'ATXid_' + (++atMessageId) }
          : { statusCode: 403, number, status: 'InvalidPhoneNumber', cost: '0', messageId: 'None' };
      });
      return send(201, { SMSMessageData: { Message: `Sent to ${recipients.filter(r => r.statusCode === 101).length}/${to.length}`, Recipients: recipients } });
    }
    return send(404, 'Not found', 'text/plain');
  }

  function pgStatus(e, claims) {
    if (e.status) return e.status;
    const code = e.code || '';
    if (code === '42501') return claims && ['authenticated', 'service_role'].includes(claims.role) ? 403 : 401;
    if (code === '23505' || code === '23503') return 409;
    if (code === 'P0002') return 404;
    return 400;
  }

  /* ── Static files: the portal itself ─────────────────────────────────── */
  function staticFile(pathname, origin) {
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = resolve(repo, '.' + rel);
    if (!file.startsWith(repo + sep) || rel.includes('/.') || rel.startsWith('/node_modules/')) return null;
    try { if (!statSync(file).isFile()) return null; } catch (_) { return null; }
    let data = readFileSync(file);
    // Point the real config.js at this stand-in, so the online edition runs here.
    if (rel === '/config.js') {
      data = Buffer.concat([Buffer.from(`window.PORTAL_TEST_CONFIG = ${JSON.stringify({ supabaseUrl: origin, supabaseKey: ANON_KEY, forceOnline: true })};\n`), data]);
    }
    return { type: TYPES[extname(file)] || 'application/octet-stream', data };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      if (body === undefined) return res.end('');
      res.end(Buffer.isBuffer(body) || type !== 'application/json' ? body : JSON.stringify(body));
    };
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const origin = `http://${req.headers.host}`;
      // The Cloudflare Worker answers /api/*, exactly as on the real site.
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const r = await worker.fetch(new Request(url.href, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw }), workerEnv(origin));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (url.pathname.startsWith('/__at/')) return pretendAfricasTalking(req, url, raw, send);
      const body = raw ? JSON.parse(raw) : null;
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (url.pathname.startsWith('/auth/v1/')) {
        const r = await auth(req.method, url.pathname.slice(9), url, body || {}, bearer, origin);
        return send(r.status, r.body);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        // The secret key (with no user session) runs as service_role; the
        // publishable key is not a token: a signed-out caller.
        const secret = req.headers.apikey === SECRET_KEY && (!bearer || bearer === SECRET_KEY);
        const claims = secret ? { role: 'service_role' } : verify(bearer);
        try {
          const r = await rest(req.method, url.pathname.slice(9), url, body, req.headers, claims);
          return send(r.status, r.body);
        } catch (e) {
          return send(pgStatus(e, claims), { code: e.code || 'PGRST000', message: e.message, details: e.detail || null, hint: e.hint || null });
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'Method not allowed' });
      const file = staticFile(url.pathname, `http://${req.headers.host}`);
      if (!file) return send(404, 'Not found', 'text/plain');
      return send(200, file.data, file.type);
    } catch (e) {
      return send(500, { code: 'PGRST000', message: e.message });
    }
  });
  await new Promise(r => server.listen(port, host, r));
  const actualPort = server.address().port;

  return {
    url: `http://${host}:${actualPort}`,
    anonKey: ANON_KEY,
    secretKey: SECRET_KEY,
    db,
    outbox,
    smsOutbox,
    addUser,
    /* Run SQL as a user (by email) or, with no email, as the database owner. */
    async sql(text, params = [], email = null) {
      if (!email) return db.query(text, params);
      const u = users.get(email.toLowerCase());
      return asCaller({ sub: u.id, email: u.email, role: 'authenticated' }, tx => tx.query(text, params));
    },
    close: () => new Promise(r => server.close(() => r())),
  };
}

// Run directly: start the stand-in for a manual look at the online edition.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startStandIn({ port: Number(process.env.PORT) || 54321 });
  await s.addUser('director@demo.school', 'Demo@2026');
  console.log(`Online edition with a local stand-in for Supabase: ${s.url}`);
  console.log('Sign in as director@demo.school / Demo@2026 (no school yet), or create an account with "First time here?".');
}
