/**
 * P0 safety: detect Baileys reconnect / history replay so downstream
 * auto-task pipelines do not treat buffered messages as live inbound.
 */

export type BackfillReason = 'age' | 'reconnect_window'

export type BackfillDecision = {
  isBackfill: boolean
  reason: BackfillReason | null
  ageSeconds: number
}

export const DEFAULT_BACKFILL_AGE_LIMIT_SECONDS = 900
export const RECONNECT_BACKFILL_WINDOW_MS = 60_000

/**
 * @param messageTimestampSec WhatsApp-supplied unix seconds (not receipt time)
 * @param nowMs               current wall clock
 * @param lastOpenAtMs        when connection.update → open last fired for this session
 * @param ageLimitSeconds     from wa_bot_config.backfill_age_limit_seconds (default 900)
 */
export function evaluateBackfill(opts: {
  messageTimestampSec: number
  nowMs?: number
  lastOpenAtMs: number | null
  ageLimitSeconds?: number
}): BackfillDecision {
  const nowMs = opts.nowMs ?? Date.now()
  const ageLimit = opts.ageLimitSeconds ?? DEFAULT_BACKFILL_AGE_LIMIT_SECONDS
  const msgMs = opts.messageTimestampSec * 1000
  const ageSeconds = Math.max(0, Math.floor((nowMs - msgMs) / 1000))

  // Reconnect replay window wins even when timestamps look fresh.
  if (
    opts.lastOpenAtMs != null &&
    nowMs - opts.lastOpenAtMs >= 0 &&
    nowMs - opts.lastOpenAtMs <= RECONNECT_BACKFILL_WINDOW_MS
  ) {
    return { isBackfill: true, reason: 'reconnect_window', ageSeconds }
  }

  if (ageSeconds > ageLimit) {
    return { isBackfill: true, reason: 'age', ageSeconds }
  }

  return { isBackfill: false, reason: null, ageSeconds }
}
