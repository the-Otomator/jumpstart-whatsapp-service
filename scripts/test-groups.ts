/**
 * Smoke test for group endpoints.
 *
 * Usage:
 *   ORG_ID=<orgId> TEST_NUMBERS=972501234567,972502345678 WA_SERVICE_URL=http://localhost:3001 API_SECRET=<secret> \
 *     npx tsx scripts/test-groups.ts
 *
 * The script runs: create → metadata → add → remove → promote → demote → send → admined
 * It logs pass/fail for each step and exits 1 if any step fails.
 */

import 'dotenv/config'

const BASE_URL = process.env.WA_SERVICE_URL ?? 'http://localhost:3001'
const ORG_ID = process.env.ORG_ID
const TEST_NUMBERS = (process.env.TEST_NUMBERS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const SECRET = process.env.API_SECRET

if (!ORG_ID) { console.error('ORG_ID is required'); process.exit(1) }
if (TEST_NUMBERS.length < 1) { console.error('TEST_NUMBERS must have at least 1 number'); process.exit(1) }
if (!SECRET) { console.error('API_SECRET is required'); process.exit(1) }

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` }

async function call(method: string, path: string, body?: object): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data: any
  try { data = await res.json() } catch { data = {} }
  return { ok: res.ok, status: res.status, data }
}

function pass(label: string, data?: any) {
  console.log(`✅ ${label}`, data !== undefined ? JSON.stringify(data) : '')
}
function fail(label: string, data?: any) {
  console.error(`❌ ${label}`, data !== undefined ? JSON.stringify(data) : '')
  process.exitCode = 1
}

async function run() {
  console.log(`\nSmoke-testing group endpoints → ${BASE_URL} (org: ${ORG_ID})\n`)

  // 1. Create group
  const create = await call('POST', `/api/groups/${ORG_ID}/create`, {
    subject: `Test Group ${Date.now()}`,
    participants: TEST_NUMBERS,
    description: 'Smoke test group — safe to delete',
  })
  if (!create.ok) { fail('create', create.data); return }
  const { groupJid, inviteLink } = create.data
  pass('create', { groupJid, inviteLink })

  // 2. Metadata
  const meta = await call('GET', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/metadata`)
  if (!meta.ok) fail('metadata', meta.data)
  else pass('metadata', { subject: meta.data.subject, memberCount: meta.data.participants?.length })

  // 3. Add (re-add first participant — likely rejected, tests invite fallback path)
  const add = await call('POST', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/add`, {
    participants: [TEST_NUMBERS[0]],
  })
  if (!add.ok) fail('add', add.data)
  else pass('add', add.data.participants)

  // 4. Promote
  const promote = await call('POST', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/promote`, {
    participants: [TEST_NUMBERS[0]],
  })
  if (!promote.ok) fail('promote', promote.data)
  else pass('promote')

  // 5. Demote
  const demote = await call('POST', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/demote`, {
    participants: [TEST_NUMBERS[0]],
  })
  if (!demote.ok) fail('demote', demote.data)
  else pass('demote')

  // 6. Remove
  const remove = await call('POST', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/remove`, {
    participants: [TEST_NUMBERS[0]],
  })
  if (!remove.ok) fail('remove', remove.data)
  else pass('remove')

  // 7. Send message to group
  const send = await call('POST', `/api/groups/${ORG_ID}/${encodeURIComponent(groupJid)}/send`, {
    text: 'Smoke test message — safe to ignore 🤖',
  })
  if (!send.ok) fail('send', send.data)
  else pass('send', { messageId: send.data.messageId })

  // 8. Admined groups list
  const admined = await call('GET', `/api/groups/${ORG_ID}/admined`)
  if (!admined.ok) fail('admined', admined.data)
  else pass('admined', { count: admined.data.count })

  console.log(`\nDone. Group JID: ${groupJid}`)
  console.log('You may leave the group manually — it was created for testing only.\n')
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
