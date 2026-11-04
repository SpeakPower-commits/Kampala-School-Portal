/*
 * config.js — which edition of the portal runs here, and where its server is.
 *
 * Offline edition (the default): all data stays on this device.
 * Online edition: staff share one school database (Supabase), so teachers can
 * work on their own phones and the school's data is backed up off-site.
 *
 * The web address decides: addresses listed in onlineHosts run the online
 * edition, and every other address runs the offline edition, including a school
 * laptop, localhost and GitHub Pages.
 */
'use strict';

(function () {
  const settings = {
    // The school database (Supabase project). Both values are public by
    // design: the publishable key only identifies the project, and the
    // database's row-level security decides what each signed-in person may
    // read or change. Never put a secret or service key here.
    supabaseUrl: '',
    supabaseKey: '',
    // The portal's own server API (the Cloudflare Worker, same address).
    apiUrl: '/api',
    // Web addresses that run the online edition, e.g. ['app.yourschool.ug'].
    onlineHosts: [],
  };

  // The automated tests point the portal at a local stand-in for Supabase.
  const test = window.PORTAL_TEST_CONFIG || null;
  const config = Object.freeze(Object.assign({}, settings, test || {}));
  const online = !!(config.supabaseUrl && config.supabaseKey &&
    (config.onlineHosts.includes(location.hostname) || (test && test.forceOnline)));

  window.PORTAL = Object.freeze({ config, online, edition: online ? 'online' : 'offline' });
})();
