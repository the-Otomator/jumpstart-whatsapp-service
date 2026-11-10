# FIX-02 — qa-dept-1-staging-twin (scoped WhatsApp send path)

Same task, same branch, PRs per repo. Continue the full package — not only WhatsApp (D-20).

## Decision (Nizan 2026-11-10)
D-18: scoped key in `jumpstart-whatsapp-service` (session allowlist + recipient allowlist + cap, enforced in the service, hashed, revocable, logged). One key: "אוטומטור ראשי" → `972528393669`. Staging holds only that key. D-19: deploy to wa-prod-1 authorized under the Off-window line, no customer session may disconnect (before/after connected-device count). D-20: a blocked channel never blocks the package.

## Must be true at the end
- Everything in TASK.md Goal + Codex ACs.
- New ACs for the WhatsApp service PR:
  - AC-WA-1: scoped key sending from another session → refused; to another number → refused; over cap → refused; revoked key → refused. Evidence: service logs/responses.
  - AC-WA-2: shared bearer and all existing routes behave exactly as before (existing tests green + one production read-only health check).
  - AC-WA-3: after deploy, connected-device count before = after; no customer session dropped.
  - AC-WA-4: one Staging send via the scoped key arrives on `972528393669` with `[QA · …]` prefix and provider id.

## Authorized now (in addition to TASK.md + FIX-01)
Branch/PR in `jumpstart-whatsapp-service`; deploy of that change to wa-prod-1 per D-19; creating the one scoped key and storing it as a Staging secret; refusal tests and one test send to Nizan.
