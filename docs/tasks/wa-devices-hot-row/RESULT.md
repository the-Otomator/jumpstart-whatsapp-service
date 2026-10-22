# WhatsApp device hot-row result

Status: VALIDATING — implementation and local load test complete; repository checks and PR publication in progress. No merge or release performed.

## Scope and routing
Executed locally in one isolated worktree per repository, branch feature/wa-devices-hot-row. Preserved dirty main checkouts. Service base c134ee9 (master); JumpStart base ee3d35112dd5 (main). Initial package-only commits: service 1dd74ed; JumpStart 6f97311a74ac.

## Implementation
A byte-identical bounded in-memory observer in both callers reserves a 30-second slot before awaiting. The DB is the cross-instance authority: a conditional update, nonblocking advisory lock and FOR UPDATE SKIP LOCKED share one liveness_written_at budget across liveness and audit writes. Actual status/phone/error changes bypass this budget; unchanged metadata is a no-op. History/backfill events skip both Edge liveness and service delivery audit persistence. Delivery, retry, auth and socket connection code are preserved.

## Root causes
The live wa_devices status constraint allows pending/connected/disconnected/revoked, but QR metadata writers and the batched heartbeat sent qr. A disposable-DB UPDATE reproduced SQLSTATE 23514. The migration maps legacy qr to pending while retaining the existing heartbeat signature; service heartbeat/reconciliation metadata now uses pending too. Per-delivery service audit PATCHes and pre-classification Edge heartbeat PATCHes caused the hot-row storm; those paths now use the gated RPC or skip history entirely. An unrelated monitor GET selects alerted_at, absent from the live column list; that GET issue is outside this PATCH/heartbeat task.

## Completed validation
- Service production TypeScript build: exit 0 (final behavioral implementation; subsequent comment/format and optional-phone guard preserved types).
- Edge regression tests: 29 passed, 0 failed, exit 0. Covers auth, exact session identity, ambiguous group quarantine, Meta isolation, listen-only persistence and pending senders. Fixed the existing async callback capture type in its test without changing assertions.
- PostgreSQL 17 disposable staging replay: 7,500 real-handler backfill events in 299,996 ms, all 7,500 persisted and marked backfill, exactly 10 liveness writes, 0 observed ungranted device locks (10 ms sampling), status persisted in 14 ms, 0 forbidden requests/customer sends/production requests. See load-result.json.
- Two observer instances plus 50 concurrent DB calls exercise shared budget; legacy heartbeat QR normalization and authenticated-role RPC denial checked. A separate due-window held-row-lock test returned false in 549 ms, exit 0; see lock-result.json.
- Migration safety guard: passed, exit 0. Other standard checks still running.

The load harness runs the actual Edge handler and message logger against a loopback PostgREST-compatible fixture backed by real PostgreSQL, with synthetic identities only. It does not claim full hosted staging/PostgREST deployment or customer acceptance. Added repeatable five-minute Linux CI replay. Service dispatcher regressions retain history delivery/retries while asserting zero audit persistence.

## Decisions I made
Shared nullable liveness_written_at is necessary to enforce one combined budget across processes. Audit failure counters count sampled intervals rather than every delivery. The new RPC and legacy heartbeat are service-role only, SECURITY INVOKER with empty search_path; no browser or RLS permissions expanded. Generated the migration with Supabase CLI as 20261022223629, then renamed before any apply to 20271129230300, after the current repository maximum 20271129230200.

## Release and limitations
STOP for Cowork review before either merge. Release: manual, in TASK.md's night window after review. Production migration, Edge deploy, service deployment and 30-minute live acceptance have not run. RELEASE.md records migration-first ordering and the no-restart boundary: the documented SSH restart disconnects sessions and is prohibited; a later release must use an established non-disruptive route or stop. No owner approval, customer device operation, message deletion, auto_reply_from change or customer send was performed.

## Pending
Full service test suite, JumpStart standard checks/build, both PRs and preview/CI readback.

המימוש ומבחן העומס המקומי הושלמו; בדיקות המאגרים עדיין רצות.
כל 7,500 ההודעות נשמרו, נמדדו 10 כתיבות חיות ואפס המתנות לנעילות.
אין מיזוג או שחרור לפני סקירת Cowork.
