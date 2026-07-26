/**
 * P0 backfill guard tests.
 * Run: npx ts-node --transpile-only src/lib/backfillGuard.test.ts
 */
import {
  DEFAULT_BACKFILL_AGE_LIMIT_SECONDS,
  evaluateBackfill,
} from './backfillGuard'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const nowMs = Date.parse('2026-07-26T12:00:00.000Z')

  // Old-timestamp message → backfill by age, still would be persisted by caller
  {
    const oldTs = Math.floor((nowMs - (DEFAULT_BACKFILL_AGE_LIMIT_SECONDS + 60) * 1000) / 1000)
    const d = evaluateBackfill({
      messageTimestampSec: oldTs,
      nowMs,
      lastOpenAtMs: null,
    })
    assert(d.isBackfill === true, 'old message is backfill')
    assert(d.reason === 'age', 'reason is age')
    assert(d.ageSeconds > DEFAULT_BACKFILL_AGE_LIMIT_SECONDS, 'age exceeds limit')
  }

  // Fresh message outside reconnect window → not backfill
  {
    const freshTs = Math.floor((nowMs - 5_000) / 1000)
    const d = evaluateBackfill({
      messageTimestampSec: freshTs,
      nowMs,
      lastOpenAtMs: nowMs - 120_000,
    })
    assert(d.isBackfill === false, 'fresh message not backfill')
    assert(d.reason === null, 'no reason')
  }

  // Fresh-timestamp message 10s after open → reconnect_window
  {
    const freshTs = Math.floor((nowMs - 2_000) / 1000)
    const d = evaluateBackfill({
      messageTimestampSec: freshTs,
      nowMs,
      lastOpenAtMs: nowMs - 10_000,
    })
    assert(d.isBackfill === true, 'reconnect window marks backfill')
    assert(d.reason === 'reconnect_window', 'reason is reconnect_window')
  }

  // Age takes effect when not in reconnect window
  {
    const oldTs = Math.floor((nowMs - 2_000_000) / 1000)
    const d = evaluateBackfill({
      messageTimestampSec: oldTs,
      nowMs,
      lastOpenAtMs: nowMs - 120_000,
      ageLimitSeconds: 900,
    })
    assert(d.isBackfill === true && d.reason === 'age', 'age reason outside reconnect')
  }

  console.log('backfillGuard.test.ts: all assertions passed')
}

main()
