import { randomUUID } from 'crypto'
import { orgLogger } from '../lib/logger'
import { loadSessionMeta } from '../lib/sessionStore'
import { postWebhook } from '../lib/webhookDispatcher'
import { sendWhatsAppMessageDirect } from '../lib/sendDirect'
import { WA_ENQUEUE_CEILING_MS, WA_SEND_TIMEOUT_MS, withTimeout } from '../lib/withTimeout'
import { getProviderForOrg } from '../providers'
import type { SendMessageRequest } from '../types'
import { estimateCapacity } from './capacityPlanner'
import {
  isRecipientBlockError,
  recordDeliveryFailure,
  recordDeliverySuccess,
  recordDisconnect,
  recordRecipientBlock,
} from './healthScore'
import {
  createDefaultPoolState,
  loadPoolState,
  resetMarketingDayIfNeeded,
  savePoolState,
} from './poolStore'
import { DEFAULT_WA_SENDER_RATE_CONFIG, effectiveDailyCap } from './rateConfig'
import type {
  CapacityEstimateRequest,
  CapacityEstimateResponse,
  MessageLane,
  PoolPersistedState,
  PoolStatusResponse,
  QueuedJob,
} from './types'

const pools = new Map<string, SenderPool>()

export function getSenderPool(orgId: string): SenderPool {
  let pool = pools.get(orgId)
  if (!pool) {
    pool = new SenderPool(orgId)
    pools.set(orgId, pool)
  }
  return pool
}

export class SenderPool {
  readonly orgId: string
  private state: PoolPersistedState
  private operationalQueue: QueuedJob[] = []
  private marketingQueue: QueuedJob[] = []
  private processing = false
  private processorTimer: ReturnType<typeof setTimeout> | null = null

  constructor(orgId: string) {
    this.orgId = orgId
    this.state = resetMarketingDayIfNeeded(loadPoolState(orgId))
    this.maybeAdvanceWarmup()
    savePoolState(this.state)
  }

  getStatus(): PoolStatusResponse {
    this.state = resetMarketingDayIfNeeded(this.state)
    const dailyCap = effectiveDailyCap(DEFAULT_WA_SENDER_RATE_CONFIG, this.state.warmupStage)
    return {
      orgId: this.orgId,
      phoneNumber: this.state.phoneNumber,
      paused: this.state.paused,
      pauseReason: this.state.pauseReason,
      warmupStage: this.state.warmupStage,
      dailyCap,
      marketingSentToday: this.state.marketingSentToday,
      queueDepth: {
        operational: this.operationalQueue.length,
        marketing: this.marketingQueue.length,
      },
      health: { ...this.state.health },
      rateConfig: { ...DEFAULT_WA_SENDER_RATE_CONFIG },
    }
  }

  estimateCapacity(req: CapacityEstimateRequest): CapacityEstimateResponse {
    this.state = resetMarketingDayIfNeeded(this.state)
    return estimateCapacity(this.state, req)
  }

