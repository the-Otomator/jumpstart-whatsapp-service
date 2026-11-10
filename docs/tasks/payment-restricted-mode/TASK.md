# TASK — Restricted mode on non-payment (7 grace days → 30 restricted days → suspension), default off until terms v2

Run under the "Cowork task packages" protocol in this repo's AGENTS file. Do not ask questions; hard stops only.

| | |
|---|---|
| Slug | `payment-restricted-mode` |
| Dev task | `26bbff7f-b12f-4e32-9f09-76884199eb69` — "מצב מוגבל באי־תשלום — 7 ימי חסד, 30 יום מוגבל, ואז השעיה (כבוי עד תנאי שימוש v2)" (PR body line: `Task: jumpstart-task 26bbff7f-b12f-4e32-9f09-76884199eb69`) |
| Repo(s) | `the-Otomator/jumpstartapp` (Hub + all team apps in it + Edge/DB). `jumpstart-clientportal` for public-page suspension, `jumpstart-whatsapp-service` for send-time hold (D8) — one PR per repo |
| Branch | `feature/payment-restricted-mode` from `origin/main` |
| Worktree | `C:\Users\Me\projects\jumpstart\.worktrees\payment-restricted-mode` (via `wt.ps1`) |
| Package | `C:\Users\Me\projects\jumpstart\_tasks\payment-restricted-mode\` |
| Test environment | Staging (separate DB) with enforcement go-live set **in Staging only**, on existing Staging test orgs (memory rule: no new orgs/users). Production stays off |
| Test user | Existing synthetic Staging accounts (owner + staff of one Staging test org) |

Source: terms v2 §4.7 (`otomator-dev/handouts/terms-update-proposal-v2-2026-11-10-he.html` lines 166–182). Nizan approved 2026-11-11.

## Goal — what is true when this is done
When a paying org's charge fails and stays unpaid: 7 days everything works (existing grace) → then up to 30 days **restricted**: incoming keeps flowing (leads, registrations, end-customer payments, incoming messages), the team can view and export, but no team action and nothing outgoing happens, in the Hub and every app → then **suspended**, including the org's public pages. Paying the full debt at any point restores everything immediately with all settings. Shipped switched off; it turns on together with terms v2.

## In scope
- Enforcement state: add the restricted phase between grace and blocked; suspension after it; immediate restore on full payment.
- Team surfaces (Hub + every app in jumpstartapp, desktop + mobile): restricted UI per DESIGN; blocked screen per DESIGN.
- Server-side stop of outgoing work for a restricted/suspended org (LOGIC rule 5).
- Public pages / client portal of a suspended org: unavailable page (DESIGN 4).
- Owner notifications at restricted start and 3 days before suspension (platform sender).

## Out of scope
- Turning it on in production (separate step with terms v2), data deletion after suspension, JumpStart Finance (separate product/billing), dunning/charging logic itself, otomator-admin screens, terms text.

## Source of truth
`DESIGN.html` · `LOGIC.md` · `DECISIONS.md` · `ACCEPTANCE.md` · `RELEASE.md`

## Authorized now
Worktree, branch, commits, push, PR(s), preview builds, migrations + Edge deploys **to Staging only**, Staging data changes on existing Staging test orgs to simulate failed charges, read-only production SQL.
Everything else is forbidden.

## Limits
- Production: no migration, no Edge deploy, no config change. `payment_restricted_mode_go_live_at` must stay absent in production; `payment_enforcement_go_live_at` untouched.
- Never block: incoming webhooks/forms/payment pages of end customers while restricted; platform (Otomator→customer) billing messages; super-admin support access.
- Fail open for orgs that are exempt today (trial, internal, demo, not paying, handled manually, free, no recurring) — no behaviour change for them.
- No customer real sends while testing.

## Definition of done
All Codex ACs pass with evidence · Staging previews show the design · PR(s) with task line · `RESULT.md` · `STATE.json` `ready_for_cowork`.
