# School Management Portal
### Offline-first school administration for Ugandan schools & academies — v3.5.0

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
- **Fees and arrears under control.** Fee structures per class and term
  (tuition, boarding, PTA…), installment plans, and a per-term bill for every
  learner. Unpaid balances carry forward as arrears automatically, and every
  payment — cash, MTN or Airtel Mobile Money, bank — clears the oldest term first.
- **Know who owes what.** A finance dashboard with this term's collection rate,
  arrears, collections by payment method, fees by class and the top defaulters,
  each one tap away from an SMS or WhatsApp reminder.
- **Report cards in minutes.** A class mark sheet for each subject, beginning /
  mid / end-of-term marks, class and stream positions, PLE aggregates and
  divisions, teacher comments — then print the whole class, one page per learner.
- **Daily class register.** Present, absent, late or excused, with one-tap
  messages to the guardians of absent learners.
- **Parent portal (online edition).** Parents sign in on their phone with a
  code sent by SMS and see their children's fees and receipts, published report
  cards, attendance and school notices. They see only their own children.
- **SMS to parents (online edition).** Fee reminders to every family that
  owes (with each balance), absence alerts from the morning register, and
  notices to every guardian, through the school's own Africa's Talking
  account. A preview shows the number of messages and SMS pages first, and
  every run is logged.
- **Parent communication.** One-tap SMS and WhatsApp fee reminders and conduct
  notices, pre-filled in the school's name.
- **Official documents.** Receipts with the amount in words, fees statements
  with arrears brought forward, and report cards — all with the school's logo.
- **Government reporting.** One-click EMIS enrolment CSV (gender, boarding, SEN,
  fees) per term.
- **Your school's identity.** Name, motto, contacts, logo, school colour and
  grading scales — used across the app, documents and messages.
- **Easy switch-over.** Import existing learners (with opening balances) from an
  Excel/CSV sheet.
- **Installable (PWA).** "Add to Home Screen" on any phone, tablet or laptop.

---

## Where things are

Ten modules in the top menu. Most have sub-tabs, so each screen shows one job at a time.

| Module | Sub-tabs |
|--------|----------|
| **Dashboard** | Fees at a glance, today's class attendance, and what's new |
| **Students** | All students · Admit a student · Import from Excel |
| **Attendance** | Daily register (every class, every morning) · Recent registers |
| **Academics** | Enter marks · Mark sheet · Comments · Report cards · Grading scales |
| **Fees** | Record payment · Fees dashboard · Terms & fee structures · Bursaries |
| **Sports** | Programmes · Training attendance · Competitions & squads · Athletes · Bursary candidates |
| **Discipline** | Conduct log, with messages to guardians |
| **Reports** | Statistics · EMIS |
| **Notices** | The school notice board |
| **Administration** | Staff accounts · School profile & logo · SMS (online) · Data & backup |

---

## Roles

| Role | Sees | Can do |
|------|------|--------|
| **Executive Director** | All ten modules | Full access, staff accounts, school profile, audit log, data reset |
| **School Administrator** | All ten modules; Sports is view-only apart from adding programmes | Admit and edit students, record payments, open terms and set fees, enter marks, log conduct |
| **Bursary Officer** | Fees, Reports, Notices | Record and reverse payments, give any learner a bursary, fee reports |
| **Head of Sports** | Sports, Notices | Programmes, training attendance, competitions, squads, athlete profiles, bursary candidates |
| **Teacher** | Attendance, Academics, Notices — **assigned classes only** | Call the register, enter marks, write class-teacher comments, text the guardians of absent learners (online) |
| **Parent** (online) | The parent portal (`parent.html`) | Their own children only: fees, receipts, published report cards, attendance, notices for parents |

---

## First-time setup

1. **Serve the folder over HTTP/HTTPS** (see *Deployment* below). Do **not** open
   `index.html` as a `file://` URL — the offline features need a real origin.
2. Sign in with the credentials your supplier gave you. On first sign-in each
   account is **forced to set a private password** — the defaults stop working
   once changed and there is no way to skip this step.
3. As the Executive Director, open **Administration → School profile & logo**
   and enter your school's name, motto, address, contacts and O-Level grading
   mode.
4. Under **Fees → Terms & fee structures**, open the current term, then enter
   what each class or level pays (mark boarding-only items) and, if you use
   them, the installment plan.
5. Add learners under **Students** — one by one with **Admit a student**, or all
   at once with **Import from Excel** (download the template, fill it in Excel,
   save as CSV). Use the opening-balance column for fees owed from before.
6. Under **Administration → Staff accounts**, create a **Teacher** account for
   each class teacher and tick their classes.
7. Take your first **Backup**.

## Running a term

