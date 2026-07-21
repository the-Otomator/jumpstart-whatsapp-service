/**
 * Lightweight timeout unit checks (no test runner required).
 * Run: npx ts-node --transpile-only src/lib/withTimeout.test.ts
 */
import { withTimeout } from './withTimeout'

function neverResolves(): Promise<string> {
  return new Promise(() => {})
}

async function assertRejects(label: string, fn: () => Promise<unknown>, expectedMsg: string) {
  try {
    await fn()
    throw new Error(`${label}: expected rejection`)
  } catch (err) {
    const msg = (err as Error).message
    if (msg !== expectedMsg) {
      throw new Error(`${label}: expected "${expectedMsg}", got "${msg}"`)
    }
  }
}

async function main() {
  await assertRejects(
    'hung promise times out',
    () => withTimeout(neverResolves(), 50, 'send_timeout'),
    'send_timeout'
  )

  const value = await withTimeout(Promise.resolve('ok'), 200, 'send_timeout')
  if (value !== 'ok') throw new Error(`resolve path: expected ok, got ${value}`)

  // Second job after a timed-out first "send" still runs (lane continuity pattern).
  const jobs: string[] = []
  async function fakeLaneWorker(sends: Array<() => Promise<string>>) {
    for (const send of sends) {
      try {
        const id = await withTimeout(send(), 40, 'send_timeout')
        jobs.push(`ok:${id}`)
      } catch (err) {
        jobs.push(`err:${(err as Error).message}`)
      }
    }
  }

  await fakeLaneWorker([
    () => neverResolves(),
    () => Promise.resolve('msg-2'),
  ])

  if (jobs[0] !== 'err:send_timeout' || jobs[1] !== 'ok:msg-2') {
    throw new Error(`lane continuity failed: ${JSON.stringify(jobs)}`)
  }

  console.log('withTimeout.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
