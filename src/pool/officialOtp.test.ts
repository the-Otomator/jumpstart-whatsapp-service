import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getMetaCloudProvider } from '../providers'
import { OFFICIAL_OTP_SESSION, OTP_SEND_BUDGET_MS } from '../lib/officialOtp'
import { getSenderPool, resetPoolForTests } from './senderPool'

async function main() {
  const provider = getMetaCloudProvider()
  const originalStatus = provider.getStatus.bind(provider)
  const originalSend = provider.sendMessage.bind(provider)
  const originalRecover = provider.recoverOfficialOtpSession.bind(provider)
  provider.recoverOfficialOtpSession = async () => {}
  const folder = path.join(process.cwd(), 'sessions', OFFICIAL_OTP_SESSION)
  assert.equal(fs.existsSync(folder), false, 'fixture must not replace existing session data')
  provider.getStatus = id => id === OFFICIAL_OTP_SESSION
    ? { orgId: id, provider: 'meta-cloud', status: 'connected' }
    : originalStatus(id)
  const request = { orgId: OFFICIAL_OTP_SESSION, to: '15555550100', type: 'template' as const,
    template: { name: 'otp_login_he', language: 'he' } }
  try {
    resetPoolForTests(OFFICIAL_OTP_SESSION)
    const pool = getSenderPool(OFFICIAL_OTP_SESSION)
    pool.onSessionDisconnected('fixture')
    provider.sendMessage = async () => ({ messageId: 'fixture-message' })
    assert.equal(await pool.enqueueAndWait(request), 'fixture-message')
    assert.equal(pool.getStatus().paused, false)
    let aborted = false
    provider.sendMessage = req => new Promise((_resolve, reject) => {
      req.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    })
    const start = Date.now()
    await assert.rejects(pool.enqueueAndWait(request), /send_timeout/)
    assert.ok(Date.now() - start < OTP_SEND_BUDGET_MS + 400, 'hung provider must settle below 3s')
    assert.equal(aborted, true)
    provider.sendMessage = async () => { throw new Error('Meta template unavailable') }
    await assert.rejects(pool.enqueueAndWait(request), /Meta template unavailable/)
    provider.getStatus = () => undefined
    await assert.rejects(pool.enqueueAndWait(request), /Meta session not connected/)
    console.log('officialOtp: recovery, provider timeout, cancellation, API failure and no fallback passed')
  } finally {
    provider.getStatus = originalStatus
    provider.sendMessage = originalSend
    provider.recoverOfficialOtpSession = originalRecover
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
