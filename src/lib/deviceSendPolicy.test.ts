import assert from 'node:assert/strict'
import express from 'express'
import * as jumpstart from './jumpstartSupabase'
import { assertDeviceCanSend, readDeviceListenOnly } from './deviceSendPolicy'
import { getProvider } from '../providers'
import messages from '../routes/messages'
import groups from '../routes/groups'
import sessions from '../routes/sessions'

async function main() {
  const registryRow = { org_id: '9d54c7ab-f12b-46a5-801b-64dc5286ed81', webhook_url: 'https://uvfrlkpeuejzqvvmnxrb.supabase.co/functions/v1/wa-incoming' }
  let externalRows: unknown = [registryRow]
  let externalError: unknown = null
  let belongsToJumpstart = false
  let jumpstartError: unknown = null
  let organizationError: unknown = null
  const registryClient = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: externalRows, error: externalError }) }) }) }) }
  const externalPolicyClient = { from: (table: string) => ({ select: () => ({ eq: () => ({ limit: async () => ({
    data: table === 'wa_devices' ? [] : belongsToJumpstart ? [{ id: registryRow.org_id }] : [],
    error: table === 'wa_devices' ? jumpstartError : organizationError,
  }) }) }) }) }
  assert.equal(await readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), false)
  const jumpstartObservedClient = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'observed', listen_only: true }], error: null }) }) }) }) }
  assert.equal(await readDeviceListenOnly('external-fixture', jumpstartObservedClient, registryClient), true, 'JumpStart listen-only wins even when Hub claims an external route')
  for (const webhook_url of [
    'https://dgxnnwnugdxzeopleera.supabase.co/functions/v1/wa-incoming',
    'https://api.jumpstart.co.il/functions/v1/wa-webhook',
    'https://uvfrlkpeuejzqvvmnxrb.supabase.co/functions/v1/wa-webhook',
    'http://uvfrlkpeuejzqvvmnxrb.supabase.co/functions/v1/wa-incoming',
    'https://evil.invalid/functions/v1/wa-incoming', 'not-a-url',
  ]) {
    externalRows = [{ ...registryRow, webhook_url }]
    await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  }
  for (const invalid of [[], [registryRow, registryRow], [{ ...registryRow, org_id: null }]]) {
    externalRows = invalid
    await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  }
  externalRows = [registryRow]; belongsToJumpstart = true
  await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  belongsToJumpstart = false; externalError = 'unavailable'
  await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  externalError = null; jumpstartError = 'unavailable'
  await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  jumpstartError = null; organizationError = 'unavailable'
  await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, registryClient), /WA_DEVICE_POLICY_UNAVAILABLE/)
  organizationError = null
  await assert.rejects(readDeviceListenOnly('external-fixture', externalPolicyClient, null), /WA_DEVICE_POLICY_UNAVAILABLE/)
  console.log('PASS external policy: exact Hub registry, external route, no JumpStart ownership; all ambiguity and lookup failures refuse')
  let listenOnly = true
  let rows: unknown = undefined
  let error: unknown = null
  const client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({
    data: rows === undefined ? [{ id: 'fixture-device', listen_only: listenOnly }] : rows, error,
  }) }) }) }) }
  Object.defineProperty(jumpstart, 'jumpstartSupabase', { value: client, configurable: true })
  await assert.rejects(assertDeviceCanSend('fixture', client), /WA_DEVICE_LISTEN_ONLY/)
  listenOnly = false
  await assertDeviceCanSend('fixture', client)
  for (const invalid of [[], [{ listen_only: null }], [{ listen_only: false }, { listen_only: true }]]) {
    rows = invalid
    await assert.rejects(assertDeviceCanSend('fixture', client), /WA_DEVICE_POLICY_UNAVAILABLE/)
  }
  rows = undefined; error = new Error('database down')
  await assert.rejects(assertDeviceCanSend('fixture', client), /WA_DEVICE_POLICY_UNAVAILABLE/)
  await assert.rejects(assertDeviceCanSend('fixture', null), /WA_DEVICE_POLICY_UNAVAILABLE/)
  error = null; listenOnly = true

  const provider = getProvider('baileys') as any
  let sends = 0
  const sock = { ws: { isOpen: true }, sendMessage: async () => { sends++; return { key: { id: 'ok' } } } }
  ;(provider as any).sockets.set('fixture', sock)
  await assert.rejects(provider.sendMessage({ orgId: 'fixture', to: '972500000000', type: 'text', message: 'fixture' }), /WA_DEVICE_LISTEN_ONLY/)
  assert.equal(sends, 0, 'policy check happens before Baileys')
  listenOnly = false
  await provider.sendMessage({ orgId: 'fixture', to: '972500000000', type: 'text', message: 'fixture' })
  assert.equal(sends, 1, 'normal device still sends')
  listenOnly = true
  await assert.rejects(provider.sendMessage({ orgId: 'fixture', to: '972500000000', type: 'text', message: 'fixture' }), /WA_DEVICE_LISTEN_ONLY/)
  assert.equal(sends, 1, 'policy change takes effect without reconnect or cache expiry')

  const app = express(); app.use(express.json()); app.use('/api/messages', messages); app.use('/api/groups', groups); app.use('/api/sessions', sessions)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const send = { orgId: 'fixture', to: '972500000000', type: 'text', message: 'fixture' }
  try {
    for (const body of [send, { ...send, enqueue: true, lane: 'marketing' }]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/messages/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(response.status, 403); assert.equal((await response.json() as any).code, 'WA_DEVICE_LISTEN_ONLY')
    }
    const alias = await fetch(`http://127.0.0.1:${address.port}/api/sessions/fixture/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: send.to, message: send.message }) })
    assert.equal(alias.status, 403)
    const bulk = await fetch(`http://127.0.0.1:${address.port}/api/messages/send-bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([send, { ...send, enqueue: true, lane: 'marketing' }]) })
    assert.equal((await bulk.json() as any).summary.succeeded, 0)
    for (const operation of ['send', 'create', 'add', 'remove', 'promote', 'demote', 'description', 'subject', 'icon', 'send-permission']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/groups/fixture/120000@g.us/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      assert.equal(response.status, 403, operation)
    }
    assert.equal(sends, 1)
  } finally { server.close(); server.closeAllConnections() }
  console.log('PASS device policy: fail closed, fresh toggle, provider refuses, single/bulk/queued HTTP sends and group mutations refuse')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
