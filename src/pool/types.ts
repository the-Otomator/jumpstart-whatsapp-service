import type { SendMessageRequest } from '../types'

export type MessageLane = 'operational' | 'marketing'

export type HealthStatus = 'green' | 'yellow' | 'red'

export interface WaSenderRateConfig {
  /** Max marketing messages per rolling minute */
  perMinute: number
  /** Max marketing messages per rolling hour */
  perHour: number
  /** Max marketing messages per calendar day when fully warmed */
  perDayWarmed: number
  /** Daily caps during warm-up stages (days 0–6, 7–13, 14–20, 21+) */
  warmupDailyCaps: [number, number, number, number]
  /** Days per warm-up stage before advancing (only when health is green) */
  warmupStageDays: number
  /** Random delay between marketing sends (seconds) */
  jitterMinSec: number
  jitterMaxSec: number
  /** Consecutive send failures before emergency brake */
  maxConsecutiveFailures: number
  /** Health score threshold for green status / warm-up advance */
  healthGreenThreshold: number
}

export interface PoolHealthMetrics {
  score: number
  status: HealthStatus
  deliverySuccesses: number
  deliveryFailures: number
  disconnects: number
  recipientBlocks: number
  consecutiveFailures: number
}

export interface PoolPersistedState {
  orgId: string
  phoneNumber?: string
  warmupStage: 0 | 1 | 2 | 3
  warmupStartedAt: string
  lastStageAdvanceAt?: string
  paused: boolean
  pauseReason?: string
  health: PoolHealthMetrics
  marketingSentDayKey: string
  marketingSentToday: number
  marketingSentTimestamps: number[]
  lastMarketingSendAt?: number
  createdAt: string
  updatedAt: string
}

export interface QueuedJob {
  id: string
  req: SendMessageRequest
  lane: MessageLane
  enqueuedAt: number
  resolve: (messageId: string) => void
  reject: (err: Error) => void
}

export interface CapacityEstimateRequest {
  orgId: string
  recipientCount: number
  lane?: MessageLane
}

export interface CapacityEstimateResponse {
  orgId: string
  recipientCount: number
  lane: MessageLane
  availableRate: {
    perMinute: number
    perHour: number
    perDay: number
    warmupStage: number
    healthStatus: HealthStatus
    poolPaused: boolean
  }
  estimatedDurationMinutes: number
  estimatedFinishAt: string
  exceedsDailyCap: boolean
  daysRequired: number
  summary: string
}

export interface PoolStatusResponse {
  orgId: string
  phoneNumber?: string
  paused: boolean
  pauseReason?: string
  warmupStage: number
  dailyCap: number
  marketingSentToday: number
  queueDepth: { operational: number; marketing: number }
  health: PoolHealthMetrics
  rateConfig: WaSenderRateConfig
}
