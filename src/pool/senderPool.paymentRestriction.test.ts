import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { mock } from 'node:test'
import * as sendDirect from '../lib/sendDirect'
import * as policy from '../lib/paymentRestriction'
import { SenderPool } from './senderPool'

const orgId = 'test-payment-restart'

async function runProcess(phase: string) {
  const pool = new SenderPool(orgId)
  const internals = pool as unknown as { scheduleProcess: () => void; processQueue: () => Promise<void> }
  mock.method(internals, 'scheduleProcess', () => {})
  const send = mock.method(sendDirect, 'sendWhatsAppMessageDirect', async () => 'sent-fixture')
  mock.method(policy, 'assertPaymentAllowsSend', async () => {
    if (phase === 'restricted') throw new policy.PaymentRestrictedError()
  })

  const request = { orgId, to: '15551234567', type: 'text' as const, message: 'fixture' }
  if (phase === 'restricted') {
    pool.enqueue(request)
    pool.enqueue({ ...request, expiresAt: '2020-01-01T00:00:00.000Z' })
    const pending = assert.rejects(pool.enqueueAndWait(request), policy.PaymentRestrictedError)
    await internals.processQueue()
    await pending
    assert.equal(send.mock.callCount(), 0)
    assert.equal(pool.getStatus().queueDepth.operational, 0, 'caller owns its synchronous retry')
    assert.equal(pool.getStatus().queueDepth.marketing, 2)
    assert.equal(pool.getStatus().health.consecutiveFailures, 0)
  } else {
    assert.equal(pool.getStatus().queueDepth.marketing, 2, 'new process reads both held records')
    // Bypass the pacing sleep. This fixture exercises only hold, expiry and restart.
    mock.method(pool as unknown as { marketingWaitMs: () => number }, 'marketingWaitMs', () => 0)
    await internals.processQueue()
    assert.equal(send.mock.callCount(), 1)
    assert.equal(pool.getStatus().queueDepth.marketing, 0)
    const queueDir = path.join('sessions', orgId, 'send-queue')
    const outcomes = fs.readdirSync(queueDir).map(file => JSON.parse(fs.readFileSync(path.join(queueDir, file), 'utf8')))
    assert.deepEqual(outcomes.map(entry => entry.outcome).sort(), ['restricted', 'sent'])
    assert.equal(outcomes.find(entry => entry.outcome === 'restricted')?.status, 'skipped')
    assert.equal(outcomes.find(entry => entry.outcome === 'restricted')?.reason, 'restricted')
  }
}

async function main() {
  const phase = process.argv[2]
  if (phase) {
    await runProcess(phase)
    return
  }
  const root = fs.realpathSync(process.cwd())
  const fixture = fs.mkdtempSync(path.join(root, '.wa-restart-test-'))
  try {
    for (const phase of ['restricted', 'paid']) {
      const result = spawnSync(process.execPath, [
        require.resolve('ts-node/dist/bin.js'), '--project', path.join(root, 'tsconfig.json'),
        '--transpile-only', __filename, phase,
      ], { cwd: fixture, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error))
    }
    console.log('Restart proof: held jobs restored, one mocked send, one restricted skip')
  } finally {
    const resolved = fs.realpathSync(fixture)
    assert.equal(path.dirname(resolved), root)
    assert.ok(path.basename(resolved).startsWith('.wa-restart-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => mock.restoreAll())
