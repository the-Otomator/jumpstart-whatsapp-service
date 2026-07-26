/**
 * P0c: isSocketOpen + keepalive 2-miss + sendMessage guard.
 * Run: npx ts-node --transpile-only src/providers/baileys/baileysProvider.wsOpen.test.ts
 */
import { EventEmitter } from 'events'
import { getProvider } from '../../providers'
import { isSocketOpen, type BaileysProvider } from './baileysProvider'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

type FakeWs =
  | { isOpen: boolean }
  | { socket: { readyState: number } }
  | { readyState: number }

type FakeSock = EventEmitter & {
  end: (err?: unknown) => void
  user?: { id: string }
  ws: FakeWs
  sendMessage?: (jid: string, content: unknown) => Promise<{ key: { id: string } }>
}

function makeFakeSocket(ws: FakeWs = { isOpen: true }): FakeSock {
  const ev = new EventEmitter()
  const sock = ev as FakeSock
  sock.ws = ws
  sock.user = { id: '972500000000:1@s.whatsapp.net' }
  sock.end = () => {
    queueMicrotask(() => {
      sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: undefined },
      })
    })
  }
  ;(sock as unknown as { ev: EventEmitter }).ev = sock
  return sock
}

async function main() {
  // --- isSocketOpen shapes (Baileys WebSocketClient / raw / legacy) ---
  assert(
    isSocketOpen(makeFakeSocket({ isOpen: true }) as never) === true,
    'WebSocketClient isOpen=true → open'
  )
  assert(
    isSocketOpen(makeFakeSocket({ isOpen: false }) as never) === false,
    'WebSocketClient isOpen=false → closed'
  )
  assert(
    isSocketOpen(makeFakeSocket({ socket: { readyState: 1 } }) as never) === true,
    'raw socket.readyState=1 → open'
  )
  assert(
    isSocketOpen(makeFakeSocket({ socket: { readyState: 3 } }) as never) === false,
    'raw socket.readyState=3 → closed'
  )
  assert(
    isSocketOpen(makeFakeSocket({ readyState: 1 }) as never) === true,
    'legacy ws.readyState=1 → open'
  )
  assert(isSocketOpen(undefined) === false, 'undefined sock → closed')

  const provider = getProvider('baileys') as BaileysProvider
  const orgId = `test-wsopen-${Date.now()}`
  const webhookUrl = 'https://example.test/hook'

  const sockets = (provider as unknown as { sockets: Map<string, FakeSock> }).sockets
  const sessions = (provider as unknown as {
    sessions: Map<string, { orgId: string; status: string; provider: string; webhookUrl?: string }>
  }).sessions

  let startCalls = 0
  const originalStart = provider.start.bind(provider)
  provider.start = async () => {
    startCalls++
  }

  // --- keepalive: one miss does NOT tear down; two consecutive do ---
  const half = makeFakeSocket({ isOpen: false })
  sockets.set(orgId, half)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })
  startCalls = 0

  provider.probeKeepalive(orgId)
  assert(provider.getSocketMapSize() === 1, 'first half-open miss must keep socket')
  assert(provider.getPendingReconnectCount() === 0, 'first miss must not schedule reconnect')

  provider.probeKeepalive(orgId)
  assert(provider.getSocketMapSize() === 0, 'second consecutive miss must tear down')
  assert(provider.getPendingReconnectCount() === 1, 'second miss schedules one reconnect')
  provider.clearReconnectTimer(orgId)

  // success between misses resets the counter
  const flaky = makeFakeSocket({ isOpen: false })
  sockets.set(orgId, flaky)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })
  provider.probeKeepalive(orgId) // miss 1
  flaky.ws = { isOpen: true }
  provider.probeKeepalive(orgId) // success → reset
  flaky.ws = { isOpen: false }
  provider.probeKeepalive(orgId) // miss 1 again — must NOT tear down
  assert(provider.getSocketMapSize() === 1, 'success between misses resets counter')
  assert(provider.getPendingReconnectCount() === 0, 'reset path must not reconnect')
  provider.probeKeepalive(orgId) // miss 2
  assert(provider.getSocketMapSize() === 0, 'two consecutive misses after reset tear down')
  provider.clearReconnectTimer(orgId)

  // missing socket still immediate
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })
  sockets.delete(orgId)
  provider.probeKeepalive(orgId)
  assert(provider.getPendingReconnectCount() === 1, 'missing socket tears down immediately')
  provider.clearReconnectTimer(orgId)
  sessions.delete(orgId)

  // --- sendMessage: isOpen=true must NOT throw / must NOT forceTeardown ---
  const openSock = makeFakeSocket({ isOpen: true })
  let sendCalled = 0
  openSock.sendMessage = async () => {
    sendCalled++
    return { key: { id: 'msg-1' } }
  }
  sockets.set(orgId, openSock)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })

  const beforeTeardownPending = provider.getPendingReconnectCount()
  const result = await provider.sendMessage({
    orgId,
    to: '972501234567',
    type: 'text',
    message: 'hello',
  })
  assert(result.messageId === 'msg-1', 'sendMessage returns message id')
  assert(sendCalled === 1, 'Baileys sendMessage must be called when open')
  assert(provider.getSocketMapSize() === 1, 'open guard must not tear down')
  assert(
    provider.getPendingReconnectCount() === beforeTeardownPending,
    'open guard must not schedule reconnect'
  )

  // isOpen=false still fails fast + tears down
  const closedSock = makeFakeSocket({ isOpen: false })
  closedSock.sendMessage = async () => {
    throw new Error('should not send on closed')
  }
  sockets.set(orgId, closedSock)
  sessions.set(orgId, { orgId, status: 'connected', provider: 'baileys', webhookUrl })
  let threw = false
  try {
    await provider.sendMessage({
      orgId,
      to: '972501234567',
      type: 'text',
      message: 'hello',
    })
  } catch (err) {
    threw = true
    assert(
      err instanceof Error && err.message.includes('not connected'),
      'closed guard throws not connected'
    )
  }
  assert(threw, 'closed isOpen must throw')
  assert(provider.getSocketMapSize() === 0, 'closed sendMessage tears down')
  provider.clearReconnectTimer(orgId)
  sessions.delete(orgId)

  provider.start = originalStart
  console.log('baileysProvider.wsOpen.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
