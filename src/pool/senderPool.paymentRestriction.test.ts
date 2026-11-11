import assert from 'node:assert/strict'
import { mock } from 'node:test'
import * as sendDirect from '../lib/sendDirect'
import * as policy from '../lib/paymentRestriction'
import { SenderPool } from './senderPool'

async function main() {
  const orgId = `test-payment-hold-${Date.now()}`
  const pool = new SenderPool(orgId)
  const internals = pool as unknown as { scheduleProcess: () => void; processQueue: () => Promise<void> }
  mock.method(internals, 'scheduleProcess', () => {})
  const send = mock.method(sendDirect, 'sendWhatsAppMessageDirect', async () => 'sent-fixture')
  let held = true
  mock.method(policy, 'assertPaymentAllowsSend', async () => {
    if (held) throw new policy.PaymentRestrictedError()
  })

  const request = { orgId, to: '15551234567', type: 'text' as const, message: 'fixture' }
  pool.enqueue(request)
  await internals.processQueue()
  assert.equal(send.mock.callCount(), 0)
  assert.equal(pool.getStatus().queueDepth.marketing, 0, 'standalone job has no durable outbox reference')
  assert.equal(pool.getStatus().health.consecutiveFailures, 0)

  const pending = assert.rejects(pool.enqueueAndWait(request), policy.PaymentRestrictedError)
  await internals.processQueue()
  await pending
  assert.equal(pool.getStatus().queueDepth.operational, 0)
  assert.equal(pool.getStatus().queueDepth.marketing, 0, 'caller retains its outbox item')
  assert.equal(send.mock.callCount(), 0)

  held = false
  const retried = pool.enqueueAndWait(request)
  await internals.processQueue()
  assert.equal(await retried, 'sent-fixture')
  assert.equal(send.mock.callCount(), 1)
  assert.equal(pool.getStatus().queueDepth.marketing, 0)
  console.log('Payment refusal and caller retry checks passed with the provider mocked')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => mock.restoreAll())
