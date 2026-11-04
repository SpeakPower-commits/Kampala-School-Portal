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
 * It is not a full Supabase. It understands the requests auth-online.js and
 * sync.js make: password sign-in, sign-up, password change and reset; select,
 * insert, upsert, update and delete with eq/neq/is/in/gt/gte/lt/lte filters,
 * ordering and paging; and database function calls (rpc).
 */
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const SECRET = 'local-stand-in-only';   // signs the stand-in's own test tokens
export const ANON_KEY = 'local-anon-key';

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

  const users = new Map();      // email -> { id, email, password, confirmed, createdAt }
  const refresh = new Map();    // refresh token -> email
  const outbox = [];            // emails the stand-in "sent" (sign-up confirmations, reset links)

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
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
    email_confirmed_at: u.confirmed ? u.createdAt : null, confirmed_at: u.confirmed ? u.createdAt : null,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: u.createdAt, updated_at: u.createdAt, is_anonymous: false,
  });
  function session(u) {
    const now = Math.floor(Date.now() / 1000), ttl = 3600;
    const token = randomUUID().replace(/-/g, '');
    refresh.set(token, u.email);
    return {
      access_token: sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + ttl, session_id: randomUUID(), aal: 'aal1' }),
      token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: token, user: userJson(u),
    };
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
    return db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: 'anon' })]);
      await tx.exec(`set local role ${claims && claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
      return fn(tx);
    });
  }

  /* ── /auth/v1 ────────────────────────────────────────────────────────── */
  const authFail = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
  async function auth(method, path, url, body, bearer) {
    if (method === 'POST' && path === 'token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(String(body.email || '').toLowerCase());
        if (!u || u.password !== body.password) return authFail(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) return authFail(400, 'email_not_confirmed', 'Email not confirmed');
        return { status: 200, body: session(u) };
      }
      if (grant === 'refresh_token') {
        const email = refresh.get(body.refresh_token);
        if (!email) return authFail(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        refresh.delete(body.refresh_token);
        return { status: 200, body: session(users.get(email)) };
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
      for (const name of Object.keys(args)) { values.push(args[name] === null ? null : String(args[name])); named.push(`${q(name)} => $${values.length}`); }
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

  function pgStatus(e, claims) {
    if (e.status) return e.status;
    const code = e.code || '';
    if (code === '42501') return claims && claims.role === 'authenticated' ? 403 : 401;
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
      const body = raw ? JSON.parse(raw) : null;
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (url.pathname.startsWith('/auth/v1/')) {
        const r = await auth(req.method, url.pathname.slice(9), url, body || {}, bearer);
        return send(r.status, r.body);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const claims = verify(bearer);   // the anon key is not a token: signed-out caller
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
    db,
    outbox,
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
