import assert from 'assert'
import {
  attemptPost,
  buildWebhookHeaders,
  clearWebhookFailures,
  getWebhookFailures,
  normalizeJumpstartInboundWebhookUrl,
  postWebhook,
} from './webhookDispatcher'
import type { WebhookHealthResult } from './webhookHealth'
import { redactWebhookUrl } from './webhookUrl'

const URL = 'https://example.test/functions/v1/wa-webhook'
const ORG = 'org-test'
const noSleep = async (): Promise<void> => undefined

function response(status: number): Response {
  return new Response('', { status })
}

function fetchReturning(...statuses: number[]): { fetchImpl: typeof fetch; calls: () => number } {
  let callCount = 0
  const fetchImpl = (async () => {
    const status = statuses[Math.min(callCount, statuses.length - 1)]
    callCount += 1
    return response(status)
  }) as typeof fetch
  return { fetchImpl, calls: () => callCount }
}

async function flushTelemetry(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function testClassifications(): Promise<void> {
  const ok = await attemptPost(URL, {}, 1, fetchReturning(200).fetchImpl)
  assert.deepStrictEqual(ok, { ok: true, category: 'ok', httpStatus: 200, errorCode: null })

  const unauthorized = await attemptPost(URL, {}, 1, fetchReturning(401).fetchImpl)
  assert.strictEqual(unauthorized.category, 'auth_rejected')
  assert.strictEqual(unauthorized.httpStatus, 401)

  const forbidden = await attemptPost(URL, {}, 1, fetchReturning(403).fetchImpl)
  assert.strictEqual(forbidden.category, 'auth_rejected')

  const other4xx = await attemptPost(URL, {}, 1, fetchReturning(422).fetchImpl)
  assert.strictEqual(other4xx.category, 'http_rejected')
  assert.strictEqual(other4xx.httpStatus, 422)

  const serverError = await attemptPost(URL, {}, 1, fetchReturning(503).fetchImpl)
  assert.strictEqual(serverError.category, 'http_rejected')
  assert.strictEqual(serverError.httpStatus, 503)

  const timeoutError = new Error('sensitive timeout detail')
  timeoutError.name = 'AbortError'
  const timeoutFetch = (async () => { throw timeoutError }) as typeof fetch
  const timeout = await attemptPost(URL, {}, 1, timeoutFetch)
  assert.deepStrictEqual(timeout, {
    ok: false,
    category: 'timeout',
    httpStatus: null,
    errorCode: 'timeout',
  })

  const networkFetch = (async () => { throw new Error('sensitive network detail') }) as typeof fetch
  const network = await attemptPost(URL, {}, 1, networkFetch)
  assert.deepStrictEqual(network, {
    ok: false,
    category: 'unreachable',
    httpStatus: null,
    errorCode: 'unreachable',
  })
}

async function testRetriesAndNonBlockingTelemetry(): Promise<void> {
  const retry = fetchReturning(500, 200)
  const writes: WebhookHealthResult[] = []
  await postWebhook(URL, { orgId: ORG, event: 'message', message: 'private-body' }, {
    fetchImpl: retry.fetchImpl,
    sleep: noSleep,
    persistHealth: async (_sessionKey, result) => { writes.push(result) },
  })
  await flushTelemetry()
  assert.strictEqual(retry.calls(), 2, 'must retry once and then stop on success')
  assert.strictEqual(writes.length, 1)
  assert.strictEqual(writes[0].category, 'ok')

  clearWebhookFailures(ORG)
  const exhausted = fetchReturning(500)
  const failedWrites: WebhookHealthResult[] = []
  await postWebhook(
    `${URL}?secret=sensitive-query-value`,
    { orgId: ORG, event: 'message', message: 'sensitive-payload-value' },
    {
      fetchImpl: exhausted.fetchImpl,
      sleep: noSleep,
      persistHealth: async (_sessionKey, result) => { failedWrites.push(result) },
    }
  )
  await flushTelemetry()
  assert.strictEqual(exhausted.calls(), 3, 'must exhaust exactly three attempts')
  assert.strictEqual(failedWrites.length, 1)
  assert.strictEqual(failedWrites[0].category, 'http_rejected')
  const stored = JSON.stringify(getWebhookFailures(ORG))
  assert.ok(!stored.includes('sensitive-query-value'), 'stored URL must redact query secret')
  assert.ok(!stored.includes('sensitive-payload-value'), 'stored failure must not retain payload')

  const healthy = fetchReturning(200)
  await assert.doesNotReject(() => postWebhook(URL, { orgId: 'writer-failure' }, {
    fetchImpl: healthy.fetchImpl,
    sleep: noSleep,
    persistHealth: async () => { throw new Error('health storage unavailable') },
  }))
  await flushTelemetry()
}

function testHeadersAndUrlSanitization(): void {
  const previous = process.env.WA_INCOMING_SECRET
  process.env.WA_INCOMING_SECRET = 'non-production-test-value'
  try {
    const headers = buildWebhookHeaders(URL, { orgId: ORG, event: 'webhook.probe' })
    assert.strictEqual(headers['x-wa-session-key'], ORG)
    assert.strictEqual(headers.Authorization, 'Bearer non-production-test-value')

    const withQuery = buildWebhookHeaders(`${URL}?secret=query-value`, { orgId: ORG })
    assert.ok(!withQuery.Authorization, 'query-secret URLs keep existing no-Bearer behavior')

    const normalized = normalizeJumpstartInboundWebhookUrl(
      'https://example.test/functions/v1/whatsapp-incoming'
    )
    assert.ok(normalized.includes('/wa-webhook'))

    const redacted = redactWebhookUrl(`${URL}?secret=sensitive-query-value&x=1`)
    assert.ok(redacted.includes('secret=***'))
    assert.ok(!redacted.includes('sensitive-query-value'))
  } finally {
    if (previous === undefined) delete process.env.WA_INCOMING_SECRET
    else process.env.WA_INCOMING_SECRET = previous
  }
}

async function main(): Promise<void> {
  testHeadersAndUrlSanitization()
  await testClassifications()
  await testRetriesAndNonBlockingTelemetry()
  console.log('webhookDispatcher.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
