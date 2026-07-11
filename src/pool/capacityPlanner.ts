import type { CapacityEstimateRequest, CapacityEstimateResponse, PoolPersistedState } from './types'
import { DEFAULT_WA_SENDER_RATE_CONFIG, effectiveDailyCap } from './rateConfig'

const AVG_JITTER_SEC =
  (DEFAULT_WA_SENDER_RATE_CONFIG.jitterMinSec + DEFAULT_WA_SENDER_RATE_CONFIG.jitterMaxSec) / 2

function rollingCount(timestamps: number[], windowMs: number, now = Date.now()): number {
  const cutoff = now - windowMs
  return timestamps.filter((t) => t >= cutoff).length
}

function remainingInWindow(limit: number, timestamps: number[], windowMs: number, now = Date.now()): number {
  const used = rollingCount(timestamps, windowMs, now)
  return Math.max(0, limit - used)
}

export function computeAvailableMarketingRate(
  state: PoolPersistedState,
  now = Date.now()
): { perMinute: number; perHour: number; perDay: number } {
  const config = DEFAULT_WA_SENDER_RATE_CONFIG
  const dailyCap = effectiveDailyCap(config, state.warmupStage)
  const dayRemaining = Math.max(0, dailyCap - state.marketingSentToday)
  const minuteRemaining = remainingInWindow(config.perMinute, state.marketingSentTimestamps, 60_000, now)
  const hourRemaining = remainingInWindow(config.perHour, state.marketingSentTimestamps, 3_600_000, now)

  return {
    perMinute: minuteRemaining,
    perHour: hourRemaining,
    perDay: dayRemaining,
  }
}

function effectiveSendsPerMinute(available: { perMinute: number; perHour: number; perDay: number }): number {
  const perHourAsPerMin = available.perHour / 60
  const perDayAsPerMin = available.perDay / (24 * 60)
  const jitterLimited = 60 / AVG_JITTER_SEC
  return Math.max(0, Math.min(available.perMinute, perHourAsPerMin, perDayAsPerMin, jitterLimited))
}

export function estimateCapacity(
  state: PoolPersistedState,
  req: CapacityEstimateRequest
): CapacityEstimateResponse {
  const lane = req.lane ?? 'marketing'
  const recipientCount = Math.max(0, Math.floor(req.recipientCount))
  const now = Date.now()

  if (lane === 'operational') {
    const perMinute = 30
    const durationMinutes = recipientCount === 0 ? 0 : Math.ceil(recipientCount / perMinute)
    const finishAt = new Date(now + durationMinutes * 60_000).toISOString()
    return {
      orgId: req.orgId,
      recipientCount,
      lane,
      availableRate: {
        perMinute,
        perHour: perMinute * 60,
        perDay: perMinute * 60 * 24,
        warmupStage: state.warmupStage,
        healthStatus: state.health.status,
        poolPaused: state.paused,
      },
      estimatedDurationMinutes: durationMinutes,
      estimatedFinishAt: finishAt,
      exceedsDailyCap: false,
      daysRequired: 1,
      summary:
        recipientCount === 0
          ? 'No recipients to send.'
          : `≈${durationMinutes} minutes, finishes at ${formatLocalHint(finishAt)} (operational lane)`,
    }
  }

  const available = computeAvailableMarketingRate(state, now)
  const dailyCap = effectiveDailyCap(DEFAULT_WA_SENDER_RATE_CONFIG, state.warmupStage)
  const ratePerMin = effectiveSendsPerMinute(available)

  if (state.paused) {
    return {
      orgId: req.orgId,
      recipientCount,
      lane,
      availableRate: {
        perMinute: 0,
        perHour: 0,
        perDay: 0,
        warmupStage: state.warmupStage,
        healthStatus: state.health.status,
        poolPaused: true,
      },
      estimatedDurationMinutes: 0,
      estimatedFinishAt: new Date(now).toISOString(),
      exceedsDailyCap: recipientCount > dailyCap,
      daysRequired: recipientCount === 0 ? 0 : Math.ceil(recipientCount / dailyCap),
      summary: `Pool paused (${state.pauseReason ?? 'emergency brake'}). Cannot estimate send window until resumed.`,
    }
  }

  if (recipientCount === 0) {
    return {
      orgId: req.orgId,
      recipientCount: 0,
      lane,
      availableRate: {
        perMinute: available.perMinute,
        perHour: available.perHour,
        perDay: available.perDay,
        warmupStage: state.warmupStage,
        healthStatus: state.health.status,
        poolPaused: false,
      },
      estimatedDurationMinutes: 0,
      estimatedFinishAt: new Date(now).toISOString(),
      exceedsDailyCap: false,
      daysRequired: 0,
      summary: 'No recipients to send.',
    }
  }

  const daysRequired = Math.max(1, Math.ceil(recipientCount / dailyCap))
  const exceedsDailyCap = recipientCount > available.perDay

  let durationMinutes: number
  if (ratePerMin <= 0) {
    durationMinutes = Math.ceil((recipientCount * AVG_JITTER_SEC) / 60)
  } else {
    durationMinutes = Math.ceil(recipientCount / ratePerMin)
  }

  const finishAt = new Date(now + durationMinutes * 60_000).toISOString()

  let summary: string
  if (exceedsDailyCap) {
    summary = `≈${formatDuration(durationMinutes)}, exceeds daily cap (${dailyCap}/day), spreads across ${daysRequired} day(s); first batch finishes ~${formatLocalHint(finishAt)}`
  } else {
    summary = `≈${formatDuration(durationMinutes)}, finishes at ${formatLocalHint(finishAt)}`
  }

  return {
    orgId: req.orgId,
    recipientCount,
    lane,
    availableRate: {
      perMinute: available.perMinute,
      perHour: available.perHour,
      perDay: available.perDay,
      warmupStage: state.warmupStage,
      healthStatus: state.health.status,
      poolPaused: false,
    },
    estimatedDurationMinutes: durationMinutes,
    estimatedFinishAt: finishAt,
    exceedsDailyCap,
    daysRequired,
    summary,
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatLocalHint(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })
  } catch {
    return iso
  }
}