| When | Where | What |
|------|-------|------|
| Start of term | Fees → Terms & fee structures | **Open term** — every learner is billed and unpaid balances become arrears. Fee structures carry over; edit them and press **Apply to learners** if fees changed. |
| Every morning | Attendance → Daily register | Each class teacher calls the register; message the guardians of absent learners. The Dashboard shows which classes are still to be marked. |
| Whenever fees come in | Fees → Record payment | Record the payment with its method and Mobile Money / bank reference, and print the receipt. |
| Weekly | Fees → Fees dashboard | Review the collection rate and top defaulters; send **Fee reminders**. |
| Test / exam time | Academics → Mark sheet | Enter a subject for the whole class (beginning, mid or end of term). |
| End of term | Academics → Comments, then Report cards | Write comments, then **Print class** for report cards. |

> The four seed accounts (`exec`, `admin`, `bursary`, `coach`) exist only to
> bootstrap the first sign-in. Change every password immediately and create
> named staff accounts under **Administration → Staff accounts**.

---

## Files

```
school-portal/
├── index.html          Markup only (strict Content-Security-Policy)
├── styles.css          Institutional stylesheet (no external dependencies)
├── core.js             Shared helpers: formatting, icons, dialogs, printing (staff app and parent portal)
├── app.js              Core: learners, payments, sports, conduct, UI shell
├── billing.js          Terms, fee structures, bills, arrears, receipts, finance dashboard
├── academics.js        Grading scales, marks, positions, comments, report cards
├── register.js         Daily class register
├── tools.js            CSV import/export, logo & colours, daily snapshots
├── auth.js             Authentication and roles (PBKDF2 password hashing)
├── service-worker.js   Offline cache (network-first for app code)
├── manifest.json       PWA manifest
├── icon192.png         App icon (192×192)
├── icon512.png         App icon (512×512)
├── tests/e2e.js        End-to-end tests (run on every push by GitHub Actions)
├── tests/online.e2e.mjs  End-to-end tests of the online edition (staff and parents)
├── tests/worker.test.mjs  Tests of the Worker's SMS API and sign-in hook
│
│   Online edition (shared school database)
├── config.js           Which edition runs here (by web address) and the database address
├── auth-online.js      Staff sign-in by email, invitations, password resets
├── sync.js             Loads the school's data and saves only what changed
├── vendor/supabase.js  Official Supabase client, pinned (see vendor/README.md)
├── sms.js              SMS to guardians: send dialog, Administration → SMS
├── parent.html         The parent portal (sign in by SMS code)
├── parent.js           …fees, receipts, report cards, attendance, notices
│
│   Hosting on Cloudflare
├── wrangler.jsonc      Cloudflare Worker settings
├── worker/index.js     Server API (/api/*): SMS sending and the parent sign-in hook
├── _headers            Security headers for every page
├── .assetsignore       Repository files that are never published
│
└── supabase/
    ├── migrations/     Database tables and row-level security
    ├── tests/          Database security tests (run on every push)
    └── dev/server.mjs  Local stand-in for Supabase, for tests and demos
```

No build step, no bundler, no CDN. Everything is self-contained and works
offline from the first load.

---

## Deployment

### Cloudflare (the portal's production home)
One Cloudflare Worker serves the portal's files from Cloudflare's network, which
includes Kampala, and will run the online edition's server API. Requests for the
app's files are free and unlimited.

1. In the Cloudflare dashboard open **Workers & Pages → Create application →
   GitHub**, and pick this repository. The Worker name must stay
   `kampala-school-portal`, the same as in `wrangler.jsonc`.
2. Keep the production branch as `main`. No build command is needed.
3. Under **Settings → Builds**, turn on **Builds for Preview branches**. Every
   branch and pull request then gets its own preview link, so changes can be
   tried on a phone before they go live.

Only the app's own files are published. `.assetsignore` keeps the server code,
database scripts, tests and documentation off the site, and `_headers` adds
the security headers.

### Turning on the online edition, the parent portal and SMS
Everything below is built and tested locally; these are the one-time steps on
the real services.

1. **Supabase** (Frankfurt region): create the project, then in **SQL Editor**
   run `supabase/migrations/0001_init.sql`, then `0002_parents_sms.sql`.
2. **Supabase → Authentication:**
   - keep **Confirm email** on (staff invitations rely on it);
   - turn on the **Phone** provider with phone confirmations required (not auto-confirmed);
   - set the SMS code to expire after about 5 minutes, because Ugandan networks can be slow;
   - under **Auth Hooks**, add a **Send SMS** hook of type HTTPS pointing to
     `https://<your portal>/api/hooks/send-sms`, and copy the secret it generates
     (`v1,whsec_…`).
