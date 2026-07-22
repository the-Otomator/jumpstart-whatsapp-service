/**
 * P1: wa-incoming auth header alignment.
 * Run: npx ts-node --transpile-only src/lib/webhookDispatcher.test.ts
 */
import { buildWebhookHeaders, normalizeJumpstartInboundWebhookUrl } from './webhookDispatcher'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function main() {
  const prev = process.env.WA_INCOMING_SECRET
  process.env.WA_INCOMING_SECRET = 'test-secret-value'

  try {
    const hubUrl = 'https://mzalzjtsyrjycaxolldv.supabase.co/functions/v1/wa-incoming'
    const hubHeaders = buildWebhookHeaders(hubUrl, { orgId: 'org-1', event: 'message' })
    assert(
      hubHeaders['Authorization'] === 'Bearer test-secret-value',
      `Hub wa-incoming without ?secret= must get Bearer from env, got ${JSON.stringify(hubHeaders)}`
    )
    assert(!hubHeaders['x-wa-session-key'], 'wa-incoming must not require x-wa-session-key')

    const wmUrl =
      'https://uvfrlkpeuejzqvvmnxrb.supabase.co/functions/v1/wa-incoming?secret=already-in-url'
    const wmHeaders = buildWebhookHeaders(wmUrl, { orgId: 'org-2', event: 'message' })
    assert(
      !wmHeaders['Authorization'],
      'when ?secret= already present, do not also attach Bearer'
    )

    const jsUrl = 'https://dgxnnwnugdxzeopleera.supabase.co/functions/v1/wa-webhook'
    const jsHeaders = buildWebhookHeaders(jsUrl, { orgId: 'org-3', event: 'message' })
    assert(jsHeaders['x-wa-session-key'] === 'org-3', 'wa-webhook still gets x-wa-session-key')
    assert(!jsHeaders['Authorization'], 'wa-webhook path unchanged (no Bearer from WA_INCOMING_SECRET)')

    delete process.env.WA_INCOMING_SECRET
    const noEnvHeaders = buildWebhookHeaders(hubUrl, { orgId: 'org-1', event: 'message' })
    assert(
      !noEnvHeaders['Authorization'],
      'without env and without ?secret=, do not invent a secret (ops must set env or reconcile webhookUrl)'
    )

    const normalized = normalizeJumpstartInboundWebhookUrl(
      'https://example.supabase.co/functions/v1/whatsapp-incoming'
    )
    assert(normalized.includes('wa-webhook'), 'legacy whatsapp-incoming → wa-webhook')
  } finally {
    if (prev === undefined) delete process.env.WA_INCOMING_SECRET
    else process.env.WA_INCOMING_SECRET = prev
  }

  console.log('webhookDispatcher.test.ts: all checks passed')
}

main()
