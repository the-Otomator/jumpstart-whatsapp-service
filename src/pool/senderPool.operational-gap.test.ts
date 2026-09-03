/**
 * Operational-lane pacing checks with an injected fake clock (no real sleeping).
 * Run: npx ts-node --transpile-only src/pool/senderPool.operational-gap.test.ts
 */
import fs from 'fs'
import path from 'path'
import type { SendMessageRequest } from '../types'
import { DEFAULT_WA_SENDER_RATE_CONFIG } from './rateConfig'
import { SenderPool, resetPoolForTests } from './senderPool'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function cleanup(orgIds: string[]): void {
  for (const orgId of orgIds) {
    resetPoolForTests(orgId)
    const dir = path.join(process.cwd(), 'sessions', orgId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const orgIds: string[] = []
  const orgId = `test-operational-gap-${Date.now()}`
  orgIds.push(orgId)

  let now = 1_000_000
  let randomIndex = 0
  const randomValues = [0, 0.2, 0.4, 0.6, 0.8, 0.999]
  const sleepDurations: number[] = []
  const sendTimes: number[] = []
  const pool = new SenderPool(orgId, {
    now: () => now,
    random: () => randomValues[randomIndex++ % randomValues.length],
    sleep: async (ms) => {
      sleepDurations.push(ms)
      now += ms
    },
    sendMessage: async () => {
      sendTimes.push(now)
      return `message-${sendTimes.length}`
    },
  })

  const batch = Array.from({ length: 21 }, (_, index) =>
    pool.enqueueAndWait(
      { orgId, to: `1555000${String(index).padStart(4, '0')}`, type: 'text', message: `batch-${index}` },
      'operational'
    )
  )
  await Promise.all(batch)

  assert(sendTimes.length === 21, `expected 21 sends, got ${sendTimes.length}`)
  const gaps = sendTimes.slice(1).map((sentAt, index) => sentAt - sendTimes[index])
  assert(gaps.every((gap) => gap >= 3_000), `gap below 3s: ${gaps.join(', ')}`)
  assert(gaps.every((gap) => gap <= 8_000), `gap above 8s: ${gaps.join(', ')}`)
  assert(new Set(gaps).size > 1, `expected varying gaps, got ${gaps.join(', ')}`)
  const batchDurationMs = sendTimes[20] - sendTimes[0]
  assert(
    batchDurationMs >= 60_000 && batchDurationMs <= 170_000,
    `expected 21-message duration in 60-170s, got ${batchDurationMs}ms`
  )
  assert(pool.getStatus().marketingSentToday === 0, 'operational sends must not use marketing caps')
  assert(
    pool.getStatus().operationalSpacing.minGapSec === 3 &&
      pool.getStatus().operationalSpacing.maxGapSec === 8,
    'status must expose the operational 3-8s range'
  )

  const sleepsBeforeIdleSend = sleepDurations.length
  now += 9_000
  const idleSendAt = now
  await pool.enqueueAndWait(
    { orgId, to: '15559999999', type: 'text', message: 'after-idle' },
    'operational'
  )
  assert(sendTimes[21] === idleSendAt, 'send after an idle period should be immediate')
  assert(sleepDurations.length === sleepsBeforeIdleSend, 'idle send unexpectedly slept')

  const priorityOrgId = `test-operational-priority-${Date.now()}`
  orgIds.push(priorityOrgId)
  const sendOrder: string[] = []
  const priorityPool = new SenderPool(priorityOrgId, {
    now: () => now,
    random: () => 0,
    sleep: async (ms) => {
      now += ms
    },
    sendMessage: async (req: SendMessageRequest) => {
      sendOrder.push(req.message ?? '')
      return `priority-${sendOrder.length}`
    },
  })
  const marketing = priorityPool.enqueueAndWait(
    { orgId: priorityOrgId, to: '15551111111', type: 'text', message: 'marketing' },
    'marketing'
  )
  const operational = priorityPool.enqueueAndWait(
    { orgId: priorityOrgId, to: '15552222222', type: 'text', message: 'operational' },
    'operational'
  )
  await Promise.all([marketing, operational])
  assert(sendOrder.join(',') === 'operational,marketing', `unexpected lane order: ${sendOrder.join(',')}`)

  assert(DEFAULT_WA_SENDER_RATE_CONFIG.jitterMinSec === 20, 'marketing minimum jitter changed')
  assert(DEFAULT_WA_SENDER_RATE_CONFIG.jitterMaxSec === 90, 'marketing maximum jitter changed')
  assert(DEFAULT_WA_SENDER_RATE_CONFIG.perMinute === 8, 'marketing per-minute cap changed')
  assert(DEFAULT_WA_SENDER_RATE_CONFIG.perHour === 60, 'marketing per-hour cap changed')

  cleanup(orgIds)
  console.log(
    `senderPool.operational-gap.test.ts: all checks passed; 21-message simulated duration=${batchDurationMs}ms`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