  enqueueAndWait(req: SendMessageRequest, lane: MessageLane = req.lane ?? 'operational'): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false
      const settleResolve = (id: string) => {
        if (settled) return
        settled = true
        clearTimeout(ceilingTimer)
        resolve(id)
      }
      const settleReject = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(ceilingTimer)
        reject(err)
      }

      const job: QueuedJob = {
        id: randomUUID(),
        req,
        lane,
        enqueuedAt: Date.now(),
        resolve: settleResolve,
        reject: settleReject,
      }

      const ceilingTimer = setTimeout(() => {
        this.removeQueuedJob(job.id, lane)
        orgLogger(this.orgId).warn(
          { jobId: job.id, ceilingMs: WA_ENQUEUE_CEILING_MS },
          'enqueueAndWait ceiling exceeded — rejecting with send_timeout'
        )
        settleReject(new Error('send_timeout'))
      }, WA_ENQUEUE_CEILING_MS)

      if (lane === 'operational') {
        this.operationalQueue.push(job)
      } else {
        this.marketingQueue.push(job)
      }

      this.scheduleProcess()
    })
  }

  enqueue(req: SendMessageRequest, lane: MessageLane = 'marketing'): string {
    const jobId = randomUUID()
    const job: QueuedJob = {
      id: jobId,
      req,
      lane,
      enqueuedAt: Date.now(),
      resolve: () => {},
      reject: () => {},
    }
    this.marketingQueue.push(job)
    this.scheduleProcess()
    return jobId
  }

  onSessionConnected(phoneNumber?: string): void {
    const log = orgLogger(this.orgId)
    this.state = resetMarketingDayIfNeeded(loadPoolState(this.orgId))
    if (phoneNumber) this.state.phoneNumber = phoneNumber
    if (!this.state.warmupStartedAt) {
      this.state.warmupStartedAt = new Date().toISOString()
    }
    savePoolState(this.state)
    log.info({ phoneNumber, warmupStage: this.state.warmupStage }, 'Sender pool bound to session')
    // Reconnect must clear disconnect/emergency pause; otherwise the lane stays
    // paused forever and queue jobs never reach the worker (hang → client 504).
    this.resume()
  }

  onSessionDisconnected(reason?: string): void {
    const log = orgLogger(this.orgId)
    this.state.health = recordDisconnect(this.state.health)
    this.triggerEmergencyBrake(`session_disconnected: ${reason ?? 'unknown'}`)
    savePoolState(this.state)
    log.warn({ reason, health: this.state.health.score }, 'Pool paused after session disconnect')
  }

  onMessageDelivered(): void {
    this.state.health = recordDeliverySuccess(this.state.health)
    savePoolState(this.state)
  }

  resume(): void {
    this.state.paused = false
    this.state.pauseReason = undefined
    this.state.health.consecutiveFailures = 0
    savePoolState(this.state)
    this.scheduleProcess()
  }

  private scheduleProcess(): void {
    if (this.processorTimer) return
    this.processorTimer = setTimeout(() => {
      this.processorTimer = null
      void this.processQueue()
    }, 0)
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (true) {
        this.state = resetMarketingDayIfNeeded(this.state)

        if (this.state.paused) break

        const job = this.pickNextJob()
        if (!job) break

        if (job.lane === 'marketing') {
          const waitMs = this.marketingWaitMs()
          if (waitMs > 0) {
            this.requeueFront(job)
            await sleep(Math.min(waitMs, 5000))
            break
          }

          const allowed = this.canSendMarketing()
          if (!allowed.ok) {
            this.requeueFront(job)
            await sleep(Math.min(allowed.retryInMs, 30_000))
            break
          }
        }

        try {
          const messageId = await withTimeout(
            sendWhatsAppMessageDirect(job.req),
            WA_SEND_TIMEOUT_MS,
            'send_timeout'
          )
          this.onSendSuccess(job.lane)
          job.resolve(messageId)
        } catch (err) {
          const msg = (err as Error).message
          if (msg === 'send_timeout') {
            orgLogger(this.orgId).warn(
              { jobId: job.id, to: job.req.to, timeoutMs: WA_SEND_TIMEOUT_MS },
              'send_timeout — rejecting job and continuing lane worker'
            )
            getProviderForOrg(this.orgId)?.onSendTimeout?.(this.orgId)
          }
          this.onSendFailure(msg)
          job.reject(err as Error)

          if (this.state.paused) break
        }
      }
    } finally {
      this.processing = false
      if (
        !this.state.paused &&
        (this.operationalQueue.length > 0 || this.marketingQueue.length > 0)
      ) {
        this.scheduleProcess()
      }
    }
  }

  private removeQueuedJob(jobId: string, lane: MessageLane): void {
    const q = lane === 'operational' ? this.operationalQueue : this.marketingQueue
    const idx = q.findIndex((j) => j.id === jobId)
    if (idx >= 0) q.splice(idx, 1)
  }

  private requeueFront(job: QueuedJob): void {
    if (job.lane === 'operational') {
      this.operationalQueue.unshift(job)
    } else {
      this.marketingQueue.unshift(job)
    }
  }

  private pickNextJob(): QueuedJob | undefined {
    if (this.operationalQueue.length > 0) {
      return this.operationalQueue.shift()
    }
    if (this.marketingQueue.length > 0) {
      return this.marketingQueue.shift()
    }
    return undefined
  }

  private marketingWaitMs(): number {
    if (!this.state.lastMarketingSendAt) return 0
    const config = DEFAULT_WA_SENDER_RATE_CONFIG
    const jitterSec =
      config.jitterMinSec +
      Math.random() * (config.jitterMaxSec - config.jitterMinSec)
    const minGapMs = jitterSec * 1000
    const elapsed = Date.now() - this.state.lastMarketingSendAt
    return Math.max(0, minGapMs - elapsed)
  }

  private canSendMarketing(now = Date.now()): { ok: true } | { ok: false; retryInMs: number } {
    const config = DEFAULT_WA_SENDER_RATE_CONFIG
    const timestamps = this.state.marketingSentTimestamps
    const minuteCount = timestamps.filter((t) => t >= now - 60_000).length
    const hourCount = timestamps.filter((t) => t >= now - 3_600_000).length
    const dailyCap = effectiveDailyCap(config, this.state.warmupStage)

    if (this.state.marketingSentToday >= dailyCap) {
      const tomorrow = startOfNextDay(now)
      return { ok: false, retryInMs: Math.max(1000, tomorrow - now) }
    }
    if (minuteCount >= config.perMinute) {
      const oldestInMinute = timestamps.filter((t) => t >= now - 60_000)[0]
      return { ok: false, retryInMs: Math.max(500, oldestInMinute + 60_000 - now) }
    }
    if (hourCount >= config.perHour) {
      const oldestInHour = timestamps.filter((t) => t >= now - 3_600_000)[0]
      return { ok: false, retryInMs: Math.max(500, oldestInHour + 3_600_000 - now) }
    }

    return { ok: true }
  }

  private onSendSuccess(lane: MessageLane): void {
    const now = Date.now()
    if (lane === 'marketing') {
      this.state.marketingSentTimestamps.push(now)
      this.state.marketingSentTimestamps = this.state.marketingSentTimestamps.filter(
        (t) => t >= now - 3_600_000
      )
      this.state.marketingSentToday += 1
      this.state.lastMarketingSendAt = now
    }
    this.state.health = recordDeliverySuccess(this.state.health)
    this.maybeAdvanceWarmup()
    savePoolState(this.state)
  }

  private onSendFailure(message: string): void {
    const log = orgLogger(this.orgId)
    if (isRecipientBlockError(message)) {
      this.state.health = recordRecipientBlock(this.state.health)
    } else {
      this.state.health = recordDeliveryFailure(this.state.health)
    }
    savePoolState(this.state)

    const maxFailures = DEFAULT_WA_SENDER_RATE_CONFIG.maxConsecutiveFailures
    if (this.state.health.consecutiveFailures >= maxFailures) {
      this.triggerEmergencyBrake(`consecutive_failures: ${this.state.health.consecutiveFailures}`)
      log.error({ failures: this.state.health.consecutiveFailures }, 'Emergency brake triggered')
    }
  }

  private triggerEmergencyBrake(reason: string): void {
    if (this.state.paused && this.state.pauseReason === reason) return

    this.state.paused = true
    this.state.pauseReason = reason
    savePoolState(this.state)
    void this.notifyPoolPaused(reason)
  }

  private async notifyPoolPaused(reason: string): Promise<void> {
    const meta = loadSessionMeta(this.orgId)
    const webhookUrl = meta?.webhookUrl
    if (!webhookUrl) return

    await postWebhook(webhookUrl, {
      event: 'pool_paused',
      orgId: this.orgId,
      phone: this.state.phoneNumber,
      reason,
      healthScore: this.state.health.score,
      healthStatus: this.state.health.status,
      warmupStage: this.state.warmupStage,
      queueDepth: {
        operational: this.operationalQueue.length,
        marketing: this.marketingQueue.length,
      },
      timestamp: new Date().toISOString(),
    })
  }

  private maybeAdvanceWarmup(now = Date.now()): void {
    const config = DEFAULT_WA_SENDER_RATE_CONFIG
    if (this.state.warmupStage >= 3) return
    if (this.state.health.status !== 'green') return

    const started = new Date(this.state.warmupStartedAt).getTime()
    const daysSinceStart = Math.floor((now - started) / 86_400_000)
    const targetStage = Math.min(3, Math.floor(daysSinceStart / config.warmupStageDays)) as 0 | 1 | 2 | 3

    if (targetStage > this.state.warmupStage) {
      this.state.warmupStage = targetStage
      this.state.lastStageAdvanceAt = new Date(now).toISOString()
      orgLogger(this.orgId).info({ warmupStage: targetStage }, 'Warm-up stage advanced')
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function startOfNextDay(now: number): number {
  const d = new Date(now)
  d.setUTCHours(24, 0, 0, 0)
  return d.getTime()
}

/** Rehydrate pools for restored sessions on startup */
export function initPoolsForOrg(orgId: string): void {
  getSenderPool(orgId)
}

export function resetPoolForTests(orgId: string): void {
  pools.delete(orgId)
  savePoolState(createDefaultPoolState(orgId))
}
