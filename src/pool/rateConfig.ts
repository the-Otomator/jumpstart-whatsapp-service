import type { WaSenderRateConfig } from './types'

/** Locked P2b defaults — wa_sender_rate_config per device/session */
export const DEFAULT_WA_SENDER_RATE_CONFIG: WaSenderRateConfig = {
  perMinute: 8,
  perHour: 60,
  perDayWarmed: 250,
  warmupDailyCaps: [20, 50, 100, 250],
  warmupStageDays: 7,
  jitterMinSec: 20,
  jitterMaxSec: 90,
  maxConsecutiveFailures: 3,
  healthGreenThreshold: 70,
}

export function dailyCapForStage(config: WaSenderRateConfig, stage: 0 | 1 | 2 | 3): number {
  return config.warmupDailyCaps[stage]
}

export function effectiveDailyCap(config: WaSenderRateConfig, stage: 0 | 1 | 2 | 3): number {
  return Math.min(dailyCapForStage(config, stage), config.perDayWarmed)
}
