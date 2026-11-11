# DECISIONS — payment-restricted-mode

## Settled
| # | Decision | Date / source |
|---|---|---|
| D1 | Restricted mode (not read-only, not free plan) per terms v2 §4.7: 7 grace days → up to 30 restricted days (charged as usual) → suspension incl. public pages; data kept 60 days | Nizan, 2026-11-11 ("מעולה") |
| D2 | Enforcement depth: UI locks + server-side stop of everything outgoing (sends, automations, broadcasts, documents, AI). Not a full server-side write block on every table | Nizan, 2026-11-11 |
| D3 | Applies to the whole org across Hub and all apps, triggered by any unpaid paid charge (subscription or app license) | Nizan, 2026-11-11 ("הכל, אחרת הוא יעבוד באפליקציות") |
| D4 | Ships off; goes live with terms v2 (production `payment_restricted_mode_go_live_at` stays absent) | Nizan, 2026-11-11 |
| D5 | Reminders/messages to the org's end customers stop too (they are sends); SUMIT receipts for end-customer payments continue (legal, issued by SUMIT) | Nizan informed 2026-11-11; receipts: Cowork |
| D6 | Held messages are not lost: resume after payment if still valid, else skipped with reason `restricted` | Cowork, 2026-11-11 |

## Pre-answered forks
| If you find… | Do this |
|---|---|
| Existing enforcement state/function/hooks | Extend them (add `restricted`); do not build a parallel mechanism |
| The trial read-only UI mechanism can express "disabled controls" | Reuse it for restricted; one mechanism for both |
| A send path you can't route through one guard | Guard it at its own entry; list every guarded path in RESULT with file:line |
| A new status/reason value needs a CHECK change | Migration on Staging only; production migration goes to RELEASE (queue) |
| Public pages are served by jumpstart-clientportal | Second PR in that repo for DESIGN 4; same task line |
| An org is in debt on an app license but its main subscription is exempt (trial/internal/etc.) | Exempt wins (no restriction) and log it in RESULT |
| Restricted org has scheduled automations/broadcasts | Hold per D6; do not delete or disable their configuration |
| Staging test orgs lack billing runs | Create failed `customer_billing_runs` rows on existing Staging test orgs only; restore after |
| main fails a check | Prove on main, note, continue |

## Default rule
Keep DESIGN/LOGIC → reversible → least outside scope → log in RESULT "Decisions I made".

## Hard stops
- Any production migration/Edge deploy/config change; setting go-live in production.
- Anything that would block incoming end-customer data or payments, or send to a real customer.
- Loosening RLS/permissions.

| If you find… (cont.) | Do this |
|---|---|
| Staging has no SUMIT sandbox for the end-customer payment in AC-06 | Prove the registration + form paths, prove the payment page loads and its server path isn't guarded; record "payment completion not run" — not a hard stop |

## Answer to the round-0 hard stop (Cowork, 2026-11-11)
**D7 — separate switch for the restricted phase (Codex's recommendation, accepted).** New setting `payment_restricted_mode_go_live_at` (system_config allowlisted key, migration in Staging now, production via RELEASE queue without a value). Absent = today's live behaviour unchanged. Staging: set it to enable testing. Production: stays absent until terms v2. Cowork's earlier fact "enforcement off" was wrong and is corrected in LOGIC.
New AC-11 (Codex, Staging): with the new switch absent, an unpaid org goes grace → blocked exactly as today (no restricted, public pages unchanged); with it set, grace → restricted → blocked.

## Answer to the round-1 block (Cowork, 2026-11-11)
**D8 — scope extended to `the-Otomator/jumpstart-whatsapp-service` (option A).** Separate PR, same task line, branch `feature/payment-restricted-mode`, worktree `C:\Users\Me\projects\jumpstart-whatsapp-service\.worktrees\payment-restricted-mode`.
Must be true in the service:
- Every provider send path (queued pool jobs `src/pool/senderPool.ts`, direct paths incl. `src/routes/groups.ts`) asks the same org enforcement decision as JumpStart before sending.
- Org `restricted`/`blocked` → the job is **kept** (not removed, not failed): re-checked on a backoff; after full payment it sends if still valid under its existing rules, else it's marked skipped with reason `restricted` back in JumpStart's outbox/history (D6).
- The existing `listen_only` device policy keeps its current behaviour; the billing hold is separate from it.
- Enforcement check unreachable/error → **send as today** (fail open; one org's debt check must never stop all customers' messaging) and log it.
- Incoming messages/webhooks unaffected.
- Switch: the service follows JumpStart's decision, so with `payment_restricted_mode_go_live_at` absent nothing changes.
Verification: there is no Staging WhatsApp instance. Prove with the service's tests + a local run against the Staging DB with the provider mocked (no real WhatsApp session, no real sends). Production deploy of the service is a RELEASE step that needs Nizan's explicit OK (WA infra = Nizan's ops).

**Standing limit for this task (all rounds):** no worktree sweep / cleanup runs. Leave other worktrees alone; list anything odd in RESULT.
