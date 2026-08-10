import express from 'express'
import type { Server } from 'http'
import { authMiddleware } from './auth'
import { logger } from './lib/logger'

type CapturedLog = {
  level: 'info' | 'warn'
  args: unknown[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function setCredential(name: 'API_SECRET' | 'API_SECRET_NEXT', value?: string): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

async function main(): Promise<void> {
  const originalCurrent = process.env.API_SECRET
  const originalNext = process.env.API_SECRET_NEXT
  const originalInfo = logger.info
  const originalWarn = logger.warn
  const captured: CapturedLog[] = []
  let server: Server | undefined

  ;(logger as any).info = (...args: unknown[]) => captured.push({ level: 'info', args })
  ;(logger as any).warn = (...args: unknown[]) => captured.push({ level: 'warn', args })

  try {
    const app = express()
    app.get('/probe', authMiddleware, (_req, res) => res.status(200).json({ ok: true }))
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    const address = server.address()
    assert(address && typeof address !== 'string', 'test server did not expose a TCP port')
    const url = `http://127.0.0.1:${address.port}/probe`

    const current = 'fixture-current-credential-with-high-entropy-shape'
    const next = 'fixture-next-credential-with-distinct-high-entropy-shape'
    const wrong = 'fixture-invalid-credential'

    async function request(
      token: string,
      currentValue: string | undefined,
      nextValue: string | undefined
    ): Promise<{ status: number; logs: CapturedLog[] }> {
      setCredential('API_SECRET', currentValue)
      setCredential('API_SECRET_NEXT', nextValue)
      const start = captured.length
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      await response.arrayBuffer()
      return { status: response.status, logs: captured.slice(start) }
    }

    function assertSuccessfulAuth(
      result: { status: number; logs: CapturedLog[] },
      expectedUsedNext: boolean,
      label: string
    ): void {
      assert(result.status === 200, `${label}: expected 200, got ${result.status}`)
      const success = result.logs.find((entry) => entry.level === 'info')
      assert(success, `${label}: successful auth log missing`)
      const fields = success.args[0] as { usedNext?: boolean }
      assert(fields.usedNext === expectedUsedNext, `${label}: wrong usedNext signal`)
    }

    assertSuccessfulAuth(await request(current, current, next), false, 'current credential')
    assertSuccessfulAuth(await request(next, current, next), true, 'next credential')

    let result = await request(wrong, current, next)
    assert(result.status === 401, `wrong credential: expected 401, got ${result.status}`)

    assertSuccessfulAuth(await request(current, current, undefined), false, 'next unset')
    result = await request(wrong, current, undefined)
    assert(result.status === 401, `next unset wrong credential: expected 401, got ${result.status}`)

    assertSuccessfulAuth(await request(current, current, current), false, 'equal credentials')

    result = await request(next, undefined, next)
    assert(result.status === 401, `current unset: expected 401, got ${result.status}`)

    result = await request(next, '', next)
    assert(result.status === 401, `current empty: expected 401, got ${result.status}`)

    assertSuccessfulAuth(await request(current, current, ''), false, 'next empty')

    result = await request(current.slice(0, -1), current, next)
    assert(result.status === 401, `credential prefix: expected 401, got ${result.status}`)
    result = await request(`${current}-suffix`, current, next)
    assert(result.status === 401, `credential superset: expected 401, got ${result.status}`)

    const serializedLogs = JSON.stringify(captured)
    for (const credential of [current, next, wrong]) {
      assert(!serializedLogs.includes(credential), 'captured logs contain a credential fixture value')
    }

    console.log('auth tests passed: 11 cases; credential fixtures absent from captured logs')
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    setCredential('API_SECRET', originalCurrent)
    setCredential('API_SECRET_NEXT', originalNext)
    ;(logger as any).info = originalInfo
    ;(logger as any).warn = originalWarn
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
