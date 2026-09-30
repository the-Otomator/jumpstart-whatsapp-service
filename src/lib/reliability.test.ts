import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { sendWhatsAppMessage } from '../routes/messages'
import { processDeviceState } from './deviceMonitor'

async function main(): Promise<void> {
  const start = performance.now()
  await assert.rejects(
    sendWhatsAppMessage({ orgId: 'missing-org-missing-device', to: '15551234567', type: 'text', message: 'test' }),
    /not connected/
  )
  const elapsedMs = Math.round(performance.now() - start)
  assert(elapsedMs < 20_000, `unknown session exceeded 20 seconds: ${elapsedMs}ms`)
  console.log(`unknown session rejected in ${elapsedMs}ms`)

  const received: string[] = []
  const writes: string[] = []
  const row = { session_key: 'test-org-test-device', status: 'connected' }
  const writeStatus = async (_key: string, status: 'connected' | 'disconnected') => { writes.push(status) }
  const sendAlert = async (message: string) => { received.push(message) }
  const now = Date.now()
  await processDeviceState(row, false, now, writeStatus, sendAlert)
  await processDeviceState(row, false, now + 121_000, writeStatus, sendAlert)
  assert.equal(received.length, 1)
  assert.match(received[0], /WA session down/)
  assert.match(received[0], /test-org-test-device/)
  assert.equal(writes[0], 'disconnected')
  await processDeviceState({ ...row, status: 'disconnected' }, true, now + 122_000, writeStatus, sendAlert)
  assert.equal(writes.at(-1), 'connected')
  console.log(`simulated alert received: ${received[0].replaceAll('\n', ' | ')}`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
