/**
 * Outgoing message store + getMessage behaviour.
 * Run: npx ts-node --transpile-only src/lib/outgoingMessageStore.test.ts
 */
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import {
  OUTGOING_MSG_ENFORCE_EVERY,
  OUTGOING_MSG_MAX_PER_SESSION,
  OUTGOING_TMP_ORPHAN_MAX_AGE_MS,
  clearOutgoingMessageStore,
  enforceBound,
  getOutgoingMessage,
  resetStoreCountForTests,
  storeOutgoingMessage,
} from './outgoingMessageStore'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function outgoingDir(orgId: string): string {
  return path.join(process.cwd(), 'sessions', orgId, 'outgoing')
}

function seedJsonEntries(
  orgId: string,
  count: number,
  opts?: { baseMtimeMs?: number; stepMs?: number }
): string[] {
  const dir = outgoingDir(orgId)
  fs.mkdirSync(dir, { recursive: true })
  const base = opts?.baseMtimeMs ?? Date.now() - count * 1000
  const step = opts?.stepMs ?? 1000
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = `seed-${String(i).padStart(5, '0')}`
    ids.push(id)
    const full = path.join(dir, `${id}.json`)
    const entry = {
      remoteJid: '972501234567@s.whatsapp.net',
      message: { conversation: `msg-${i}` },
      storedAt: base + i * step,
    }
    // Sync write for bulk seed speed; production path remains async.
    fs.writeFileSync(full, JSON.stringify(entry), 'utf-8')
    const mtime = new Date(base + i * step)
    fs.utimesSync(full, mtime, mtime)
  }
  return ids
}

async function jsonCount(orgId: string): Promise<number> {
  return (await fsp.readdir(outgoingDir(orgId))).filter((n) => n.endsWith('.json')).length
}

