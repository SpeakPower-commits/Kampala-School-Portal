/*
 * auth.js — Role-based authentication for the School Management Portal.
 *
 * Passwords are hashed with PBKDF2 (SHA-256, 120,000 iterations) and a unique
 * per-user random salt, using the browser's Web Crypto API. Nothing is stored
 * in plain text. Sessions and the audit trail live in localStorage.
 *
 * Roles:
 *   exec     Full access, user management, settings, audit log
 *   admin    Students, academics, payments, conduct, administration
 *   bursary  Payments, bursaries, financial reports
 *   coach    Sports, attendance, competitions, squads
 *   teacher  Class register, marks and report comments for assigned classes
 */

'use strict';

const PBKDF2_ITERATIONS = 120000;

/* Seed accounts. Passwords must be changed on first sign-in.
   Defaults: exec / Exec@2026, admin / Admin@2026,
             bursary / Bursary@2026, coach / Coach@2026            */
const DEFAULT_USERS = [
  {
    id: 'U001', username: 'exec', displayName: 'Executive Director', role: 'exec',
    salt: '0f4f07a65545b82da9d59414d13530f4',
    passwordHash: '10fab58bf6319637762b3f68f49717d3319b18a7d0683e70f067b41ee60afa22',
    iterations: PBKDF2_ITERATIONS, mustChangePassword: true, createdAt: '2026-01-01', lastLogin: null,
  },
  {
    id: 'U002', username: 'admin', displayName: 'School Administrator', role: 'admin',
    salt: 'f097116cc1e8ab4efb0ffde09b6da531',
    passwordHash: '112fed5b77e476afd415e6e1b393a90d286c4b123644c55a6f0a4648111d43c1',
    iterations: PBKDF2_ITERATIONS, mustChangePassword: true, createdAt: '2026-01-01', lastLogin: null,
  },
  {
    id: 'U003', username: 'bursary', displayName: 'Bursary Officer', role: 'bursary',
    salt: 'fc5dfa52c41530b290e254661bd6d015',
    passwordHash: '5e29ce6132146cbbf2d58a0f32cbf0912946c29f8fd3c2251c2d856243543380',
    iterations: PBKDF2_ITERATIONS, mustChangePassword: true, createdAt: '2026-01-01', lastLogin: null,
  },
  {
    id: 'U004', username: 'coach', displayName: 'Head of Sports', role: 'coach',
    salt: 'e0201c79aa095e83fcc30b074bf2733c',
    passwordHash: '5e6816f691f34527fed302ba05fbd29e72621151d15cbede949e05488b5e1f33',
    iterations: PBKDF2_ITERATIONS, mustChangePassword: true, createdAt: '2026-01-01', lastLogin: null,
  },
];

