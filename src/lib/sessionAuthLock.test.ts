/**
 * Single-writer session lock: reject live holders, reclaim stale.
 * Run: npx ts-node --transpile-only src/lib/sessionAuthLock.test.ts
 */
import fs from 'fs'
import path from 'path'
import {
  PROCESS_BOOT_ID,
  SessionLockError,
  acquireSessionLock,
  isPidAlive,
  plantSessionLock,
  readSessionLock,
  releaseSessionLock,
} from './sessionAuthLock'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const orgId = `test-lock-${Date.now()}`
  const dir = path.join(process.cwd(), 'sessions', orgId)

  try {
    const first = acquireSessionLock(orgId)
    assert(first.pid === process.pid, 'lock records our pid')
    assert(first.bootId === PROCESS_BOOT_ID, 'lock records boot id')
    assert(readSessionLock(orgId)?.pid === process.pid, 'lock readable')

    const again = acquireSessionLock(orgId)
    assert(again.pid === process.pid, 'same process re-acquire ok')

    releaseSessionLock(orgId)
    assert(readSessionLock(orgId) === null, 'lock released')

    const deadPid = 2_147_000_000
    assert(isPidAlive(deadPid) === false, 'dead pid is not alive')
    plantSessionLock(orgId, {
      pid: deadPid,
      bootId: 'stale-boot',
      acquiredAt: new Date(0).toISOString(),
    })
    const reclaimed = acquireSessionLock(orgId)
    assert(reclaimed.pid === process.pid, 'stale lock reclaimed')
    assert(reclaimed.bootId === PROCESS_BOOT_ID, 'reclaimed lock has current boot')
    releaseSessionLock(orgId)

    plantSessionLock(orgId, {
      pid: process.pid,
      bootId: 'previous-boot',
      acquiredAt: new Date(0).toISOString(),
    })
    const afterRestart = acquireSessionLock(orgId)
    assert(afterRestart.bootId === PROCESS_BOOT_ID, 'previous-boot lock reclaimed')
    releaseSessionLock(orgId)

    const foreignPid = process.pid === 4 ? 0 : 4
    if (isPidAlive(foreignPid)) {
      plantSessionLock(orgId, {
        pid: foreignPid,
        bootId: 'other-boot',
        acquiredAt: new Date().toISOString(),
      })
      let threw = false
      try {
        acquireSessionLock(orgId)
      } catch (err) {
        threw = err instanceof SessionLockError
      }
      assert(threw, 'second opener must throw SessionLockError')
      fs.unlinkSync(path.join(dir, '.session.lock'))
    } else {
      console.log('sessionAuthLock.test.ts: skip live-foreign-pid case (no candidate pid)')
    }

    console.log('sessionAuthLock.test.ts: OK')
  } finally {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
}

main()