async function main() {
  const orgId = `test-outmsg-${Date.now()}`
  const otherOrg = `${orgId}-other`
  const sessionsRoot = path.join(process.cwd(), 'sessions')
  const orgsToClean = [orgId, otherOrg]

  try {
    // --- Basic get/store (async) ---
    const key = { id: 'ABC123', remoteJid: '972501234567@s.whatsapp.net' }
    const message = { conversation: 'hello retry' }

    await storeOutgoingMessage(orgId, key, message)

    const hit = await getOutgoingMessage(orgId, key)
    assert(hit?.conversation === 'hello retry', 'getMessage returns stored content for known key')

    const miss = await getOutgoingMessage(orgId, {
      id: 'DOES_NOT_EXIST',
      remoteJid: key.remoteJid,
    })
    assert(miss === undefined, 'getMessage returns undefined for unknown key')

    const miss2 = await getOutgoingMessage(orgId, { id: undefined as unknown as string })
    assert(miss2 === undefined, 'getMessage safe on missing id')

    const leaked = await getOutgoingMessage(otherOrg, key)
    assert(leaked === undefined, 'other org cannot read stored message')

    const wrongJid = await getOutgoingMessage(orgId, {
      id: key.id,
      remoteJid: '972509999999@s.whatsapp.net',
    })
    assert(wrongJid === undefined, 'remoteJid mismatch returns undefined')

    await clearOutgoingMessageStore(orgId)

    // --- Regression: storeOutgoingMessage must not O(n) content-read ---
    const seedN = Math.min(250, OUTGOING_MSG_MAX_PER_SESSION)
    const perfOrg = `${orgId}-perf`
    orgsToClean.push(perfOrg)
    seedJsonEntries(perfOrg, seedN)
    resetStoreCountForTests(perfOrg)

    let readFileCalls = 0
    const origReadFile = fsp.readFile
    const readFileSpy: typeof fsp.readFile = (async (...args: Parameters<typeof fsp.readFile>) => {
      readFileCalls++
      return origReadFile(...args)
    }) as typeof fsp.readFile
    ;(fsp as { readFile: typeof fsp.readFile }).readFile = readFileSpy

    let syncReadCalls = 0
    const origReadFileSync = fs.readFileSync
    ;(fs as { readFileSync: typeof fs.readFileSync }).readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      syncReadCalls++
      return origReadFileSync(...args)
    }) as typeof fs.readFileSync

    try {
      await storeOutgoingMessage(
        perfOrg,
        { id: 'NEW-AFTER-SEED', remoteJid: key.remoteJid },
        { conversation: 'one more' }
      )
    } finally {
      ;(fsp as { readFile: typeof fsp.readFile }).readFile = origReadFile
      ;(fs as { readFileSync: typeof fs.readFileSync }).readFileSync = origReadFileSync
    }

    assert(
      readFileCalls === 0,
      `storeOutgoingMessage must not content-read existing entries (got ${readFileCalls} async reads for seedN=${seedN})`
    )
    assert(
      syncReadCalls === 0,
      `storeOutgoingMessage must not use readFileSync (got ${syncReadCalls})`
    )
    const after = await getOutgoingMessage(perfOrg, {
      id: 'NEW-AFTER-SEED',
      remoteJid: key.remoteJid,
    })
    assert(after?.conversation === 'one more', 'new entry stored after seed')
    await clearOutgoingMessageStore(perfOrg)

    // --- Cap eviction (oldest-first via mtime) + amortised enforceBound ---
    // One full-cap seed covers both: direct enforceBound, then amortised overshoot/trim.
    const capOrg = `${orgId}-cap`
    orgsToClean.push(capOrg)
    const overshoot = 5
    const total = OUTGOING_MSG_MAX_PER_SESSION + overshoot
    console.log(`seeding ${total} entries for cap/amortisation test...`)
    seedJsonEntries(capOrg, total, {
      baseMtimeMs: Date.now() - total * 10,
      stepMs: 10,
    })
    await enforceBound(capOrg)

    let remaining = (await fsp.readdir(outgoingDir(capOrg))).filter((n) => n.endsWith('.json'))
    assert(
      remaining.length === OUTGOING_MSG_MAX_PER_SESSION,
      `enforceBound must trim to cap (got ${remaining.length}, want ${OUTGOING_MSG_MAX_PER_SESSION})`
    )
    for (let i = 0; i < overshoot; i++) {
      const id = `seed-${String(i).padStart(5, '0')}`
      assert(!remaining.includes(`${id}.json`), `oldest entry ${id} should have been evicted`)
    }
    const newest = `seed-${String(total - 1).padStart(5, '0')}.json`
    assert(remaining.includes(newest), `newest entry ${newest} should remain`)

    // Amortisation: ENFORCE_EVERY-1 stores may overshoot; the Nth trims back to cap.
    // Give extras newer mtimes so oldest seed-* entries are preferred for eviction.
    resetStoreCountForTests(capOrg)
    const beforeExtra = OUTGOING_MSG_ENFORCE_EVERY - 1
    const extraBase = Date.now()
    for (let i = 0; i < beforeExtra; i++) {
      await storeOutgoingMessage(
        capOrg,
        { id: `extra-${i}`, remoteJid: key.remoteJid },
        { conversation: `extra-${i}` }
      )
      const extraPath = path.join(outgoingDir(capOrg), `extra-${i}.json`)
      const m = new Date(extraBase + i)
      fs.utimesSync(extraPath, m, m)
    }
    let count = await jsonCount(capOrg)
    assert(
      count === OUTGOING_MSG_MAX_PER_SESSION + beforeExtra,
      `between enforce runs, overshoot of ${beforeExtra} is allowed (got ${count})`
    )
    await storeOutgoingMessage(
      capOrg,
      { id: 'extra-trigger', remoteJid: key.remoteJid },
      { conversation: 'trigger' }
    )
    count = await jsonCount(capOrg)
    assert(
      count === OUTGOING_MSG_MAX_PER_SESSION,
      `after amortised enforce, must be back at cap (got ${count})`
    )
    await clearOutgoingMessageStore(capOrg)

    // --- .tmp orphan cleanup ---
    const tmpOrg = `${orgId}-tmp`
    orgsToClean.push(tmpOrg)
    const tmpDir = outgoingDir(tmpOrg)
    await fsp.mkdir(tmpDir, { recursive: true })
    const staleTmp = path.join(tmpDir, 'orphan.json.tmp')
    const freshTmp = path.join(tmpDir, 'fresh.json.tmp')
    await fsp.writeFile(staleTmp, '{"partial":true}', 'utf-8')
    await fsp.writeFile(freshTmp, '{"partial":true}', 'utf-8')
    const old = new Date(Date.now() - OUTGOING_TMP_ORPHAN_MAX_AGE_MS - 60_000)
    await fsp.utimes(staleTmp, old, old)
    await enforceBound(tmpOrg)
    assert(!(await fsp.stat(staleTmp).then(() => true).catch(() => false)), 'stale .tmp must be removed')
    assert(await fsp.stat(freshTmp).then(() => true).catch(() => false), 'fresh .tmp must be kept')
    await clearOutgoingMessageStore(tmpOrg)

    console.log('outgoingMessageStore.test.ts: OK')
  } finally {
    for (const id of orgsToClean) {
      resetStoreCountForTests(id)
      const dir = path.join(sessionsRoot, id)
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
