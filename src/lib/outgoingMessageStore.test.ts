/**
 * Outgoing message store + getMessage behaviour.
 * Run: npx ts-node --transpile-only src/lib/outgoingMessageStore.test.ts
 */
import fs from 'fs'
import path from 'path'
import {
  clearOutgoingMessageStore,
  getOutgoingMessage,
  storeOutgoingMessage,
} from './outgoingMessageStore'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  const orgId = `test-outmsg-${Date.now()}`
  const otherOrg = `${orgId}-other`
  const sessionsRoot = path.join(process.cwd(), 'sessions')

  try {
    const key = { id: 'ABC123', remoteJid: '972501234567@s.whatsapp.net' }
    const message = { conversation: 'hello retry' }

    storeOutgoingMessage(orgId, key, message)

    const hit = getOutgoingMessage(orgId, key)
    assert(hit?.conversation === 'hello retry', 'getMessage returns stored content for known key')

    const miss = getOutgoingMessage(orgId, {
      id: 'DOES_NOT_EXIST',
      remoteJid: key.remoteJid,
    })
    assert(miss === undefined, 'getMessage returns undefined for unknown key')

    // Must not throw
    const miss2 = getOutgoingMessage(orgId, { id: undefined as unknown as string })
    assert(miss2 === undefined, 'getMessage safe on missing id')

    // Cross-org isolation
    const leaked = getOutgoingMessage(otherOrg, key)
    assert(leaked === undefined, 'other org cannot read stored message')

    // remoteJid mismatch → miss
    const wrongJid = getOutgoingMessage(orgId, {
      id: key.id,
      remoteJid: '972509999999@s.whatsapp.net',
    })
    assert(wrongJid === undefined, 'remoteJid mismatch returns undefined')

    console.log('outgoingMessageStore.test.ts: OK')
  } finally {
    clearOutgoingMessageStore(orgId)
    clearOutgoingMessageStore(otherOrg)
    for (const id of [orgId, otherOrg]) {
      const dir = path.join(sessionsRoot, id)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
