/**
 * msgRetryCounterCache cap behaviour.
 * Run: npx ts-node --transpile-only src/lib/msgRetryCache.test.ts
 */
import {
  MSG_RETRY_MAX_COUNT,
  MsgRetryCounterCache,
  wouldAllowRetry,
} from './msgRetryCache'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const cache = new MsgRetryCounterCache(60_000)
  const key = 'retry:msg-1'

  for (let i = 1; i <= MSG_RETRY_MAX_COUNT; i++) {
    assert(
      wouldAllowRetry(cache, key, MSG_RETRY_MAX_COUNT) === true,
      `attempt ${i} should be allowed`
    )
  }

  // Next attempt hits the cap and is rejected (Baileys then clears the entry).
  assert(
    wouldAllowRetry(cache, key, MSG_RETRY_MAX_COUNT) === false,
    'attempt after cap must be rejected'
  )
  assert(cache.get<number>(key) === undefined, 'cache cleared after cap')

  // A different message key can still retry.
  assert(wouldAllowRetry(cache, 'retry:msg-2', MSG_RETRY_MAX_COUNT) === true, 'new key allowed')

  console.log('msgRetryCache.test.ts: OK')
}

main()
