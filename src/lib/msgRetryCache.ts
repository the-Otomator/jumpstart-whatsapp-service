/**
 * In-process CacheStore for Baileys msgRetryCounterCache.
 * Caps how many times Baileys will retry a single failed message.
 *
 * Default maxMsgRetryCount in Baileys 6.7.x is 5 — we mirror that here so the
 * cache and socket config stay aligned. Entries expire after 1 hour (Baileys MSG_RETRY TTL).
 */

/** Matches Baileys CacheStore (lib/Types/Socket.d.ts) — kept local to avoid deep imports. */
export interface CacheStore {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
  del(key: string): void
  flushAll(): void
}

/** Align with Baileys Defaults.maxMsgRetryCount (6.7.x). */
export const MSG_RETRY_MAX_COUNT = 5
/** Align with Baileys DEFAULT_CACHE_TTLS.MSG_RETRY (1 hour). */
export const MSG_RETRY_TTL_MS = 60 * 60 * 1000

interface CacheEntry {
  value: number
  expiresAt: number
}

export class MsgRetryCounterCache implements CacheStore {
  private readonly map = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  constructor(ttlMs = MSG_RETRY_TTL_MS) {
    this.ttlMs = ttlMs
  }

  get<T>(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, {
      value: value as unknown as number,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  del(key: string): void {
    this.map.delete(key)
  }

  flushAll(): void {
    this.map.clear()
  }

  /** Test/inspection: current live entry count. */
  size(): number {
    this.prune()
    return this.map.size
  }

  private prune(): void {
    const now = Date.now()
    for (const [k, v] of this.map) {
      if (now > v.expiresAt) this.map.delete(k)
    }
  }
}

/**
 * Simulate Baileys retry-limit logic: increment until maxMsgRetryCount, then stop.
 * Returns whether another retry is allowed after this increment.
 */
export function wouldAllowRetry(
  cache: CacheStore,
  key: string,
  maxCount = MSG_RETRY_MAX_COUNT
): boolean {
  const current = (cache.get<number>(key) as number | undefined) ?? 0
  if (current >= maxCount) {
    cache.del(key)
    return false
  }
  cache.set(key, current + 1)
  return true
}
