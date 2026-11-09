# School Management Portal
### Offline-first school administration for Ugandan schools & academies — v3.9.0

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
- **Report cards in minutes.** Enter a whole class's marks for a subject on one
  screen (the grade shows as you type), see the class results with positions,
  PLE aggregates and divisions, write comments, then view or print one child's
  card or the whole class, one page per learner.
- **Daily class register, with names.** Tap Present, Absent, Late or Excused for
  each child; the screen names who is absent as you go. "Who was absent" and a
  term sheet like the paper register show exactly which child missed which day,
  and the Dashboard names today's absent children.
- **One page per learner.** Tap any child's name to see their attendance (with
  the dates absent), marks and report card, fees, sports and discipline.
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

Nine modules in the top menu (on a phone, under **Menu**). Most have sub-tabs, so each screen shows one job at a time.
Every name opens that child's page, and every number in Reports opens the children behind it.

| Module | Sub-tabs |
|--------|----------|
| **Dashboard** | A teacher's **My work today** (their register and their subjects' marks); for the office, **Marks still missing**, Today's jobs (one tap each), fees at a glance, and today's attendance with the absent children's names |
| **Students** | All students · Attendance today · Who was absent · Term sheet · Admit a new learner · Import from Excel |
| **Academics** | Enter marks · Class results · Comments · Report cards · Grading scales |
| **Fees** | Record payment (and the Payments list) · Fees dashboard (and Who owes) · Terms & fee structures · Bursaries |
| **Sports** | Programmes · Training attendance · Competitions & squads · Athletes · Bursary candidates |
| **Discipline** | Log a conduct entry, and the conduct log, with messages to guardians |
| **Reports** | Statistics · EMIS |
| **Notices** | The school notice board |
| **Administration** | Staff & who did what · School profile & logo · SMS (online) · Backup & restore |

---

## Roles

