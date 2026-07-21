/**
 * Resume-on-reconnect checks (no test runner required).
 * Run: npx ts-node --transpile-only src/pool/senderPool.resume.test.ts
 */
import fs from 'fs'
import path from 'path'
import { getSenderPool, resetPoolForTests } from './senderPool'

const ORG = `test-resume-${Date.now()}`

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  resetPoolForTests(ORG)
  const pool = getSenderPool(ORG)

  pool.onSessionDisconnected('test_flap')
  assert(pool.getStatus().paused === true, 'expected paused after disconnect')
  assert(
    String(pool.getStatus().pauseReason).includes('session_disconnected'),
    'expected session_disconnected pauseReason'
  )

  const pending = pool.enqueueAndWait(
    { orgId: ORG, to: '15551234567', type: 'text', message: 'hello' },
    'operational'
  )

  await sleep(30)
  assert(pool.getStatus().paused === true, 'still paused while disconnected')
  assert(pool.getStatus().queueDepth.operational === 1, 'job should remain queued while paused')

  pool.onSessionConnected('15559876543')
  assert(pool.getStatus().paused === false, 'expected unpaused after onSessionConnected')
  assert(pool.getStatus().pauseReason === undefined, 'pauseReason should be cleared')

  let settled = false
  let errMsg = ''
  try {
    await pending
    settled = true
  } catch (err) {
    settled = true
    errMsg = (err as Error).message
  }

  assert(settled, 'queued job should settle after reconnect resume')
  assert(
    errMsg.includes('not connected'),
    `expected Session-not-connected reject (proves worker ran), got: ${errMsg || '(resolved)'}`
  )
  assert(pool.getStatus().queueDepth.operational === 0, 'queue should be drained')

  // cleanup persisted pool state + in-memory map
  resetPoolForTests(ORG)
  const dir = path.join(process.cwd(), 'sessions', ORG)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })

  console.log('senderPool.resume.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
