/**
 * Smoke test for group settings endpoints (Phase 5a).
 *
 * Usage:
 *   ORG_ID=<orgId> GROUP_JID=<jid@g.us> ICON_URL=<https://...> WA_SERVICE_URL=http://localhost:3001 API_SECRET=<secret> \
 *     npx tsx scripts/test-group-settings.ts
 *
 * Routes tested:
 *   POST /:orgId/:groupJid/description
 *   POST /:orgId/:groupJid/icon
 *   POST /:orgId/:groupJid/send-permission
 *   POST /:orgId/:groupJid/edit-info-permission
 *   POST /:orgId/:groupJid/approval-mode
 */

import 'dotenv/config'

const BASE_URL = process.env.WA_SERVICE_URL ?? 'http://localhost:3001'
const ORG_ID = process.env.ORG_ID
const GROUP_JID = process.env.GROUP_JID
const ICON_URL = process.env.ICON_URL
const SECRET = process.env.API_SECRET

if (!ORG_ID) { console.error('ORG_ID is required'); process.exit(1) }
if (!GROUP_JID) { console.error('GROUP_JID is required (format: <number>@g.us)'); process.exit(1) }
if (!ICON_URL) { console.error('ICON_URL is required (https URL to an image)'); process.exit(1) }
if (!SECRET) { console.error('API_SECRET is required'); process.exit(1) }

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${SECRET}`,
}

const groupBase = `${BASE_URL}/api/groups/${ORG_ID}/${encodeURIComponent(GROUP_JID)}`

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${groupBase}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

let passed = 0
let failed = 0

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${(err as Error).message}`)
    failed++
  }
}

;(async () => {
  console.log(`\nGroup settings smoke test — ${groupBase}\n`)

  await run('description', async () => {
    const { ok, status, data } = await post('/description', { description: 'Test description from smoke test' })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('icon', async () => {
    const { ok, status, data } = await post('/icon', { url: ICON_URL })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('send-permission (admins)', async () => {
    const { ok, status, data } = await post('/send-permission', { mode: 'admins' })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('send-permission (all)', async () => {
    const { ok, status, data } = await post('/send-permission', { mode: 'all' })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('edit-info-permission (admins)', async () => {
    const { ok, status, data } = await post('/edit-info-permission', { mode: 'admins' })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('edit-info-permission (all)', async () => {
    const { ok, status, data } = await post('/edit-info-permission', { mode: 'all' })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('approval-mode (on)', async () => {
    const { ok, status, data } = await post('/approval-mode', { enabled: true })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  await run('approval-mode (off)', async () => {
    const { ok, status, data } = await post('/approval-mode', { enabled: false })
    if (!ok) throw new Error(`HTTP ${status}: ${JSON.stringify(data)}`)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
})()
