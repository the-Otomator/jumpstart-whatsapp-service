import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import '../../providers'
import { MetaCloudProvider } from './metaCloudProvider'
import * as registry from '../../lib/jumpstartSupabase'
import * as webhooks from '../../lib/sessionWebhookUrl'
import { OFFICIAL_OTP_SESSION } from '../../lib/officialOtp'

async function main() {
  const folder = path.join(process.cwd(), 'sessions', OFFICIAL_OTP_SESSION)
  assert.equal(fs.existsSync(folder), false, 'do not overwrite existing session')
  const previousRegistry = registry.jumpstartSupabase
  const previousWebhook = webhooks.resolveSessionWebhookUrl
  const previousFetch = globalThis.fetch
  const filters: Array<[string, unknown]> = []
  let display = '+972 55-504-0363'
  let secretReads = 0
  ;(registry as any).jumpstartSupabase = { from: (table: string) => {
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      is: (key: string, value: unknown) => { filters.push([key, value]); return query },
      abortSignal: (signal: AbortSignal) => { assert.ok(signal); return query },
      maybeSingle: async () => { if (table === 'wa_meta_secrets') secretReads++;
        return { error: null, data: table === 'wa_meta_accounts'
          ? { phone_number_id: 'fixture-phone', waba_id: 'fixture-waba', display_phone_number: display }
          : { access_token: 'fixture-token' } } },
    }
    return query
  } }
  ;(webhooks as any).resolveSessionWebhookUrl = async () => 'https://example.com/webhook'
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal)
    return new Response(JSON.stringify({ display_phone_number: display }), { status: 200 })
  }
  try {
    const provider = new MetaCloudProvider()
    await provider.recoverOfficialOtpSession(new AbortController().signal)
    assert.equal(provider.getStatus(OFFICIAL_OTP_SESSION)?.phoneNumber, '972555040363')
    assert.equal(provider.getStatus(OFFICIAL_OTP_SESSION)?.status, 'connected')
    assert.ok(filters.some(([key, value]) => key === 'id' && value === '1f63d665-b065-49c7-ad04-92427cfb7265'))
    assert.ok(filters.some(([key, value]) => key === 'sending_paused_at' && value === null))
    await provider.recoverOfficialOtpSession(new AbortController().signal)
    assert.equal(secretReads, 1, 'connected sender must not refetch its secret')
    display = '+972 50-000-0000'
    await assert.rejects(new MetaCloudProvider().recoverOfficialOtpSession(new AbortController().signal), /account unavailable/)
    assert.equal(secretReads, 1, 'wrong sender must fail before loading its token')
    console.log('officialOtpRecovery: missing session restored, pinned sender, registry pause gate and secret caching passed')
  } finally {
    ;(registry as any).jumpstartSupabase = previousRegistry
    ;(webhooks as any).resolveSessionWebhookUrl = previousWebhook
    globalThis.fetch = previousFetch
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
