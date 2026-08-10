import assert from 'node:assert/strict'
import { resolveJumpstartWebhookUrl } from './jumpstartSupabase'

function clientReturning(result: unknown) {
  return {
    from: (table: string) => {
      assert.equal(table, 'wa_devices')
      return {
        select: (columns: string) => {
          assert.equal(columns, 'session_key')
          return {
            eq: (column: string, value: string) => {
              assert.equal(column, 'session_key')
              assert.equal(value, 'org__device')
              return { maybeSingle: async () => result }
            },
          }
        },
      }
    },
  }
}

async function run(): Promise<void> {
  assert.equal(await resolveJumpstartWebhookUrl('org__device', null), null)

  const found = clientReturning({ data: { session_key: 'org__device' }, error: null })
  assert.equal(
    await resolveJumpstartWebhookUrl('org__device', found as never),
    'https://dgxnnwnugdxzeopleera.supabase.co/functions/v1/wa-webhook'
  )

  const missing = clientReturning({ data: null, error: null })
  assert.equal(await resolveJumpstartWebhookUrl('org__device', missing as never), null)

  const failed = clientReturning({ data: null, error: { message: 'query failed' } })
  assert.equal(await resolveJumpstartWebhookUrl('org__device', failed as never), null)

  console.log('jumpstartSupabase tests passed')
}

void run()
