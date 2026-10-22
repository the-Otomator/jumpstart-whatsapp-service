# WhatsApp device hot row — implementation handoff

Status: READY FOR COWORK REVIEW. Both PRs are open; no merge or production release was performed. A pre-existing repository guard failure is reproduced on the fetched base and remains visible below.

## Scope and routing
Executed locally on this computer, with one isolated worktree per repository and branch feature/wa-devices-hot-row. No agents-1 dispatch or Admin login was used. Dirty root checkouts and shared dependencies were preserved.

| Repository | Base | PR |
|---|---|---|
| jumpstart-whatsapp-service | master, c134ee9e2efa945393cbce23fe8fc43f22868d90 | https://github.com/the-Otomator/jumpstart-whatsapp-service/pull/88 |
| jumpstartapp | main, ee3d35112dd587f38ac0bb16710a791715411bbc | https://github.com/the-Otomator/jumpstartapp/pull/3583 |

Initial package-only commits: service 1dd74ed; JumpStart 6f97311a74ac. Implementation/checkpoint heads before reporting: service fa36dc28c082f46fe37a6174e6f6217dbac9de95; JumpStart 04ee4574c54e567dbff4eab030077fc157069787. STATE.json records PR and validation identities; final PR checks remain authoritative for later reporting commits.

## What changed
A byte-identical bounded observer in both callers reserves its 30-second slot before awaiting. A shared nullable DB column, liveness_written_at, enforces one combined budget across processes, Edge isolates and the legacy heartbeat. The conditional DB update uses a nonblocking advisory lock and FOR UPDATE SKIP LOCKED. Real status/phone/error changes bypass the liveness budget; unchanged metadata does not update the row. History/backfill events skip Edge liveness and service audit persistence. Delivery/retry/auth/socket logic is preserved, and the service no longer builds an unbounded per-device telemetry promise queue.

Service files: src/lib/waDeviceObservation.ts, waDeviceLiveness.ts, waDeviceWrite.ts, webhookHealth.ts, webhookDispatcher.ts, disconnectReason.ts and waDeviceReconcile.ts; focused observer/dispatcher/monitor tests; package.json test entry; feature CI workflow. The manifest preserves its original CRLF format, with only the additional test command changed.

JumpStart files: supabase/functions/_shared/waDeviceObservation.ts; wa-webhook/index.ts and index_test.ts; supabase/migrations/20271129230300_wa_devices_hot_row.sql; tests/wa-devices-hot-row/{schema.sql,load.ts,README.md,load-result.json}; feature CI workflow. Both branches carry this task package and evidence under docs/tasks/wa-devices-hot-row/.

## Root causes of the 400s and hot row
The live status CHECK accepts pending/connected/disconnected/revoked; QR metadata writers and the batched heartbeat sent qr. One invalid status could fail the whole heartbeat batch. A disposable-DB UPDATE reproduced SQLSTATE 23514, and the legacy RPC test proves normalization to pending. The migration retains the heartbeat signature and normalizes legacy QR callers; service heartbeat/reconciliation metadata also now uses pending. The in-memory socket state stays qr.

The write storm came from unconditional per-delivery service audit PATCHes and Edge heartbeat PATCHes before backfill classification. Those paths now use the gated observation RPC, or skip history completely. The audit category allowlist matches the live CHECK constraint. An unrelated monitor GET still selects alerted_at, absent from the live schema; this GET issue is outside the PATCH/heartbeat task and is not claimed fixed.

## Acceptance evidence
| Pre-release criterion | Result and evidence |
|---|---|
| Combined liveness/audit budget, history excluded | PASS — two callers share the DB gate; real history replay causes no direct device PATCH; service delivery/audit regressions pass. |
| Immediate status changes | PASS — synthetic status persisted in 14 ms locally and 4 ms in current-head Linux replay. |
| Cross-instance conditional DB protection | PASS — 50 concurrent calls admitted one write; due observation skipped a held row lock in 549 ms; advisory contention also skipped. |
| Heartbeat/PATCH 400 cause fixed | PASS in staging — constraint violation reproduced, legacy QR batch normalized; canonical metadata writes pass. Production error-rate acceptance is deferred. |
| Persistence, delivery, auth, connection behavior | PASS — all 7500 messages persisted; 29 Edge regressions and all 27 service test scripts passed. No customer device was involved. |
| 1500 backfill events/min for 5 min | PASS — local: 7500/7500 persisted, 299996 ms, 10 liveness writes, 0 sampled waiting locks. Linux repeat: 299965 ms, same counts. |
| Status during the burst <1 s | PASS — 14 ms local / 4 ms Linux, with DB readback. |
| Post-release 30-minute production checks | DEFERRED — no release before Cowork review. |