const ROLE_PERMISSIONS = {
  exec: {
    label: 'Executive Director', color: '#0b5d3b', badge: 'Executive',
    tabs: ['overview', 'directory', 'register', 'academics', 'payments', 'sports', 'conduct', 'reports', 'noticeboard', 'admin'],
    canExport: true, canImport: true, canReset: true, canManageUsers: true,
    canManageSettings: true, canDeleteStudents: true, canEditStudents: true,
    canDeleteConduct: true, canAwardBursary: true, canRecordPayment: true,
    canVoidPayment: true, canRegisterStudent: true, canAddProgram: true,
    canLogPerformance: true, canMarkAttendance: true, canAddAcademic: true,
    canLogConduct: true, canManageTerms: true, canViewEMIS: true,
    canPostNotice: true, canManageCompetitions: true, canManageSquads: true,
    canMarkRegister: true, canHeadComment: true,
    canPublishResults: true, canBroadcastSms: true, canViewSmsLog: true,
  },
  admin: {
    label: 'School Administrator', color: '#1d4ed8', badge: 'Administrator',
    tabs: ['overview', 'directory', 'register', 'academics', 'payments', 'sports', 'conduct', 'reports', 'noticeboard', 'admin'],
    canExport: true, canImport: true, canReset: false, canManageUsers: false,
    canManageSettings: false, canDeleteStudents: true, canEditStudents: true,
    canDeleteConduct: true, canAwardBursary: false, canRecordPayment: true,
    canVoidPayment: false, canRegisterStudent: true, canAddProgram: true,
    canLogPerformance: false, canMarkAttendance: false, canAddAcademic: true,
    canLogConduct: true, canManageTerms: true, canViewEMIS: true,
    canPostNotice: true, canManageCompetitions: false, canManageSquads: false,
    canMarkRegister: true, canHeadComment: true,
    canPublishResults: true, canBroadcastSms: true, canViewSmsLog: true,
  },
  bursary: {
    label: 'Bursary Officer', color: '#0b5d3b', badge: 'Bursary',
    tabs: ['payments', 'reports', 'noticeboard'],
    canExport: true, canImport: false, canReset: false, canManageUsers: false,
    canManageSettings: false, canDeleteStudents: false, canEditStudents: false,
    canDeleteConduct: false, canAwardBursary: true, canRecordPayment: true,
    canVoidPayment: true, canRegisterStudent: false, canAddProgram: false,
    canLogPerformance: false, canMarkAttendance: false, canAddAcademic: false,
    canLogConduct: false, canManageTerms: false, canViewEMIS: false,
    canPostNotice: false, canManageCompetitions: false, canManageSquads: false,
    canMarkRegister: false, canHeadComment: false,
    canPublishResults: false, canBroadcastSms: false, canViewSmsLog: false,
  },
  coach: {
    label: 'Head of Sports', color: '#b45309', badge: 'Sports',
    tabs: ['sports', 'noticeboard'],
    canExport: false, canImport: false, canReset: false, canManageUsers: false,
    canManageSettings: false, canDeleteStudents: false, canEditStudents: false,
    canDeleteConduct: false, canAwardBursary: false, canRecordPayment: false,
    canVoidPayment: false, canRegisterStudent: false, canAddProgram: true,
    canLogPerformance: true, canMarkAttendance: true, canAddAcademic: false,
    canLogConduct: false, canManageTerms: false, canViewEMIS: false,
    canPostNotice: true, canManageCompetitions: true, canManageSquads: true,
    canMarkRegister: false, canHeadComment: false,
    canPublishResults: false, canBroadcastSms: false, canViewSmsLog: false,
  },
  teacher: {
    label: 'Teacher', color: '#0e7490', badge: 'Teacher',
    tabs: ['register', 'academics', 'noticeboard'],
    canExport: false, canImport: false, canReset: false, canManageUsers: false,
    canManageSettings: false, canDeleteStudents: false, canEditStudents: false,
    canDeleteConduct: false, canAwardBursary: false, canRecordPayment: false,
    canVoidPayment: false, canRegisterStudent: false, canAddProgram: false,
    canLogPerformance: false, canMarkAttendance: false, canAddAcademic: true,
    canLogConduct: false, canManageTerms: false, canViewEMIS: false,
    canPostNotice: false, canManageCompetitions: false, canManageSquads: false,
    canMarkRegister: true, canHeadComment: false,
    canPublishResults: false, canBroadcastSms: false, canViewSmsLog: false,
  },
};

