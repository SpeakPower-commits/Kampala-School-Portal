/*
 * Cloudflare Worker for the School Portal.
 *
 * The portal's own files (index.html, app.js, …) are served straight from
 * Cloudflare's edge as static assets. This code runs only for /api/* (see
 * run_worker_first in wrangler.jsonc).
 *
 * Phase 2a ships a health check. The SMS endpoints, the parent sign-in hook and
 * the scheduled jobs (reminders, nightly backups) arrive in later phases.
 *
 * Secrets such as the Supabase secret key and the SMS key are Worker secrets.
 * They never reach the browser.
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

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
      }
      return json({ ok: true, service: 'school-portal' });
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    // Anything else that reaches the Worker is not a known app file; the asset
    // server answers it (with a 404).
    return env.ASSETS.fetch(request);
  },
};
