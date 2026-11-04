/*
 * auth-online.js — staff sign-in for the online edition.
 *
 * Replaces the offline edition's on-device accounts (auth.js) with Supabase
 * Auth: everyone signs in with their own email address and password, and the
 * school database decides their role. The rest of the app keeps calling the
 * same AUTH functions, so it does not need to know which edition is running.
 *
 * Joining a school: the director adds a staff member's email address and role
 * (an invitation). That person opens the portal, chooses "First time here?",
 * creates a password with the same email address and confirms it, and the
 * invitation is picked up the first time they sign in.
 *
 * Unused in the offline edition.
 */
'use strict';

(function () {
  if (!window.PORTAL || !PORTAL.online) return;

  const SESSION_KEY = 'ksa_session';
  const SCHOOL_KEY = 'ksa_school';
  const SESSION_MS = 8 * 60 * 60 * 1000;   // same 8-hour working session as offline
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // Actions the database already writes to the audit trail itself.
  const AUDITED_BY_DATABASE = new Set(['PAYMENT_VOID']);
  let sb = null;
  let staff = [];       // members and pending invitations (director only)
  let auditRows = [];   // recent audit trail (director only)

  function loadLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/supabase.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Cannot reach the portal. Check your internet connection and reload.'));
      document.head.appendChild(s);
    });
  }

  function friendly(error) {
    const msg = String((error && error.message) || error || '');
    if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
    if (/email not confirmed/i.test(msg)) return 'Confirm your email address first: open the link we emailed you, then sign in.';
    if (/already registered|already been registered|user already exists/i.test(msg)) return 'An account with this email already exists. Sign in instead, or use "Forgot your password?".';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg) || !navigator.onLine) return 'Cannot reach the school database. Check your internet connection.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
    if (/duplicate key|unique constraint/i.test(msg)) return 'That email address has already been invited.';
    if (/at least one active Executive Director/i.test(msg)) return 'A school needs at least one active Executive Director. Make someone else director first.';
    return msg || 'Something went wrong. Please try again.';
  }

  const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { return null; } };
  const writeSession = s => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} };

  async function myMemberships(userId) {
    const { data, error } = await sb.from('memberships')
      .select('school_id,role,display_name,assigned_classes,active').eq('user_id', userId).eq('active', true);
    if (error) throw error;
    if (!data.length) return [];
    const { data: schools, error: e2 } = await sb.from('schools').select('id,name').in('id', data.map(m => m.school_id));
    if (e2) throw e2;
    const names = {};
    (schools || []).forEach(s => { names[s.id] = s.name; });
    return data.map(m => Object.assign({}, m, { schoolName: names[m.school_id] || 'School' }));
  }

  function pick(list) {
    let preferred = null;
    try { preferred = localStorage.getItem(SCHOOL_KEY); } catch (_) {}
    return list.find(m => m.school_id === preferred) || list[0];
  }

  /* Load the school's data, then start an app session for this person. */
  async function openSchool(user, m) {
    await SYNC.loadSchool(m.school_id, m.role);
    const session = {
      userId: user.id, username: user.email, displayName: m.display_name || user.email, role: m.role,
      schoolId: m.school_id, schoolName: m.schoolName, assignedClasses: m.assigned_classes || [],
      loginAt: Date.now(), expiresAt: Date.now() + SESSION_MS,
    };
    writeSession(session);
    try { localStorage.setItem(SCHOOL_KEY, m.school_id); } catch (_) {}
    if (m.role === 'exec') await refreshStaff().catch(() => {});
    return session;
  }

  /* Staff list and audit trail for the director's Administration page. */
  async function refreshStaff() {
    const school = SYNC.schoolId(); if (!school) return;
    const [members, invites, audit] = await Promise.all([
      sb.from('memberships').select('user_id,role,display_name,email,assigned_classes,active').eq('school_id', school).order('display_name'),
      sb.from('invites').select('id,email,role,display_name,assigned_classes,claimed_by').eq('school_id', school).is('claimed_by', null).order('email'),
      sb.from('audit_log').select('ts,user_id,username,action,detail').eq('school_id', school).order('ts', { ascending: false }).limit(200),
    ]);
    if (members.error) throw members.error;
    staff = (members.data || []).map(m => ({
      id: m.user_id, username: m.email, displayName: m.display_name, role: m.role, assignedClasses: m.assigned_classes || [],
      active: m.active, pending: false, mustChangePassword: false, lastLogin: null,
    })).concat((invites.data || []).map(i => ({
      id: 'invite:' + i.id, username: i.email, displayName: i.display_name || i.email, role: i.role,
      assignedClasses: i.assigned_classes || [], active: true, pending: true, mustChangePassword: false, lastLogin: null,
    })));
    auditRows = (audit.data || []).map(a => ({ ts: a.ts, userId: a.user_id, username: a.username, action: a.action, detail: a.detail }));
  }

  window.ONLINE = {
    /* Connect to the school database and restore an earlier sign-in. */
    async start() {
      await loadLibrary();
      sb = window.supabase.createClient(PORTAL.config.supabaseUrl, PORTAL.config.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      SYNC.attach(sb);
      sb.auth.onAuthStateChange(event => {
        if (event === 'PASSWORD_RECOVERY') setTimeout(() => window.dispatchEvent(new CustomEvent('portal:password-recovery')), 0);
      });
      const { data } = await sb.auth.getSession();
      const saved = readSession();
      const fresh = saved && saved.schoolId && Date.now() < saved.expiresAt;
      if (!data.session || !fresh) { localStorage.removeItem(SESSION_KEY); return { signedIn: false }; }
      try {
        const m = (await myMemberships(data.session.user.id)).find(x => x.school_id === saved.schoolId);
        if (!m) { localStorage.removeItem(SESSION_KEY); return { signedIn: false }; }
        const session = await openSchool(data.session.user, m);
        session.loginAt = saved.loginAt; session.expiresAt = saved.expiresAt;
        writeSession(session);
        return { signedIn: true };
      } catch (e) {
        return { signedIn: false, error: friendly(e) };
      }
    },
    client: () => sb,
    friendly,
  };

  Object.assign(AUTH, {
    async login(email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter the email address your school registered for you.' };
      if (!sb) return { ok: false, error: 'Still connecting to the school database. Try again in a moment.' };
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: friendly(error) };
      try {
        await sb.rpc('claim_invites');   // picks up any invitations sent to this email
        const list = await myMemberships(data.user.id);
        if (!list.length) {
          return { ok: false, noSchool: true, error: 'This email address is not linked to a school yet. Ask your school\'s director to add you, or start a new school.' };
        }
        const session = await openSchool(data.user, pick(list));
        return { ok: true, session, mustChangePassword: false };
      } catch (e) {
        return { ok: false, error: friendly(e) };
      }
    },

    logout() {
      localStorage.removeItem(SESSION_KEY);
      SYNC.detach();
      staff = []; auditRows = [];
      if (sb) sb.auth.signOut().catch(() => {});
    },

    audit(action, detail = '') { if (!AUDITED_BY_DATABASE.has(action)) SYNC.audit(action, detail); },
    getAuditLog() { return auditRows; },

    async changePassword(currentPassword, newPassword) {
      const session = AUTH.getSession();
      if (!session) return { ok: false, error: 'You are not signed in.' };
      const check = AUTH.validatePasswordStrength(newPassword);
      if (!check.ok) return check;
      const confirm = await sb.auth.signInWithPassword({ email: session.username, password: currentPassword });
      if (confirm.error) return { ok: false, error: /invalid login/i.test(confirm.error.message) ? 'Your current password is incorrect.' : friendly(confirm.error) };
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: friendly(error) };
      AUTH.audit('PASSWORD_CHANGE', '');
      return { ok: true };
    },

    /* A new staff member's account, for "First time here?". */
    async signUp(email, password) {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      const check = AUTH.validatePasswordStrength(password);
      if (!check.ok) return check;
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) return { ok: false, error: friendly(error) };
      return { ok: true, confirmEmail: !data.session };
    },

    async sendPasswordReset(email) {
      email = String(email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      return error ? { ok: false, error: friendly(error) } : { ok: true };
    },

    /* After following a password-reset link. */
    async setNewPassword(newPassword) {
      const check = AUTH.validatePasswordStrength(newPassword);
      if (!check.ok) return check;
      const { error } = await sb.auth.updateUser({ password: newPassword });
      return error ? { ok: false, error: friendly(error) } : { ok: true };
    },

    /* For someone signed in whose email is not linked to a school yet. */
    async createSchool(name, displayName) {
      name = String(name || '').trim(); displayName = String(displayName || '').trim();
      if (name.length < 2) return { ok: false, error: 'Enter the school\'s name.' };
      if (!displayName) return { ok: false, error: 'Enter your name.' };
      const { data } = await sb.auth.getSession();
      const user = data && data.session && data.session.user;
      if (!user) return { ok: false, error: 'Sign in first.' };
      const created = await sb.rpc('create_school', { p_name: name, p_display_name: displayName });
      if (created.error) return { ok: false, error: friendly(created.error) };
      try {
        const m = (await myMemberships(user.id)).find(x => x.school_id === created.data);
        if (!m) return { ok: false, error: 'The school was created but could not be opened. Sign in again.' };
        return { ok: true, session: await openSchool(user, m) };
      } catch (e) {
        return { ok: false, error: friendly(e) };
      }
    },

    getUsers() { return staff; },
    refreshStaff,

    /* Add (invite) or edit a staff member. */
    async upsertUser(d) {
      const session = AUTH.getSession();
      if (!session || session.role !== 'exec') return { ok: false, error: 'You do not have permission to manage staff.' };
      const values = { role: d.role, display_name: d.displayName, assigned_classes: d.role === 'teacher' ? (d.assignedClasses || []) : [] };
      let res;
      if (d.id && String(d.id).startsWith('invite:')) {
        res = await sb.from('invites').update(values).eq('id', String(d.id).slice(7));
      } else if (d.id) {
        res = await sb.from('memberships').update(values).eq('school_id', session.schoolId).eq('user_id', d.id);
      } else {
        const email = String(d.username || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter the staff member\'s email address.' };
        res = await sb.from('invites').insert([Object.assign({ school_id: session.schoolId, email, invited_by: session.userId }, values)]);
      }
      if (res.error) return { ok: false, error: friendly(res.error) };
      AUTH.audit(d.id ? 'USER_UPDATE' : 'USER_INVITE', (d.username || '') + ' · ' + d.role);
      await refreshStaff().catch(() => {});
      return { ok: true, invited: !d.id };
    },

    /* Remove someone from the school, or cancel an invitation. */
    async deleteUser(id) {
      const session = AUTH.getSession();
      if (!session || session.role !== 'exec') return { ok: false, error: 'You do not have permission to manage staff.' };
      if (id === session.userId) return { ok: false, error: 'You cannot remove yourself.' };
      const res = String(id).startsWith('invite:')
        ? await sb.from('invites').delete().eq('id', String(id).slice(7))
        : await sb.from('memberships').delete().eq('school_id', session.schoolId).eq('user_id', id);
      if (res.error) return { ok: false, error: friendly(res.error) };
      AUTH.audit('USER_REMOVE', id);
      await refreshStaff().catch(() => {});
      return { ok: true };
    },

    /* Online, nobody sets another person's password: they get a reset link. */
    async adminResetPassword(userId) {
      const u = staff.find(x => x.id === userId);
      if (!u || u.pending) return { ok: false, error: 'This person has not created their account yet.' };
      const res = await AUTH.sendPasswordReset(u.username);
      if (res.ok) AUTH.audit('PASSWORD_RESET_LINK', u.username);
      return res;
    },

    currentUserClasses() {
      const s = AUTH.getSession();
      if (!s || s.role !== 'teacher') return null;
      return Array.isArray(s.assignedClasses) ? s.assignedClasses : [];
    },
    mustChangePassword() { return false; },
  });
})();
