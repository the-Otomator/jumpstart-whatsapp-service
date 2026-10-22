# TASK — wa_devices hot row: "last seen" written at most once per 30s per device

Run under COWORK-TASK-PACKAGE v1.1 (repo AGENTS.md) + skill `otomator-dev/skills/otomator-task-runner`. No questions; hard stops only.

| | |
|---|---|
| Slug | `wa-devices-hot-row` |
| Dev task | `38c6cb7f-29a6-42fe-9378-b7dd60fa159a` — PR line 1: `Task: jumpstart-task 38c6cb7f-29a6-42fe-9378-b7dd60fa159a` |
| Repos | `the-Otomator/jumpstart-whatsapp-service` (base `master`) + `the-Otomator/jumpstartapp` (base `main`, Edge `wa-webhook`). One PR per repo, `Release: manual` |
| Branch | `feature/wa-devices-hot-row` |
| Release | Night window (23:00–06:00 IL) after Cowork review. Off-window only with a new Nizan approval line. |

## Verified live 2026-10-23 00:30–00:45 IL (JumpStart DB dgxnnwnugdxzeopleera, read-only + logs)
- Baseline (24h before): PATCH /rest/v1/wa_devices ≈ 1,100/h from the WA service (`node`) + ≈ 700/h from Edge (`Deno`).
- 2026-10-22 18:49Z (21:49 IL): Baby Shiri org (8e93d62f…) device 48b99cee started a history backfill. Edge `wa-webhook` (fn 5f8557db, v255, last deployed 2026-10-21 18:56Z — no new deploy) jumped to ~1,500 invocations/min from one IP; function logs are `wa_backfill_persist` events. Each invocation did a GET + PATCH on wa_devices → ~88k PATCH/h.
- Effect: 20–26 PostgREST connections (of 41) continuously waiting on ShareLock (transactionid) for `UPDATE wa_devices SET last_seen_at…` / `webhook_audit_status…` — same row. 57/120 conns total; no customer-visible error observed.
- wa-webhook backfill calls stopped ~21:37Z; waiting locks 0 at 21:40Z. WA service (`node`) still PATCHing wa_devices ~1,000/min at 21:41Z (normal ≈ 20/min).
- Also seen every minute: `POST /rest/v1/rpc/wa_devices_heartbeat` → 400 (node) and a few `PATCH wa_devices` → 400 from both callers.

## Goal
A burst of WhatsApp events (history import, broadcast, reconnect storm) never turns one wa_devices row into a lock queue.

## Must be true
1. Per device, `last_seen_at` (and other liveness/audit fields such as `webhook_audit_status`) is written at most once per 30 seconds, from either caller (WA service and wa-webhook) — and only when the value actually changes otherwise. Backfill/history events never touch wa_devices liveness.
2. Status changes (connected/disconnected/etc.) are still written immediately — they are not throttled.
3. The DB write is skip-if-recent at the DB level too (e.g. conditional update), so two callers/instances cannot both write within the window.
4. The `wa_devices_heartbeat` 400s and the PATCH 400s are explained and fixed (or the dead call removed) — root cause in RESULT.
5. No change to message persistence, delivery, webhook auth, or device connection logic.

## Acceptance
- Staging/load test: replay 1,500 backfill events/min for one device for 5 min → ≤ 10 liveness writes for that device, 0 waiting locks, all messages persisted.
- Status change during the burst is written within 1 s.
- After night release: live readback — PATCH wa_devices rate back to baseline (≈ ≤ 50/min total), 0 heartbeat 400s over 30 min, no ungranted locks on wa_devices.
- RESULT.md + STATE.json in this package.

Never: customer sends, owner approvals, changing auto_reply_from, disconnecting or restarting any customer device, deleting messages.
