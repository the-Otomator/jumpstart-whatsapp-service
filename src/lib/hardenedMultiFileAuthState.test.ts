/**
 * Hardened auth state: serialized + atomic saveCreds under concurrency.
 * Run: npx ts-node --transpile-only src/lib/hardenedMultiFileAuthState.test.ts
 */
import fs from 'fs'
import path from 'path'
import { useHardenedMultiFileAuthState } from './hardenedMultiFileAuthState'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function main() {
  const folder = path.join(process.cwd(), 'sessions', `test-auth-${Date.now()}`)

  try {
    const { state, saveCreds, flush } = await useHardenedMultiFileAuthState(folder)

    // Mutate creds and fire many concurrent saveCreds — must not tear the JSON file.
    const N = 40
    const writes = Array.from({ length: N }, async (_, i) => {
      // registrationId is readonly on the type but is a plain number on the object.
      ;(state.creds as { accountSyncCounter: number }).accountSyncCounter = i + 1
      await saveCreds()
    })
    await Promise.all(writes)
    await flush()

    const credsPath = path.join(folder, 'creds.json')
    assert(fs.existsSync(credsPath), 'creds.json exists')

    // No leftover temp files from atomic writes
    const leftovers = fs.readdirSync(folder).filter((n) => n.endsWith('.tmp'))
    assert(leftovers.length === 0, `no temp leftovers, got ${leftovers.join(',')}`)

    const raw = fs.readFileSync(credsPath, 'utf-8')
    const parsed = JSON.parse(raw) as { accountSyncCounter: number }
    assert(
      typeof parsed.accountSyncCounter === 'number',
      'creds.json parses after concurrent saves'
    )
    assert(
      parsed.accountSyncCounter >= 1 && parsed.accountSyncCounter <= N,
      `final counter in range, got ${parsed.accountSyncCounter}`
    )

    // Concurrent key writes also serialize
    await Promise.all([
      state.keys.set({ 'pre-key': { '1': state.creds.noiseKey } }),
      saveCreds(),
      state.keys.set({ 'pre-key': { '2': state.creds.noiseKey } }),
      saveCreds(),
    ])
    await flush()

    const again = JSON.parse(fs.readFileSync(credsPath, 'utf-8'))
    assert(again && typeof again === 'object', 'creds still valid after mixed key/creds writes')
    assert(fs.existsSync(path.join(folder, 'pre-key-1.json')), 'pre-key-1 written')
    assert(fs.existsSync(path.join(folder, 'pre-key-2.json')), 'pre-key-2 written')

    console.log('hardenedMultiFileAuthState.test.ts: OK')
  } finally {
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
