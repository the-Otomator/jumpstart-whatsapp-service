# LOGIC — QA department (shared by qa-dept-1..4)

Live facts verified by Cowork 2026-11-10 (re-verify before relying on them):
- Staging project `jumpstart-staging` / `tyiylxtihzvxooecurwe` exists (PG 17.11). Orgs today: 3 synthetic twins `58000000-0000-4000-a000-00000000000{1,2,3}` (אוטומטור/תנועטף/בייבי שירי, seeded 2026-11-10), `Otomator (Staging)` `c3aa7a0d-461a-4ed4-882a-58bd063b1e62`, `QA · WhatsApp outage (paid)`, `QA · WhatsApp expired (unpaid)`.
- Staging has `public.outbox_freeze_holds` and `public.email_outbound_queue`; 156 cron definitions exist and were inactive at bootstrap (`_tasks/staging-db/RESULT.md`).
- Hub production = Cloudflare Pages `jumpstart-hub`, merge to `main` = production deploy (`otomator-dev/REPOS.md`). Per-PR previews already route to Staging and fail closed (`_tasks/staging-isolation-emergency-completion/RESULT.md`).
- Release machinery lives in otomator-admin (Otomator Supabase `mzalzjtsyrjycaxolldv`, `release_*` tables, `systems/admin/MAP.md`).
- Agent queue: `verify` jobs last 14 days = 27 succeeded / 11 failed / 65 cancelled; no agent role-login function exists in jumpstartapp.
- Browser tests today: `tests/acceptance/workforce-*-screens.spec.mjs` only.

## 1. Test branch
- Branch `staging` in jumpstartapp. Its deploy is a separate Cloudflare Pages environment at `staging.hub.jumpstart.co.il`, built with Staging config only. It must be impossible for the staging build to call production Supabase/Edge/Gesher/Meet/Admin (same fail-closed proof as the preview isolation).
- What lands on `staging`: every PR that is ready (standing merge order now targets `staging`, see D-01). `main` is updated only by promoting a QA-green `staging` SHA (or an emergency SHA that passed the critical suite).
- Banner on every staging page (DESIGN.html), not dismissible, not shown in production builds.

## 2. Sanitized production twin (nightly)
- Source: production JumpStart DB, read-only transactions only. Target: Staging.
- Scope: **every** production org, all application tables that hold org data.
- Kept as is: structure, IDs relationships, org/branch/license/app-install state, classes, events, memberships, sessions, prices, schedules, automations, templates, forms, landing pages, lead stages, billing history amounts/dates/statuses, document numbers.
- Replaced deterministically (same source value → same fake value every night, so tests are stable): person names → generated Hebrew names; phones → reserved test range that only the sink accepts; emails → `<hash>@example.test`; free-text fields that can contain personal data (notes, messages, chat history bodies, health declarations, addresses) → synthetic text of similar length; ID numbers / bank / card last digits → fake.
- Never copied: auth identities and passwords, card tokens, provider keys/sessions (SUMIT, WhatsApp, Meta, Google, email), vault values, private storage objects (documents, invoices PDFs, uploads).
- Public branding assets (org logos, landing images) may be copied so pages look real.
- Payments on Staging = test terminals only: SUMIT test company (`SUMIT_TEST_*`). A live terminal credential must be impossible to load on Staging (fail-closed).
- Refresh is idempotent; after each run a safety report is stored: counts per org, zero real phones/emails outside the allowlist, zero tokens, zero production hosts in function bodies/cron/settings.
- Existing non-twin Staging orgs and QA identities survive the refresh (D-06, D-07).

