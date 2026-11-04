# School Management Portal
### Offline-first school administration for Ugandan schools & academies — v2.0.0

A complete, installable school management system that runs entirely in the
browser and works **fully offline**. Built for the realities of Ugandan
schools: unreliable internet, shared devices, UNEB grading, EMIS returns, and
mobile-money fee collection. No servers, no subscriptions, no data leaving the
device.

---

## Why schools choose it

- **Works without internet.** Everything is stored on the device. Load it once
  and it keeps working during power and network outages.
- **Uganda curriculum built in.** Automatic grading for Primary, O-Level and
  A-Level, with both the legacy Division/D1–F9 system and the new Lower
  Secondary competency grades (A–E) — switchable per school.
- **Fees under control.** A true payment ledger with mobile-money / cash / bank
  methods, references, receipts, reversible entries and an audit trail.
- **Parent communication.** One-tap SMS and WhatsApp fee reminders and conduct
  notices, pre-filled in the school's name.
- **Official documents.** Printable, school-branded fee receipts and termly
  report cards.
- **Government reporting.** One-click EMIS enrolment CSV (gender, boarding, SEN,
  fees) per term.
- **White-label.** Set the school name, motto, address, contacts and grading
  mode; they flow through the whole app, receipts and messages.
- **Installable (PWA).** "Add to Home Screen" on any phone, tablet or laptop.

---

## Roles

| Role | Sees | Can do |
|------|------|--------|
| **Executive Director** | Everything | Full access, user management, school settings, audit log, data reset |
| **School Administrator** | Students, academics, payments, conduct, reports, admin | Register/edit students, record payments, log academics & conduct, manage terms |
| **Bursary Officer** | Payments, bursaries, reports | Record & reverse payments, award bursaries, financial reports |
| **Head of Sports** | Sports, attendance, competitions, bursaries | Programs, attendance, competitions, squads, athlete profiles |

---

## First-time setup

1. **Serve the folder over HTTP/HTTPS** (see *Deployment* below). Do **not** open
   `index.html` as a `file://` URL — the offline features need a real origin.
2. Sign in with the credentials your supplier gave you. On first sign-in each
   account is **forced to set a private password** — the defaults stop working
   once changed and there is no way to skip this step.
3. As the Executive Director, open **Administration → School profile & settings**
   and enter your school's name, motto, address, contacts and O-Level grading
   mode.
4. Register students, set the current term, and take your first **Backup**.

> The four seed accounts (`exec`, `admin`, `bursary`, `coach`) exist only to
> bootstrap the first sign-in. Change every password immediately and create
> named staff accounts under **User management**.

---

## Files

```
school-portal/
├── index.html          Markup only (strict Content-Security-Policy)
├── styles.css          Institutional stylesheet (no external dependencies)
├── app.js              Application logic
├── auth.js             Authentication module (PBKDF2 password hashing)
├── service-worker.js   Offline cache (network-first for app code)
├── manifest.json       PWA manifest
├── icon192.png         App icon (192×192)
└── icon512.png         App icon (512×512)
```

No build step, no bundler, no CDN. Everything is self-contained and works
offline from the first load.

---

## Deployment

### GitHub Pages (free, HTTPS)
1. Push all files to a repository.
2. **Settings → Pages → Source:** deploy from `main` / root.
3. Open `https://YOUR-USER.github.io/REPO/`.

### Netlify
Drag the folder onto [netlify.com/drop](https://app.netlify.com/drop).

### Local network (a school laptop as the "server")
```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

---

## Security model — read this

This is a **single-device, offline** application. All data lives in the
browser's `localStorage` on the device where it is used.

- Passwords are hashed with **PBKDF2-SHA-256 (120,000 iterations, per-user
  salt)** via the Web Crypto API — never stored in plain text.
- Sign-in is **role-based**; every action re-checks the signed-in role.
- All output is HTML-escaped and admission numbers are validated, so student
  data cannot inject scripts. A strict Content-Security-Policy blocks any
  external or inline script.
- Login, password changes, user management, **payments, reversals, bursary
  awards and student changes** are written to an audit log (Executive only).

**What this means in practice:** anyone with access to the unlocked device can,
in principle, read the local data. Treat each device like a paper register —
keep it password-protected at the operating-system level, and use the built-in
**Backup** regularly. This design is deliberate: it keeps the app free, private
and fully functional without internet. If you need real multi-device sync or
central control, that requires a hosted backend (a future option).

---

## Data & backup

All data lives under these `localStorage` keys:

| Key | Contents |
|-----|----------|
| `kampala_school_portal_state` | Students, payments, academics, attendance, conduct, programs, competitions, squads, notices, terms, fee components, settings |
| `ksa_users` | Staff accounts (hashed passwords) |
| `ksa_session` | Current sign-in session (8 hours) |
| `ksa_audit` | Audit trail (last 500 events) |

The app requests **persistent storage** and reminds you to back up if it has
been more than a week. Recommended routine:

| When | Action |
|------|--------|
| Daily in term time | **Backup** from the top bar |
| Weekly | Copy the backup to Google Drive / a flash disk |
| Before any reset or restore | Always back up first |

Move data between devices with **Backup** on one device and **Restore** on
another.

---

## Uganda curriculum reference

| Level | Classes | Grading |
|-------|---------|---------|
| Pre-Primary | Baby, Middle, Top Class | — |
| Primary | P.1 – P.7 | Distinction / Credit / Pass / Fail |
| O-Level (UCE) | S.1 – S.4 | Legacy: D1–F9 → Division I–IV · New Lower Secondary: A–E competency (school-configurable) |
| A-Level (UACE) | S.5 – S.6 | A (6) – F (0), best 3 principal subjects |

O-Level aggregates are computed **per sitting over the best 8 distinct
subjects**, matching UNEB practice.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Data "disappeared" | Were you in a private/incognito window? Use a normal window. |
| SMS/WhatsApp link opens with no number | Guardian phone must be a Ugandan format: `0772…` or `+256772…` |
| Can't install as an app | It must be served over HTTPS (or `localhost`), not `file://` |
| Restore failed | The file must be a `.json` backup exported by this app |
| Update not showing | The app is network-first; reconnect once and refresh |

---

**Version:** 2.0.0 · **License:** MIT — free for any school.
