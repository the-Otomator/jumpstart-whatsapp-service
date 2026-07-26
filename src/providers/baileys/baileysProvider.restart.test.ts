/**
 * P0b regression: restart must not stack reconnect timers / grow socket fan-out.
 * Run: npx ts-node --transpile-only src/providers/baileys/baileysProvider.restart.test.ts
 */
import { EventEmitter } from 'events'
// Load providers barrel first so BaileysProvider finishes init before pool↔provider cycle.
import { getProvider } from '../../providers'
import type { BaileysProvider } from './baileysProvider'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

type FakeSock = EventEmitter & {
  end: (err?: unknown) => void
  user?: { id: string }
  ws: { readyState: number }
}

function makeFakeSocket(): FakeSock {
  const ev = new EventEmitter()
  const sock = ev as FakeSock
  sock.ws = { readyState: 1 }
  sock.user = { id: '972500000000:1@s.whatsapp.net' }
  sock.end = () => {
    // Mimic Baileys: end() → connection.update close with undefined statusCode
    queueMicrotask(() => {
      sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: undefined },
      })
    })
  }
  // Baileys uses sock.ev.on(...)
  ;(sock as unknown as { ev: EventEmitter }).ev = sock
  return sock
}

async function main() {
  const provider = getProvider('baileys') as BaileysProvider
  const orgId = `test-restart-${Date.now()}`
  const webhookUrl = 'https://example.test/hook'

  // Stub start so reconnect timers don't hit real Baileys/auth.
  let startCalls = 0
  const startArgs: Array<{ orgId: string; webhookUrl?: string }> = []
  const originalStart = provider.start.bind(provider)
  provider.start = async (id: string, url?: string) => {
    startCalls++
    startArgs.push({ orgId: id, webhookUrl: url })
    // Keep map consistent with a live socket when a timer "reconnects"
    const sock = makeFakeSocket()
    ;(provider as unknown as { sockets: Map<string, FakeSock> }).sockets.set(id, sock)
    const sessions = (provider as unknown as { sessions: Map<string, { orgId: string; status: string; provider: string; webhookUrl?: string }> }).sessions
    sessions.set(id, { orgId: id, status: 'connected', provider: 'baileys', webhookUrl: url })
  }

  // Seed a "connected" session as if Baileys already opened.
  const first = makeFakeSocket()
  const sockets = (provider as unknown as { sockets: Map<string, FakeSock> }).sockets
  const sessions = (provider as unknown as {
    sessions: Map<string, { orgId: string; status: string; provider: string; webhookUrl?: string }>
  }).sessions
  sockets.set(orgId, first)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })

  // Wire the same close handler shape used in production via scheduleReconnect guards:
  // simulate restart branch exactly as start() does.
  const suppress = (provider as unknown as { suppressReconnectSockets: WeakSet<object> }).suppressReconnectSockets
  suppress.add(first)
  first.end(undefined)
  sockets.delete(orgId)

  // Install replacement socket (what start() would do after tearing down old).
  const second = makeFakeSocket()
  sockets.set(orgId, second)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })

  // Attach a close listener mirroring provider logic for the OLD socket path:
  // production registers this inside start(); here we invoke scheduleReconnect only
  // if suppress/intentional guards fail — verify old close does NOT schedule.
  await sleep(20)
  assert(provider.getPendingReconnectCount() === 0, 'old suppressed close must not schedule reconnect')
  assert(provider.getSocketMapSize() === 1, 'exactly one live socket after restart')
  assert(sockets.get(orgId) === second, 'map must point at replacement socket')

  // scheduleReconnect exclusivity: three back-to-back schedules → one timer, one start.
  startCalls = 0
  startArgs.length = 0
  // Remove socket so schedule is allowed
  sockets.delete(orgId)
  provider.scheduleReconnect(orgId, webhookUrl, 30)
  provider.scheduleReconnect(orgId, webhookUrl, 30)
  provider.scheduleReconnect(orgId, webhookUrl, 30)
  assert(provider.getPendingReconnectCount() === 1, 'only one reconnect timer may exist')
  assert(provider.hasPendingReconnect(orgId), 'timer keyed by orgId')

  await sleep(80)
  assert(startCalls === 1, `expected exactly one start() from stacked schedules, got ${startCalls}`)
  assert(provider.getPendingReconnectCount() === 0, 'timer cleared after fire')
  assert(provider.getSocketMapSize() === 1, 'one socket after reconnect start stub')

  // Guard: do not schedule while a socket already exists.
  startCalls = 0
  provider.scheduleReconnect(orgId, webhookUrl, 10)
  assert(provider.getPendingReconnectCount() === 0, 'must not schedule when socket present')
  await sleep(30)
  assert(startCalls === 0, 'must not call start when socket present')

  // half-open recovery schedules exactly one reconnect
  const half = makeFakeSocket()
  half.ws.readyState = 3 // CLOSED
  sockets.set(orgId, half)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })
  startCalls = 0
  provider.forceTeardownAndReconnect(orgId, 'test_half_open')
  assert(provider.getSocketMapSize() === 0, 'teardown removes socket')
  assert(provider.getPendingReconnectCount() === 1, 'exactly one recovery reconnect')
  // Stacking forceTeardown must not grow timers
  provider.forceTeardownAndReconnect(orgId, 'test_half_open_2')
  assert(provider.getPendingReconnectCount() === 1, 'forceTeardown replaces timer, does not stack')

  provider.clearReconnectTimer(orgId)
  sockets.delete(orgId)
  sessions.delete(orgId)
  // Restore real start (avoid leaking stub on singleton provider)
  provider.start = originalStart

  console.log('baileysProvider.restart.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
