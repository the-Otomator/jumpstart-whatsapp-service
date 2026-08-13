import assert from 'assert'
import { resolveGroupInbound, shouldPostInboundWebhook } from './groupInbound'

function testResolveGroupInbound(): void {
  const oneToOne = resolveGroupInbound({ remoteJid: '972501234567@s.whatsapp.net' })
  assert.deepStrictEqual(oneToOne, { isGroup: false, groupJid: null, ambiguous: false })

  const group = resolveGroupInbound({ remoteJid: '1203630-group@g.us' })
  assert.strictEqual(group.isGroup, true)
  assert.strictEqual(group.groupJid, '1203630-group@g.us')
  assert.strictEqual(group.ambiguous, false)

  const ambiguous = resolveGroupInbound({
    remoteJid: '123456789012345@lid',
    participant: '972501234567@s.whatsapp.net',
  })
  assert.strictEqual(ambiguous.isGroup, true)
  assert.strictEqual(ambiguous.groupJid, null)
  assert.strictEqual(ambiguous.ambiguous, true)
}

function testShouldPostInboundWebhook(): void {
  assert.strictEqual(shouldPostInboundWebhook(false, null), true)
  assert.strictEqual(shouldPostInboundWebhook(true, '1203630-group@g.us'), true)
  assert.strictEqual(
    shouldPostInboundWebhook(true, null),
    false,
    'must not POST isGroup without groupId — wa-webhook returns 400 and that 400 was written into audit columns',
  )
}

testResolveGroupInbound()
testShouldPostInboundWebhook()
console.log('groupInbound.test.ts: all checks passed')
