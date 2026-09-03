# Operational lane gap — result

## Outcome

Implemented and opened [PR #60](https://github.com/the-Otomator/jumpstart-whatsapp-service/pull/60) from `feature/operational-lane-gap` into `master`.

Operational messages now use a fresh per-message random gap of 3–8 seconds between consecutive successful sends for the same org sender. The first message has no artificial delay, and a queued message sends immediately when its sampled gap has already elapsed during an idle period.

## Routing and scope

- Executed locally in the isolated worktree `C:\Users\Me\projects\jumpstart-whatsapp-service-wt\operational-lane-gap` because the root checkout contained unrelated work and was on another feature branch.
- Branched from freshly fetched `origin/master` at `46a13afd064a1d3ca40dc984530c9835b76f8f47`.
- Changed only the WhatsApp microservice repository. No files in `C:\Users\Me\projects\jumpstart` were edited.

## Implementation

- Added `operationalJitterMinSec: 3` and `operationalJitterMaxSec: 8` to `WaSenderRateConfig` and `DEFAULT_WA_SENDER_RATE_CONFIG`.
- Each operational queued job samples one config-driven gap when it is enqueued. `SenderPool.processQueue()` checks the remaining gap before sending, requeues the operational job at the front, and sleeps in bounded chunks until it is eligible.
- Added persisted `lastOperationalSendAt`, updated only after a successful operational send. Marketing continues to use its separate `lastMarketingSendAt`, timestamp counters, and cap checks.
- `getStatus()` / `pool-status` now returns `operationalSpacing` with `minGapSec`, `maxGapSec`, `lastSendAt`, and `nextSendInMs`; the existing per-lane queue depths remain visible.
- `pickNextJob()` is unchanged: operational jobs still preempt marketing jobs. No hourly, daily, or warm-up cap is applied to operational traffic.
- Marketing jitter remains 20–90 seconds and its per-minute, per-hour, daily, and warm-up behavior is unchanged.

## Files changed

- `src/pool/types.ts`
- `src/pool/rateConfig.ts`
- `src/pool/senderPool.ts`
- `src/pool/senderPool.operational-gap.test.ts`
- `package.json`
- `docs/tasks/operational-lane-gap-result.md`

## Validation

- `npx ts-node --transpile-only src/pool/senderPool.operational-gap.test.ts` — PASS.
  - Fake clock and injected sender; no real pacing sleep.
  - Verified all consecutive operational gaps are within 3–8 seconds and vary across messages.
  - Verified the post-idle operational send is immediate.
  - Verified operational preempts marketing when both queues are populated.
  - Verified operational sends do not consume marketing counters and the existing marketing jitter/cap configuration is unchanged.
  - A 21-message operational batch completed in **107,985 ms (107.985 simulated seconds)**, within the required 60–170 second range.
- `npm run build` — PASS.
- `npm test` — PASS (full existing suite plus the new test).
- `git diff --check` — PASS.

The test run logged expected warnings that Supabase environment variables were not configured; the suite completed successfully without credentials.

## Authorization boundaries and follow-up

- Not performed because they were not authorized: merge, deployment to `wa-prod-1` / `wa.otomator.pro`, production container restart, and production sends.
- Follow-up only: JumpStart's class-journey backfill still has its own 5-per-3s throttle. It is now redundant and more aggressive than the pool policy, but was intentionally not changed because the `jumpstart` repository is outside this task's scope.
