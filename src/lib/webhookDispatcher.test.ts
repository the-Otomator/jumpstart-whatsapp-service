import assert from 'assert'
import {
  appendWebhookSecret,
  attemptPost,
  buildWebhookHeaders,
  clearSessionWebhookSecret,
  clearWebhookFailures,
  getWebhookFailures,
  normalizeJumpstartInboundWebhookUrl,
  postWebhook,
  setSessionWebhookSecret,
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

    // Two connected Baileys devices in one org must send *their own* session_key,
    // not the bare organization UUID. Exact match on wa-webhook depends on this.
    const org = 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62'
    const privateKey = `${org}__84920ad6`
    const mainKey = `${org}-d1fde265`
    const privateHeaders = buildWebhookHeaders(URL, { orgId: privateKey, event: 'message' })
    const mainHeaders = buildWebhookHeaders(URL, { orgId: mainKey, event: 'message' })
    const bareHeaders = buildWebhookHeaders(URL, { orgId: org, event: 'message' })
    assert.strictEqual(privateHeaders['x-wa-session-key'], privateKey)
    assert.strictEqual(mainHeaders['x-wa-session-key'], mainKey)
    assert.strictEqual(bareHeaders['x-wa-session-key'], org)
    assert.notStrictEqual(privateHeaders['x-wa-session-key'], mainHeaders['x-wa-session-key'])
    assert.notStrictEqual(privateHeaders['x-wa-session-key'], org)
    assert.notStrictEqual(mainHeaders['x-wa-session-key'], org)

    const withQuery = buildWebhookHeaders(`${URL}?secret=query-value`, { orgId: ORG })
    assert.ok(!withQuery.Authorization, 'query-secret URLs keep existing no-Bearer behavior')

    const normalized = normalizeJumpstartInboundWebhookUrl(
      'https://example.test/functions/v1/whatsapp-incoming'
    )
    assert.ok(normalized.includes('/wa-webhook'))

    const redacted = redactWebhookUrl(`${URL}?secret=sensitive-query-value&x=1`)
    assert.ok(redacted.includes('secret=***'))
    assert.ok(!redacted.includes('sensitive-query-value'))

    const assembled = appendWebhookSecret(`${URL}?secret=legacy-value&x=1`, 'stored-column-value')
    assert.strictEqual(new globalThis.URL(assembled).searchParams.get('secret'), 'stored-column-value')
    const assembledRedacted = redactWebhookUrl(assembled)
    assert.ok(!assembledRedacted.includes('stored-column-value'))
    assert.ok(assembledRedacted.includes('secret=***'))
  } finally {
    if (previous === undefined) delete process.env.WA_INCOMING_SECRET
    else process.env.WA_INCOMING_SECRET = previous
  }
}

async function testDispatchRecombinesRegistrySecret(): Promise<void> {
  const sessionKey = 'wm-dispatch-secret-test'
  const requestedUrls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    requestedUrls.push(String(input))
    return response(200)
  }) as typeof fetch

  setSessionWebhookSecret(sessionKey, 'stored-column-value')
  try {
    await postWebhook(
      `${URL}?secret=legacy-value&x=1`,
      { orgId: sessionKey, event: 'message' },
      { fetchImpl, sleep: noSleep, persistHealth: async () => undefined }
    )
    assert.strictEqual(requestedUrls.length, 1)
    const dispatched = new globalThis.URL(requestedUrls[0])
    assert.strictEqual(dispatched.searchParams.get('secret'), 'stored-column-value')
    assert.strictEqual(dispatched.searchParams.get('x'), '1')
  } finally {
    clearSessionWebhookSecret(sessionKey)
  }
}

async function main(): Promise<void> {
  testHeadersAndUrlSanitization()
  await testDispatchRecombinesRegistrySecret()
  await testClassifications()
  await testRetriesAndNonBlockingTelemetry()
  console.log('webhookDispatcher.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