| Role | Sees | Can do |
|------|------|--------|
| **Executive Director** | All nine modules | Full access, staff accounts, school profile, "who did what", data reset |
| **School Administrator** | All nine modules; Sports is view-only apart from adding programmes | Admit and edit students, record payments, open terms and set fees, enter marks, log conduct |
| **Bursary Officer** | Fees, Students (all students and admissions), Reports, Notices | Admit new learners and correct their details (never remove them), record and reverse payments, give any learner a bursary, fee reports |
| **Head of Sports** | Sports, Notices | Programmes, training attendance, competitions, squads, athlete profiles, bursary candidates |
| **Teacher** | Dashboard (**My work today**), Students (My classes and the register, no fees), Academics, Notices — **their own classes only** | Call the register for the class they are class teacher of, type marks in **their own subjects only** (colleagues' columns are shown but locked), write class-teacher comments, text the guardians of absent learners (online) |
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
5. Add learners under **Students** — one by one with **Admit a new learner** (the office: director, administrator or bursar), or all
   at once with **Import from Excel** (download the template, fill it in Excel,
   save as CSV). Use the opening-balance column for fees owed from before.
6. Under **Administration → Staff & who did what**, press **Add a staff member**
   for each teacher: name, username, role **Teacher**, a first password (they
   choose their own when they first sign in), and **who teaches what**:
   - **Class teacher of**: the class whose roll they call each morning;
   - **Subjects they teach**: one row per subject and class, e.g. Mathematics · S.4 and
     Mathematics · S.3. They type marks only in these; their home screen lists them.
   The classes they may open follow from these rows.
7. Press **Back up now** under **Administration → Backup & restore**.

## Running a term

| When | Where | What |
|------|-------|------|
| Start of term | Fees → Terms & fee structures | **Open term** — every learner is billed and unpaid balances become arrears. Fee structures carry over; edit them and press **Apply to learners** if fees changed. |
| Every morning | Students → Attendance today (or the teacher's **My work today**) | Each class teacher marks every child; message the guardians of absent learners. The Dashboard names the absent children, shows which classes are still to be marked, and flags any child absent 3 days in a row. |
| Whenever fees come in | Fees → Record payment | Record the payment with its method and Mobile Money / bank reference, then press **Print receipt**. |
| Weekly | Fees → Fees dashboard | Under **Who owes**, choose a class and send reminders; check the share of this term's bills paid. |
| Every week | Administration → Backup & restore | **Back up now** (offline edition) and keep the file safe. |
| Test / exam time | My work today, or Academics → Enter marks | Each subject teacher types their pile of scripts into the mark sheet (beginning, mid or end of term). The director's Dashboard lists **Marks still missing**, by subject, teacher and name. |
| End of term | Academics → Class results, Comments, then Report cards | Check **Marks progress** (every subject has every child's mark), write comments, then view or print each card, or **Print all** for the class. Report cards warn if any marks are still missing. |

## How to: the daily jobs

**A teacher's day starts on My work today** (Dashboard)
- **Attendance today · S.4** (the class teacher's class): "Not taken yet", or who took it and the
  names of the absent. **Take today's attendance** opens it. A child absent **3 days or more in a
  row** is named with the guardian's number to call.
- **One card per subject taught**, e.g. **Mathematics · S.4**, with the three exams:
  "Beginning of term 40 of 40 ✓ · Mid-term 34 of 40 · 6 to go · End of term not started" and the
  names still to enter. Tap an exam: its mark sheet opens with everything chosen.

**Take attendance** (class teacher, every morning)
1. **Students → Attendance today** (or **Take today's attendance** on My work today). The children
   are those admitted to the class; choose the class (and stream). Every child starts **Not marked**:
   nobody is counted present until you mark them. The day is today; **Another day…** corrects an
   earlier one.
2. Tap **Present**, **Absent**, **Late** or **Excused** for every child. The line above the list
   says who is not marked yet and names the absent and late.
3. Press **Save attendance**. If anyone is still not marked, nothing is saved: they are named
   and highlighted. Once saved, the absent children are listed with SMS and WhatsApp buttons
   for their guardians.

**See which child was absent**
- **Dashboard:** "Absent today" names them, class by class.
- **Students → Who was absent:** every register, with names. Pick a class and dates.
  **Change this register** corrects one.
- **Students → Term sheet:** the class like the paper register, with ✓ and ✗ per day and
  each child's totals. Press **Print** for the file.
- Tap a child's name for their page, which lists the dates they were absent.

**Enter marks** (subject teacher) — the mark sheet: one row per child, one column per subject,
so each box is one child's paper in one subject.
1. From **My work today**, tap the exam on your subject's card (or **Academics → Enter marks**,
   choose the class and press **Beginning of term**, **Mid-term** or **End of term**).
2. Set **out of** under the subject to what the paper was marked out of (e.g. 50). Type each
   score as written on the script: 38 out of 50 shows **76%** and its grade. **Find a child**
   jumps to one name; Enter moves down to the next child. Your own subjects are highlighted;
   colleagues' columns are shown but locked.
3. Press **Save marks**. A mark outside the paper's total is refused; changing a mark already
   saved asks first ("Nakato Sarah's Mathematics from 76% to 80%"). Every save is in "who did what".

**One child's marks** (a make-up paper, a child who joined late)
- Tap the child's name → **Marks** → **Enter marks**: every subject for the chosen exam, by
  the same rules.

**Which marks are still missing** (director of studies, head teacher)
- **Dashboard → Marks still missing:** every unfinished sheet this term, e.g.
  "S.4 · Physics — End of term: 34 of 40 · Mr. Kato", with the names. **Open** goes to it.
- **Academics → Class results → Marks progress:** each subject's BOT, MOT and EOT counts
  ("34/40"), the subject teacher, and who is still to be entered.

**Report cards** (end of term)
1. **Academics → Class results:** check **Marks progress** first, then every child's marks,
   average and position.
2. **Academics → Comments:** write the comments (or **Suggest for blanks**), then **Save comments**.
3. **Academics → Report cards:** choose the class and term, and fill in "Printed on every card".
   - **View** shows one child's card.
   - **Print** prints it.
   - **Print all … report cards** prints the class, one page per child.

**Sports training** (head of sports)
1. Once per programme: **Sports → Programmes → Add or remove athletes**. Tick the learners
   who train in it.
2. Each session: **Sports → Training attendance.** Choose the programme, tap **Present** or
   **Absent** for every athlete, and press **Save session** (it is refused while anyone is not marked).
3. **Sessions** names who missed each session. **Who attends training** shows each athlete's
   rate and the dates they missed.

**Record a payment and print the receipt** (bursar)
1. **Fees → Record payment.** Choose the class, then the child: their bill, what is paid and what
   they owe are shown.
2. Type the amount (it is written out in words as you type), how it was paid, the date and the
   Mobile Money or bank reference.
3. Press **Record payment**, then **Print receipt**. The same payment typed twice asks first.
- **Payments** lists every payment: search a name or receipt number; **Receipt** prints it again;
  **Reverse** cancels one entered by mistake (it needs a reason and stays in the list, crossed out).

**Who owes, and reminders**
1. **Fees → Fees dashboard → Who owes.** Choose a class: every child who owes is listed, largest
   first, with SMS and WhatsApp buttons.
2. **Text all N guardians in S.4** reminds that class only (online by SMS through the school's
   account; offline as a tap-to-send list). **Fees by class** shows which classes owe most.

**Bursaries:** **Fees → Bursaries**, choose the class and child, press **Change bursary**, type the
percentage and check the new bill before pressing **Save bursary**.

**Find, admit or correct a learner**
- **Students → All students:** choose a class, or search a name (any word order) or a guardian's
  number. "N owe fees" lists those who owe.
- **Admit a new learner** (the office: director, administrator or bursar): fill in the numbered groups and press **Admit student**; the same name in the
  same class asks first. **Import from Excel** skips learners already in the school.

**Discipline**
1. **Discipline.** Choose the class and child, then **what happened**: Good (commendation), A
   concern (verbal warning, counselling) or Serious (written warning, detention, suspension). How
   serious it is follows from that.
2. Set the date, write what the child did, and press **Save entry**.
3. The message for the guardian is shown, with the date: send it by SMS or WhatsApp.
- The log filters by class, good/concern/serious and term; the child's page counts their entries.

**Notices:** write the title and details, choose the kind (and, online, whether parents see it),
press **Post notice**. Whoever posted a notice, the director and the administrator can **Edit** or
**Delete** it.

**Reports and EMIS**
- **Reports → Statistics:** classes in school order with boys, girls, day, boarders, special needs,
  owing and in sports. Tap any number for the names. Warnings name learners with an unknown class
  or no gender set; fix them before EMIS.
- **Reports → EMIS:** the figures per class with a total row; **Download EMIS figures (Excel)**.

**Back up and restore** (offline edition)
- **Administration → Backup & restore → Back up now** downloads `<school>-backup-<date>.json`
  with every record, the staff accounts and "who did what". Keep it safe and private.
- **Restore from a backup** shows what is in the file first and asks whether to bring back the
  staff accounts. **Go back to a daily copy** undoes a mistake from the last 7 days on this device.

**Everything about one child:** tap their name anywhere (Students, registers, results, report
cards, sports) for their details, attendance, marks, fees, sports and discipline.

> The four seed accounts (`exec`, `admin`, `bursary`, `coach`) exist only to
> bootstrap the first sign-in. Change every password immediately and create
> named staff accounts under **Administration → Staff & who did what**.

---

## Files

```
school-portal/
├── index.html          Markup only (strict Content-Security-Policy)
├── styles.css          Institutional stylesheet (no external dependencies)
├── core.js             Shared helpers: formatting, icons, dialogs, printing (staff app and parent portal)
├── app.js              Core: learners, payments, sports, conduct, UI shell
├── billing.js          Terms, fee structures, bills, arrears, receipts, finance dashboard
├── academics.js        Grading scales, marks, class results, comments, report cards
├── register.js         Class register, who was absent, term sheet
├── learner.js          One page per learner: attendance, marks, fees, sports
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
- Sign-ins, password changes, staff changes, **payments, reversals, bursary
  awards, learner, conduct and notice changes, backups and restores** are
  written to "who did what" (Executive only), shown in plain words and Kampala time.

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
| `ksa_audit` | "Who did what" (last 500 events) |

The app requests **persistent storage** and reminds you to back up if it has
been more than a week. Recommended routine:

| When | Action |
|------|--------|
| Daily in term time | **Back up now** (top bar, Menu on a phone, or Administration → Backup & restore) |
| Weekly | Copy the backup to Google Drive / a flash disk |
| Before any reset or restore | Always back up first |

Move to another device with **Back up now** on one and **Restore from a backup** on
the other. The file (`<school>-backup-<date>.json`) holds every record, the staff
accounts (passwords only as salted hashes) and "who did what"; restore shows what is
in it first and asks whether to bring back the staff accounts. Keep it private.

The portal also keeps an automatic **daily snapshot** for the last 7 days on the
device (Administration → Backup & restore → *Go back to a daily copy*). It undoes
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
| Teacher sees no classes | Edit the teacher's account: set **Class teacher of** and the **subjects they teach** |
| A teacher cannot type in a subject | Its column is locked because it is not one of their subjects: add the subject to their account, or let its own teacher enter it |
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

**Version:** 3.7.0 · **License:** MIT — free for any school.