3. **Cloudflare → the Worker → Settings → Variables and secrets:**
   - plain text: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`;
   - secrets:
     - `SUPABASE_SECRET_KEY`;
     - `SEND_SMS_HOOK_SECRET` (the `v1,whsec_…` value);
     - `SMS_KEY_SECRET`, made with `openssl rand -base64 32`. It encrypts each school's
       Africa's Talking key. Keep a copy somewhere safe: if it is lost, every
       school must enter its key again.
4. **`config.js`:** set `supabaseUrl`, `supabaseKey` (the publishable key) and
   `onlineHosts` (the portal's web address).
5. **Each school:**
   1. Opens an Africa's Talking account and tops it up.
   2. Asks Africa's Talking for a sender ID (the school's short name), which is registered with UCC and takes some days.
   3. Has the director save the username, API key and sender ID under **Administration → SMS**, then **Send test**.

   The username `sandbox` with the sandbox option ticked works for trying it out: nothing reaches real phones.
6. **Parents:** give them the address `https://<your portal>/parent.html`. They sign
   in with the number the school holds for them (first or second guardian).

**Costs:** every SMS is paid by the school, on its own Africa's Talking account:
- reminders, absence alerts and notices;
- a parent's sign-in code, which is one SMS each time the parent signs in on a new phone.

The send preview shows the number of messages and SMS pages before anything goes out.

### GitHub Pages (free, HTTPS — for trying it out)
GitHub's terms don't allow Pages to host a commercial service, so use it for
demos and testing only.
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

**The online edition** keeps each school's records in one shared database,
where row-level security decides who sees what. A school never sees another
school's records, and a teacher sees only their own classes.
- **Parents.** A parent sees only the learners whose guardian number is theirs,
  and only once that number is verified by SMS code. Marks, report cards and
  positions appear only after the school publishes the term.
- **SMS.** Who may send which messages, to whom and with what text, is decided
  by the database, never by the browser.
- **The Africa's Talking key.** Each school's key is checked with Africa's
  Talking, then encrypted by the Cloudflare Worker before it is stored. No
  browser and no member of staff can read it back.

The database's security rules are tested on every change (`supabase/tests`).

**What this means in practice (offline edition):** anyone with access to the unlocked device can,
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
| `kampala_school_portal_state` | Learners, terms, fee structures, bills, payments, marks, registers, sports, conduct, notices, settings |
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

The portal also keeps an automatic **daily snapshot** for the last 7 days on the
device (Administration → Data & backup → *Restore a daily snapshot*). It undoes
mistakes such as a wrong import, but it does not protect against losing the
device — keep exporting backups.

Upgrading from v2 is automatic: each learner's termly fee becomes a bill for the
current term, with exactly the same balance.

---

## Uganda curriculum reference

| Level | Classes | Grading |
|-------|---------|---------|
| Pre-Primary | Baby, Middle, Top Class | — |
| Primary | P.1 – P.7 | D1–F9 per subject; PLE aggregate of English, Mathematics, Science and Social Studies → Division I (4–12), II (13–23), III (24–29), IV (30–33), U |
| O-Level (UCE) | S.1 – S.4 | Legacy: D1–F9 → Division I–IV · New Lower Secondary: A–E competency (school-configurable) |
| A-Level (UACE) | S.5 – S.6 | A (6) – F (0), best 3 principal subjects |

O-Level aggregates are computed **per term over the best 8 distinct
subjects**. A subject's term result is the end-of-term mark, or the average of
the beginning- and mid-term marks if there is no end-of-term mark yet. Positions
use competition ranking (two learners tied for 2nd are both 2nd; the next is 4th).

Grade cut-offs differ between schools, so every scale is editable under
**Academics → Grading scales**. Check them against your school's own scale
before printing report cards.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Data "disappeared" | Were you in a private/incognito window? Use a normal window. |
| SMS/WhatsApp link opens with no number | Guardian phone must be a Ugandan format: `0772…` or `+256772…` |
| Can't install as an app | It must be served over HTTPS (or `localhost`), not `file://` |
| Restore failed | The file must be a `.json` backup exported by this app |
| Update not showing | The app is network-first; reconnect once and refresh |
| Teacher sees no classes | Edit the teacher's account and tick their classes |
| A learner is billed the wrong amount | Check **Fee structures** for that term (a class beats a level, a level beats "All classes"), then **Apply to learners** |
| Import rejected rows | The preview lists the problem on each row; fix them in the sheet and import again |

## Running the tests

```bash
npm install --no-save playwright @electric-sql/pglite
npx playwright install chromium

# Database security: signs in as each kind of staff member on a local Postgres
# (no Supabase account needed) and checks what each one can read and change
node supabase/tests/rls.test.mjs

# The online edition against a local stand-in for Supabase (real Postgres in
# WebAssembly with the real security rules, and the official Supabase client)
node tests/online.e2e.mjs

# The Worker: SMS sending and the parent sign-in hook (no browser needed)
node tests/worker.test.mjs

# The offline edition, in a real browser
python3 -m http.server 8099 &
node tests/e2e.js
```

To try the online edition by hand, run `node supabase/dev/server.mjs` and open
the address it prints.

---

**Version:** 3.5.0 · **License:** MIT — free for any school.
