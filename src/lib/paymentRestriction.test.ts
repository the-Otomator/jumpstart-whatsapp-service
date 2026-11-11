import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { isPaymentRestricted } from './paymentRestriction'

async function main() {
  const orgId = '00000000-0000-4000-8000-000000000001'
  let devices = [{ organization_id: orgId }]
  let decision: boolean | null = true
  let decisionStatus = 200
  const calls: string[] = []
  const client = createClient('https://fixture.example.test', 'fixture-key', {
    auth: { persistSession: false },
    global: { fetch: async (url, options) => {
      const path = new URL(String(url)).pathname
      calls.push(path)
      if (path.endsWith('/wa_devices')) return Response.json(devices)
      assert.ok(path.endsWith('/rpc/payment_restricted_outbound_blocked'))
      assert.deepEqual(JSON.parse(String(options?.body)), { p_org_id: orgId })
      return Response.json(decision, { status: decisionStatus })
    } },
  })

  assert.equal(await isPaymentRestricted('fixture', client), true)
  decision = false
  assert.equal(await isPaymentRestricted('fixture', client), false, 're-read after payment')
  decisionStatus = 503
  assert.equal(await isPaymentRestricted('fixture', client), false, 'decision unavailable fails open')
  devices = []
  const callCount = calls.length
  assert.equal(await isPaymentRestricted('external-fixture', client), false)
  assert.equal(calls.length, callCount + 1, 'external sessions never query billing')
  console.log('Payment restriction decision checks passed')
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
