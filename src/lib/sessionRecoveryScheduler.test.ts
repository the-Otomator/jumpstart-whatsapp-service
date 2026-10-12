import assert from 'node:assert/strict'
import { getProvider } from '../providers'
import { createSessionRecoveryScheduler, SESSION_RECOVERY_INTERVAL_MS } from './sessionRecoveryScheduler'

async function main() {
  assert.equal(SESSION_RECOVERY_INTERVAL_MS, 900_000)
  let release!: () => void
  let calls = 0
  const scheduler = createSessionRecoveryScheduler(async () => {
    calls++
    await new Promise<void>((resolve) => { release = resolve })
  }, () => assert.fail('Unexpected scheduler error'))
  const first = scheduler.tick()
  await scheduler.tick()
  assert.equal(calls, 1, 'Slow passes must not overlap')
  release()
  await first
  let errors = 0
  const failing = createSessionRecoveryScheduler(async () => { throw new Error('offline') }, () => { errors++ })
  await failing.tick()
  await failing.tick()
  assert.equal(errors, 2, 'A failed pass must release its lock')

  // Stub all disk/network boundaries; no socket, credential or message operations.
  const store = require('./sessionStore')
  const webhook = require('./sessionWebhookUrl')
  const original = { list: store.listStoredSessions, meta: store.loadSessionMeta,
    registered: store.hasRegisteredSession, webhook: webhook.resolveSessionWebhookUrl }
  const provider = getProvider('baileys') as any
  const originalStart = provider.start
  let starts = 0
  let registered = true
  let meta: any = null
  const key = 'test-periodic-recovery'
  store.listStoredSessions = () => [key]
  store.loadSessionMeta = () => meta
  store.hasRegisteredSession = () => registered
  webhook.resolveSessionWebhookUrl = async () => 'https://example.test/webhook'
  provider.start = async () => { starts++ }
  try {
    await provider.recoverDisconnectedSessions()
    assert.equal(starts, 1, 'Lost registered session must recover even without meta')
    for (const status of ['connected', 'connecting', 'qr']) {
      provider.sessions.set(key, { orgId: key, status })
      await provider.recoverDisconnectedSessions()
    }
    provider.sessions.delete(key)
    registered = false
    await provider.recoverDisconnectedSessions()
    registered = true
    meta = { autoRestore: false }
    await provider.recoverDisconnectedSessions()
    meta = { provider: 'meta-cloud' }
    await provider.recoverDisconnectedSessions()
    meta = null
    provider.intentionallyStoppedOrgIds.add(key)
    await provider.recoverDisconnectedSessions()
    provider.intentionallyStoppedOrgIds.delete(key)
    provider.sockets.set(key, {})
    await provider.recoverDisconnectedSessions()
    provider.sockets.delete(key)
    provider.reconnectTimers.set(key, {})
    await provider.recoverDisconnectedSessions()
    provider.reconnectTimers.delete(key)
    assert.equal(starts, 1, 'Protected sessions must never restart')
    webhook.resolveSessionWebhookUrl = async () => undefined
    await provider.recoverDisconnectedSessions()
    assert.equal(starts, 1, 'No reconnect without webhook')
    webhook.resolveSessionWebhookUrl = async () => {
      provider.sessions.set(key, { status: 'qr' })
      return 'https://example.test/webhook'
    }
    await provider.recoverDisconnectedSessions()
    assert.equal(starts, 1, 'Manual pairing during lookup must win')
  } finally {
    provider.sessions.delete(key)
    provider.start = originalStart
    store.listStoredSessions = original.list
    store.loadSessionMeta = original.meta
    store.hasRegisteredSession = original.registered
    webhook.resolveSessionWebhookUrl = original.webhook
  }
  console.log('Periodic recovery: scheduler overlap, failure recovery and session safety checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
