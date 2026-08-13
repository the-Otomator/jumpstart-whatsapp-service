import assert from 'assert'
import { buildWebhookProbePayload, runWebhookAudit } from './webhookAudit'
import type { SessionMeta } from './sessionStore'
import type { WebhookHealthResult } from './webhookHealth'

async function main(): Promise<void> {
  assert.deepStrictEqual(buildWebhookProbePayload('session-key', 'probe-1'), {
    event: 'webhook.probe',
    orgId: 'session-key',
    probeId: 'probe-1',
  })

  const metas = new Map<string, SessionMeta | null>([
    ['missing-meta', null],
    ['invalid-url', baseMeta('invalid-url', 'not-a-url')],
    ['http-url', baseMeta('http-url', 'http://example.test/functions/v1/wa-webhook')],
    ['legacy-secret', baseMeta('legacy-secret', 'https://example.test/functions/v1/wa-webhook?secret=value')],
    ['healthy', baseMeta('healthy', 'https://example.test/functions/v1/wa-webhook')],
  ])
  const writes = new Map<string, WebhookHealthResult>()
  const probes: Array<{ url: string; payload: Record<string, unknown> }> = []

  await runWebhookAudit({
    listSessions: () => [...metas.keys()],
    loadMeta: (sessionKey) => metas.get(sessionKey) ?? null,
    probeId: () => 'safe-probe-id',
    attempt: async (url, payload) => {
      probes.push({ url, payload: payload as Record<string, unknown> })
      return { ok: true, category: 'ok', httpStatus: 200, errorCode: null }
    },
    persist: async (sessionKey, result) => { writes.set(sessionKey, result) },
  })

  assert.strictEqual(writes.get('missing-meta')?.category, 'missing_meta')
  assert.strictEqual(writes.get('invalid-url')?.errorCode, 'invalid_url')
  assert.strictEqual(writes.get('http-url')?.errorCode, 'non_https_url')
  assert.strictEqual(writes.get('legacy-secret')?.errorCode, 'legacy_query_secret')
  assert.strictEqual(writes.get('healthy')?.category, 'ok')
  assert.strictEqual(probes.length, 1, 'only valid HTTPS configuration may be probed')
  assert.deepStrictEqual(probes[0].payload, {
    event: 'webhook.probe',
    orgId: 'healthy',
    probeId: 'safe-probe-id',
  })
  assert.ok(!JSON.stringify([...writes.entries()]).includes('secret=value'))
  assert.ok(!JSON.stringify(probes).includes('secret=value'))
  console.log('webhookAudit.test.ts: all checks passed')
}

function baseMeta(orgId: string, webhookUrl: string): SessionMeta {
  return {
    orgId,
    provider: 'baileys',
    webhookUrl,
    createdAt: new Date(0).toISOString(),
    autoRestore: true,
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
