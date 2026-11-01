# TASK — סקירת שולחי התראות — רק נכסי אוטומטור

Run under the "Cowork task packages" protocol in this repo's AGENTS.md. Do not ask questions; hard stops only.

| | |
|---|---|
| Slug | `alert-senders-audit` |
| Dev task | `15e24bb1-2d82-457b-9b40-89328223a2bc` — "סקירת שולחי התראות — רק נכסי אוטומטור" (PR body line: `Task: jumpstart-task 15e24bb1-2d82-457b-9b40-89328223a2bc`) |
| Repo(s) | `jumpstartapp` (+ `jumpstart-whatsapp-service` / `otomator-admin` only if a violating sender lives there) (one PR per repo) |
| Branch | `fix/alert-senders-audit` from `origin/main` |
| Worktree | `C:\Users\Me\projects\jumpstart\.worktrees\alert-senders-audit` |
| Package | `C:\Users\Me\projects\jumpstart\_tasks\alert-senders-audit\` |
| Test environment | code read + unit tests; no sends |
| Test user | Nizan's own user in his own org (never switch orgs) |

Background (read once): post-mortem `otomator-dev/handouts/postmortem-sumit-event-checkout-he-2026-11-01.html`, plan `otomator-dev/handouts/postmortem-actions-plan-he-2026-11-01.html` (approved by Nizan 2026-11-01). Already shipped today: PR #3793 (SUMIT event checkout via beginredirect, `billing-payment` v290) and branch `fix/system-error-alerts` (system-error-notify: Otomator-only WhatsApp + email copy).

## Goal — what is true when this is done
Every place in the platform that sends a message to Nizan or Otomator staff is listed, and every one of them sends only from an Otomator asset with no fallback to another org's device. Violations are fixed in the PR; the list is in RESULT.

## In scope
- all Edge Functions / services that message Nizan/Otomator (system errors, WA session-down, monitor, support manager, signup notify, workforce alerts, finance alerts, etc.)
- settings they read (`WA_NOTIFY_ORG_ID`, `WA_NOTIFY_PHONE`, `ADMIN_PHONE`, `NIZAN_PHONE`, `WA_OTOMATOR_ORG_ID`, …)

## Out of scope (do not touch)
- customer-to-customer sends; template content; adding new channels

## Source of truth
- Look: no new screens (copy only where LOGIC says)
- Behaviour: `LOGIC.md`
- Forks: `DECISIONS.md`
- Done: `ACCEPTANCE.md`
- After merge: `RELEASE.md`

## Authorized now
Worktree, branch, commits, push, PR (open/update), branch preview builds, read-only production queries, SUMIT test-company calls that create a payment page (no charge).
Everything else is forbidden.

## Limits
- Never touch `src/lib/supabase.ts`, `src/store/authStore.ts`, `src/api/auth.ts`.
- No production migrations (DDL only via a migration file in the PR; the queue submit is in RELEASE.md), no Edge deploys, no merges, no real sends to customers, no real charges.
- Payments: SUMIT test company only (org "ניצן בדיקת טסט", `0bf51ed2-1b62-46c4-82b3-a9f36289b428`, SUMIT page title "אוטומטור - בדיקות מורשה"). Card tests use SUMIT test cards (help.sumit.co.il/he/articles/5832877). No real card, no refunds.
- HARD RULE (Nizan 2026-10-28): anything Otomator sends to Nizan/Otomator staff leaves only from Otomator assets (WhatsApp device of org `c3aa7a0d-461a-4ed4-882a-58bd063b1e62`, or the platform email sender). No fallback to any other org's device, ever. Never mix customers.
- Test contacts only in the test org, only WhatsApp 0528393669 / email nizan+parent@otomator.co.il.


## Definition of done
All Codex ACs pass with evidence · PR open with task line and `Release: manual` · `RESULT.md` written · `STATE.json` phase `ready_for_cowork`.