Local replay: load-result.json. Linux repeat: ci-load-result.json. Held-lock test: lock-result.json. Read-only production metadata/migration hash/base guard proof: schema-evidence.json. The migration SHA-256 is 59e2371e3715e0c1b72b3be1fa1f7d49fedea6cf37421e5097fabc182fb71115.

The load test runs the actual Edge handler and message logger with a loopback PostgREST-compatible fixture backed by PostgreSQL 17. It uses synthetic group messages and credentials, rejects unexpected outbound routes/direct device PATCHes, samples ungranted device locks every 10 ms, and never deletes messages. It is a focused local/Linux integration fixture, not a hosted Supabase/PostgREST deployment with the full production schema and triggers. No customer or authenticated production acceptance is inferred. The local fixture server is stopped; synthetic fixture data is retained under the package's own _task_tmp/postgres.

## Build, tests and guards
- Service: npm run build passed locally (exit 0) and in CI; npm test passed all 27 scripts in CI. The duplicate slow Windows full-suite run was intentionally interrupted after the complete CI pass. CI: https://github.com/the-Otomator/jumpstart-whatsapp-service/actions/runs/39869339253 . Final reporting/code heads are rechecked by the PR feature workflow.
- JumpStart: npm ci, npm run typecheck (6144 MB heap) and npm run build passed in CI. The duplicate slow local npm install was intentionally interrupted after CI installation succeeded. CI: https://github.com/the-Otomator/jumpstartapp/actions/runs/39869748404 . Build completed in 1m21s.
- Deno check of Edge source/load harness: exit 0 locally and CI. Deno tests for wa-webhook index/listen-only/metaInbox/pendingSender: 29 passed, 0 failed, exit 0. Fixed only the existing callback capture typing in the test; assertions were retained.
- Migration version uniqueness (677 files), migration safety, Supabase URL source guard, acting-org isolation, locale parity (26926 keys) and JWT pins (436 functions): all exit 0.
- Hebrew/design-token changed-file guards: exit 0, no changed files in their UI scope. No UI behavior/copy changed.
- git diff --check passed; branch diff/log contains only this task. Shared observer files are byte-identical.
- PRE-EXISTING FAILURE: check-org-status-active.mjs exits 1 at 20271108110000_groups_builder_v2.sql:135, excluding trial organizations. Re-ran the exact guard against scripts/migrations exported from fetched base ee3d35112dd5: same error and exit 1. No org-status code or historical migration was changed. This is not a green mandatory org-status guard, and no admin-code-check status was fabricated or approval pressed.

## Preview readback
Hub preview: https://86079618.jumpstart-hub.pages.dev — Cloudflare build succeeded at head 04ee4574c54e. HTTP HTML readback 200; entry JavaScript /assets/index-Dd3s0Mtx.js returned 200 with application/javascript. Both Hub and jumpstart-co-il preview builds succeeded. See preview-evidence.json. This is HTTP/build proof, not a screenshot, login, or customer acceptance. There are no UI acceptance criteria in this backend task and the service has no separate UI preview.

## Decisions I made
- One shared column is necessary to enforce the combined liveness/audit cap across both callers; process caches alone cannot do so. Audit failure counters represent sampled intervals rather than every message.
- New RPC: service-role-only SECURITY INVOKER, empty search_path. The legacy heartbeat had service-role-only execute grants; the same boundary is retained. Live service_role has SELECT/UPDATE and BYPASSRLS, so invoker execution preserves its existing access. No table RLS, auth gate or browser permission was loosened.
- Supabase CLI generated migration 20261022223629; renamed BEFORE any apply to 20271129230300, after the repository maximum 20271129230200. Both lock_timeout=3s and statement_timeout=60s are present.
- No direct production write SQL, migration submission, Edge deployment or service operation was attempted. Read-only schema/ACL/trigger diagnostics only.

## Release boundary and known limitations
STOP for Cowork review before either merge. Release: manual, in TASK.md's 23:00–06:00 IL window after review. RELEASE.md requires queue-only migration first, deployed-source reconciliation before Edge deployment, then a documented non-disruptive service route. The documented SSH process restart disconnects sessions and is prohibited by this package: if no non-disruptive route exists, the service release must stop at that boundary. Never self-approve any migration/release.

The post-release total PATCH rate approximately <=50/min, zero heartbeat 400s for 30 min, and zero ungranted device locks remain unexecuted acceptance checks. The pre-existing org-status guard remains a known check failure. No merge, production change, customer send, owner approval, auto_reply_from change, device restart/disconnection or message deletion occurred.

המימוש ובדיקות הבנייה, הטיפוסים והעומס הושלמו, ושני ה־PR פתוחים לסקירת Cowork.
כל 7,500 ההודעות נשמרו; נמדדו 10 כתיבות חיות, אפס המתנות לנעילות ושינוי סטטוס בתוך 14 מילישניות.
אין מיזוג או שחרור לפני הסקירה; כשל הבסיס הקיים ומגבלת האתחול מתועדים.