## 3. Real delivery to Nizan only (decided 2026-11-10)
- Messages on Staging are really sent — but every destination is rewritten to Nizan: WhatsApp/SMS → `972528393669`, email → `nizan+qa-<org-slug>@otomator.co.il`, push → Nizan's test device subscription. The original (fake) destination is kept in the delivery log.
- Every message body is prefixed `[QA · <org name>]` so he can tell it apart from real traffic.
- WhatsApp sender on Staging = Otomator's own device/session only. Never a customer's device (hard rule 2026-10-28, no cross-customer assets).
- Delivery log records: org, channel, automation/template, original destination, actual destination, rendered body, provider message id, delivery status (sent/delivered/read/failed), triggering source (QA run id or cron).
- Rewrite happens in one server-side place every channel passes through; if the rewrite cannot run, the message is refused (fail-closed). Any destination other than Nizan's = refused + logged.
- Volume: messages triggered by a QA run are always delivered. Background automations/crons on the twin are delivered only for the twins of Otomator, Tnuatef and Baby Shiri, capped at 100 per day per channel; all others are rendered into the log as `suppressed_volume` (still assertable by QA).
- Crons are turned on on Staging only after AC-05/AC-06 pass.

## 4. QA identities and login
- Per role, per QA org: owner, manager/staff, instructor, end customer (client portal), plus anonymous public visitor.
- Login: one-time link minted server-side, 10 min, single use, Staging only, refused on production (from the 2026-10-25 approved P1 design). Secret only on agents-1.
- Identities are synthetic (`@example.test`); Nizan's real users are never used or modified.

## 5. QA suites (real browser, against `staging.hub.jumpstart.co.il`)
Critical suite (≤10 min, required for every release incl. emergency):
- Login works for each role; end customer enters the portal and sees their bookings/invoices.
- Instructor: day screen loads, marks a child's attendance, it persists.
- Public visitor: class/trial/event signup with SUMIT test payment completes; record appears in the Hub.
- Membership member books an activity.
- One automation per channel fires into the sink with correct personalisation (e.g. birthday = child first name only).
- No console errors / failed network calls on these paths.
Full suite: critical + one journey folder per Hub app (CRM/leads, classes, events, memberships, billing documents, automations/outbox/resend, WhatsApp broadcast, coach, campaigner read-only, workforce, meet landing, finance-in-hub, settings/app install per license tier). Each journey asserts outcome in UI and in DB.
- Every run stores evidence: suite, SHA, per-journey pass/fail, duration, screenshots on failure, trace, sink entries asserted. Evidence readable from otomator-admin.
- Flaky test = fix or quarantine with a reason; a quarantined test never makes a run green on its own.
- Each journey asserts three layers: UI outcome, DB outcome, external outcome (message: provider id + delivered status to Nizan; payment: SUMIT test-terminal transaction read back from SUMIT).

## 5b. Proving QA itself works (QA of QA)
- **Bug library**: at least 10 known past bugs re-introduced on throwaway branches (e.g. birthday message with full name, twins/second child signup blocked, Baby Shiri membership charged half price, resend creates no message, child sharing parent phone rejected as payer, gift link asking for a card). The critical+full suite must catch every one. A missed bug = QA red ("QA לא תופס").
- **Canary**: once a week a deliberately broken build is pushed to staging automatically; QA must fail it and block promotion. Result shown in admin.
- **Coverage map**: every Hub app × role has at least one journey; the twin page shows apps/roles with no journey.
- **Heartbeat**: if the nightly twin refresh or nightly run did not happen, or a run took >2× its usual time → alert in the system-error channel.
- **Flake rate** per journey over 14 days shown; >5% → journey flagged.
- **Delivery reconciliation**: every message QA expected has a provider id and delivered status; every message that reached Nizan's phone has a QA run or cron source (no orphans).

## 6. Release gate
- Hub production (`main` / Cloudflare production) accepts only a SHA with `qa: green` from the full suite on staging, or `qa: green-critical` when the release is approved emergency.
- No path around the gate (night release, "למזג עכשיו", emergency button) may skip it; the gate is enforced by the release machinery, not by convention.
- Red QA → release stops, item shows "QA נכשל" with link to evidence; the failing PR is identified.
- 10 min after every production deploy: read-only production smoke as Nizan in org Otomator (logins render, portal login page, public signup page renders, no page errors). Fail → incident in release ops + alert via existing system-error channel.

## 7. Permissions / wall
- Nothing in the staging build, sink, sanitizer or QA login is reachable from production.
- QA identities have rights only inside their Staging orgs.
