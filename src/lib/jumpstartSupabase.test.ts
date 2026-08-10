import assert from 'node:assert/strict'
import { resolveJumpstartWebhookUrl } from './jumpstartSupabase'

type Result = { data: unknown; error: { message: string } | null }

function clientWith(results: Record<string, Result>) {
  return {
    from: (table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: string) => ({
          maybeSingle: async () => results[table] ?? { data: null, error: null },
        }),
      }),
    }),
  }
}

const webhook = 'https://dgxnnwnugdxzeopleera.supabase.co/functions/v1/wa-webhook'
const orgId = 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62'
const sessionKey = `${orgId}-c0e3b203`

async function run(): Promise<void> {
  assert.equal(await resolveJumpstartWebhookUrl(sessionKey, null, null), null)

  const exact = clientWith({
    wa_devices: { data: { session_key: sessionKey }, error: null },
  })
  assert.equal(await resolveJumpstartWebhookUrl(sessionKey, exact as never, null), webhook)

  const jumpstartOrg = clientWith({
    wa_devices: { data: null, error: null },
    organizations: { data: { id: orgId }, error: null },
  })
  const legacyHub = clientWith({
    whatsapp_devices: {
      data: { org_id: orgId, session_key: sessionKey, provider: 'baileys' },
      error: null,
    },
  })
  assert.equal(
    await resolveJumpstartWebhookUrl(sessionKey, jumpstartOrg as never, legacyHub as never),
    webhook
  )

  const unrelatedKey = `other-${sessionKey}`
  assert.equal(
    await resolveJumpstartWebhookUrl(unrelatedKey, jumpstartOrg as never, legacyHub as never),
    null
  )

  const failed = clientWith({
    wa_devices: { data: null, error: { message: 'query failed' } },
  })
  assert.equal(await resolveJumpstartWebhookUrl(sessionKey, failed as never, null), null)

  console.log('jumpstartSupabase tests passed')
}

void run()
