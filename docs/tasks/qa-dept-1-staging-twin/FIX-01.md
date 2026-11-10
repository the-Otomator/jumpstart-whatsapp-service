# FIX-01 — qa-dept-1-staging-twin (resume after D-14 preflight stop)

Same task, same branch `feature/qa-dept-1-staging-twin`, same PR when created. Continue the full package.

## What changed
- **D-14 resolved** (DECISIONS.md): Staging WhatsApp sender = Otomator's own device "אוטומטור ראשי" (production `wa_devices` `0f16963a-94f4-4bdc-905f-b68b5ed365eb`, connected, baileys, organizational). Bind via the existing WhatsApp service; session reference stored only as a Staging secret/setting; destination forced to Nizan.
- **D-16**: push is not a blocker — fail-closed until Nizan subscribes; ask him for that one action in RESULT once the staging address is live.
- **D-17**: AC-07 = 2 hours in build; 24h report moves to release.
- Off-window line added to TASK.md (canonical format).

## Must be true at the end
Everything in TASK.md Goal and the Codex ACs in ACCEPTANCE.md, with WhatsApp, email and SMS delivered to Nizan only, and push recorded as "awaiting Nizan subscription" (not a failure).

## Authorized now (in addition to TASK.md)
Read-only production read of that one `wa_devices` row (and its session reference) to bind Staging; one test WhatsApp send from that device to `972528393669` only.