/* ── Audit trail ───────────────────────────────────────────────────────── */
function appendAuditLog(userId, username, action, detail = '') {
  const key = 'ksa_audit';
  let log = [];
  try { log = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
  log.unshift({ ts: new Date().toISOString(), userId, username, action, detail: String(detail).slice(0, 200) });
  if (log.length > 500) log = log.slice(0, 500);
  try { localStorage.setItem(key, JSON.stringify(log)); } catch (_) {}
}

/* ── PBKDF2 password hashing ───────────────────────────────────────────── */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes.buffer);
}
async function derivePassword(password, saltHex, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    baseKey, 256
  );
  return bytesToHex(bits);
}
/* Constant-time-ish comparison of two hex strings. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── User store ────────────────────────────────────────────────────────── */
function loadUsers() {
  try {
    const raw = localStorage.getItem('ksa_users');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem('ksa_users', JSON.stringify(DEFAULT_USERS));
  return DEFAULT_USERS.map(u => ({ ...u }));
}
function saveUsers(users) {
  try { localStorage.setItem('ksa_users', JSON.stringify(users)); } catch (_) {}
}

/* ── Sessions ──────────────────────────────────────────────────────────── */
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
function createSession(user) {
  const session = {
    userId: user.id, username: user.username, displayName: user.displayName,
    role: user.role, loginAt: Date.now(), expiresAt: Date.now() + SESSION_MS,
  };
  localStorage.setItem('ksa_session', JSON.stringify(session));
  return session;
}
function getSession() {
  try {
    const raw = localStorage.getItem('ksa_session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiresAt) { localStorage.removeItem('ksa_session'); return null; }
    return session;
  } catch (_) { return null; }
}
function clearSession() {
  const session = getSession();
  if (session) appendAuditLog(session.userId, session.username, 'LOGOUT', '');
  localStorage.removeItem('ksa_session');
}

const AUTH = {
  ITERATIONS: PBKDF2_ITERATIONS,

  /* Hash a password with a fresh salt. Returns { salt, hash, iterations }. */
  async hashPassword(plain) {
    const salt = randomSaltHex();
    const hash = await derivePassword(plain, salt, PBKDF2_ITERATIONS);
    return { salt, hash, iterations: PBKDF2_ITERATIONS };
  },

  async login(username, password) {
    const users = loadUsers();
    const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase().trim());
    // Always run a derivation to blunt username enumeration timing.
    const salt = user ? user.salt : '00000000000000000000000000000000';
    const iterations = user ? (user.iterations || PBKDF2_ITERATIONS) : PBKDF2_ITERATIONS;
    const candidate = await derivePassword(password, salt, iterations);
    if (!user || !safeEqual(candidate, user.passwordHash)) {
      appendAuditLog(user ? user.id : '-', String(username).slice(0, 40), 'LOGIN_FAILED', '');
      return { ok: false, error: 'Incorrect username or password.' };
    }
    user.lastLogin = new Date().toISOString();
    saveUsers(users);
    const session = createSession(user);
    appendAuditLog(user.id, user.username, 'LOGIN', 'role=' + user.role);
    return { ok: true, session, mustChangePassword: !!user.mustChangePassword };
  },

  logout() { clearSession(); },
  getSession,
  getPermissions(role) { return ROLE_PERMISSIONS[role] || null; },

  can(permission) {
    const session = getSession();
    if (!session) return false;
    const perms = ROLE_PERMISSIONS[session.role];
    return perms ? !!perms[permission] : false;
  },
  hasTabAccess(tab) {
    const session = getSession();
    if (!session) return false;
    const perms = ROLE_PERMISSIONS[session.role];
    return perms ? perms.tabs.includes(tab) : false;
  },
  getDefaultTab() {
    const session = getSession();
    if (!session) return 'overview';
    const perms = ROLE_PERMISSIONS[session.role];
    return perms ? perms.tabs[0] : 'overview';
  },

  /* Record a domain event in the audit trail (used by the app for
     financially significant actions such as payments and deletions). */
  audit(action, detail = '') {
    const session = getSession();
    if (!session) return;
    appendAuditLog(session.userId, session.username, action, detail);
  },

  async changePassword(currentPassword, newPassword) {
    const session = getSession();
    if (!session) return { ok: false, error: 'You are not signed in.' };
    const check = validatePasswordStrength(newPassword);
    if (!check.ok) return check;
    const users = loadUsers();
    const user = users.find(u => u.id === session.userId);
    if (!user) return { ok: false, error: 'Account not found.' };
    const currentHash = await derivePassword(currentPassword, user.salt, user.iterations || PBKDF2_ITERATIONS);
    if (!safeEqual(currentHash, user.passwordHash)) return { ok: false, error: 'Your current password is incorrect.' };
    const next = await AUTH.hashPassword(newPassword);
    user.salt = next.salt; user.passwordHash = next.hash; user.iterations = next.iterations;
    user.mustChangePassword = false;
    saveUsers(users);
    appendAuditLog(session.userId, session.username, 'PASSWORD_CHANGE', '');
    return { ok: true };
  },

  async upsertUser(userData) {
    const session = getSession();
    if (!session || session.role !== 'exec') return { ok: false, error: 'You do not have permission to manage users.' };
    const users = loadUsers();
    const clash = users.find(u => u.username.toLowerCase() === String(userData.username).toLowerCase() && u.id !== userData.id);
    if (clash) return { ok: false, error: 'That username is already taken.' };
    const idx = users.findIndex(u => u.id === userData.id);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...userData };
    } else {
      users.push({
        id: 'U' + Date.now(), mustChangePassword: true,
        createdAt: new Date().toISOString().slice(0, 10), lastLogin: null, ...userData,
      });
    }
    saveUsers(users);
    appendAuditLog(session.userId, session.username, 'USER_UPSERT', 'target=' + userData.username);
    return { ok: true };
  },

  getUsers() {
    const session = getSession();
    if (!session || session.role !== 'exec') return [];
    return loadUsers().map(u => ({
      id: u.id, username: u.username, displayName: u.displayName, role: u.role,
      mustChangePassword: u.mustChangePassword, createdAt: u.createdAt, lastLogin: u.lastLogin,
      assignedClasses: u.assignedClasses || [],
    }));
  },

  getAuditLog() {
    const session = getSession();
    if (!session || session.role !== 'exec') return [];
    try { return JSON.parse(localStorage.getItem('ksa_audit') || '[]'); } catch (_) { return []; }
  },

  deleteUser(userId) {
    const session = getSession();
    if (!session || session.role !== 'exec') return { ok: false, error: 'You do not have permission to manage users.' };
    if (userId === session.userId) return { ok: false, error: 'You cannot delete your own account.' };
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return { ok: false, error: 'Account not found.' };
    const username = users[idx].username;
    users.splice(idx, 1);
    saveUsers(users);
    appendAuditLog(session.userId, session.username, 'USER_DELETE', 'target=' + username);
    return { ok: true };
  },

  async adminResetPassword(userId, newPassword) {
    const session = getSession();
    if (!session || session.role !== 'exec') return { ok: false, error: 'You do not have permission to manage users.' };
    const check = validatePasswordStrength(newPassword);
    if (!check.ok) return check;
    const users = loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return { ok: false, error: 'Account not found.' };
    const next = await AUTH.hashPassword(newPassword);
    user.salt = next.salt; user.passwordHash = next.hash; user.iterations = next.iterations;
    user.mustChangePassword = true;
    saveUsers(users);
    appendAuditLog(session.userId, session.username, 'ADMIN_PWD_RESET', 'target=' + user.username);
    return { ok: true };
  },

  refreshSession() {
    const session = getSession();
    if (!session) return false;
    session.expiresAt = Date.now() + SESSION_MS;
    localStorage.setItem('ksa_session', JSON.stringify(session));
    return true;
  },
  sessionSecondsLeft() {
    const session = getSession();
    if (!session) return 0;
    return Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));
  },

  /* Classes a teacher may work with; null means every class (all other roles). */
  currentUserClasses() {
    const session = getSession();
    if (!session || session.role !== 'teacher') return null;
    const user = loadUsers().find(u => u.id === session.userId);
    return (user && Array.isArray(user.assignedClasses)) ? user.assignedClasses : [];
  },

  /* True while the signed-in account still has to replace its password. */
  mustChangePassword() {
    const session = getSession();
    if (!session) return false;
    const user = loadUsers().find(u => u.id === session.userId);
    return !!(user && user.mustChangePassword);
  },

  validatePasswordStrength,
  ROLE_PERMISSIONS,
};

function validatePasswordStrength(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (!/[A-Za-z]/.test(pwd) || !/[0-9]/.test(pwd)) return { ok: false, error: 'Use at least one letter and one number.' };
  return { ok: true };
}

window.AUTH = AUTH;
