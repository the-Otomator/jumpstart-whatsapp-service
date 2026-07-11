import type { HealthStatus, PoolHealthMetrics } from './types'
import { DEFAULT_WA_SENDER_RATE_CONFIG } from './rateConfig'

export function createInitialHealth(): PoolHealthMetrics {
  return {
    score: 100,
    status: 'green',
    deliverySuccesses: 0,
    deliveryFailures: 0,
    disconnects: 0,
    recipientBlocks: 0,
    consecutiveFailures: 0,
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

export function healthStatusFromScore(
  score: number,
  greenThreshold = DEFAULT_WA_SENDER_RATE_CONFIG.healthGreenThreshold
): HealthStatus {
  if (score >= greenThreshold) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}

export function applyHealthScore(
  health: PoolHealthMetrics,
  delta: number,
  greenThreshold = DEFAULT_WA_SENDER_RATE_CONFIG.healthGreenThreshold
): PoolHealthMetrics {
  const score = clampScore(health.score + delta)
  return {
    ...health,
    score,
    status: healthStatusFromScore(score, greenThreshold),
  }
}

export function recordDeliverySuccess(health: PoolHealthMetrics): PoolHealthMetrics {
  const next = applyHealthScore(
    {
      ...health,
      deliverySuccesses: health.deliverySuccesses + 1,
      consecutiveFailures: 0,
    },
    1
  )
  return next
}

export function recordDeliveryFailure(health: PoolHealthMetrics): PoolHealthMetrics {
  const consecutiveFailures = health.consecutiveFailures + 1
  return applyHealthScore(
    {
      ...health,
      deliveryFailures: health.deliveryFailures + 1,
      consecutiveFailures,
    },
    -8
  )
}

export function recordDisconnect(health: PoolHealthMetrics): PoolHealthMetrics {
  return applyHealthScore(
    {
      ...health,
      disconnects: health.disconnects + 1,
      consecutiveFailures: health.consecutiveFailures + 1,
    },
    -15
  )
}

export function recordRecipientBlock(health: PoolHealthMetrics): PoolHealthMetrics {
  return applyHealthScore(
    {
      ...health,
      recipientBlocks: health.recipientBlocks + 1,
      consecutiveFailures: health.consecutiveFailures + 1,
    },
    -25
  )
}

export function isRecipientBlockError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('block') ||
    lower.includes('not registered') ||
    lower.includes('forbidden') ||
    lower.includes('privacy')
  )
}
