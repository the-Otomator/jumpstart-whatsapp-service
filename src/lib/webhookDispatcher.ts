import { logger } from './logger'
import { redactWebhookUrl } from './webhookUrl'
import { persistWebhookHealth, type WebhookHealthResult } from './webhookHealth'

export type WebhookDispatchCategory = Extract<
  WebhookHealthResult['category'],
  'ok' | 'auth_rejected' | 'http_rejected' | 'unreachable' | 'timeout'
>

export interface WebhookDispatchResult {
  ok: boolean
  category: WebhookDispatchCategory
  httpStatus: number | null
  errorCode: string | null
}

interface WebhookFailure {
  orgId: string
  url: string
  attempts: number
  category: Exclude<WebhookDispatchCategory, 'ok'>
  httpStatus: number | null
  errorCode: string
  timestamp: string
}

interface WebhookDispatcherDependencies {
  fetchImpl?: typeof fetch
  sleep?: (delayMs: number) => Promise<void>
  persistHealth?: typeof persistWebhookHealth
}

const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 15000]
const MAX_FAILURES_STORED = 100
const failureLog: WebhookFailure[] = []
const healthWriteChains = new Map<string, Promise<void>>()

/** Legacy Baileys configs pointed at a non-existent EF; repoint to wa-webhook. */
export function normalizeJumpstartInboundWebhookUrl(webhookUrl: string): string {
  if (webhookUrl.includes('whatsapp-incoming')) {
    return webhookUrl.replace(/whatsapp-incoming/g, 'wa-webhook')
  }
  return webhookUrl
}

function isJumpstartInboundWebhookPath(url: string): boolean {
  return (
    url.includes('/functions/v1/wa-incoming') ||
    url.includes('/functions/v1/wa-webhook')
  )
}

/** Preserve the existing delivery authentication contract. */
export function buildWebhookHeaders(
  url: string,
  payload: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const orgId = typeof payload.orgId === 'string' ? payload.orgId : undefined
  if (orgId && url.includes('/functions/v1/wa-webhook')) {
    headers['x-wa-session-key'] = orgId
  }

  if (isJumpstartInboundWebhookPath(url)) {
    let hasQuerySecret = false
    try {
      hasQuerySecret = new URL(url).searchParams.has('secret')
    } catch {
      hasQuerySecret = /[?&]secret=/.test(url)
    }
    const secret = process.env.WA_INCOMING_SECRET ?? ''
    if (!hasQuerySecret && secret) {
      headers['Authorization'] = `Bearer ${secret}`
    }
  }

  return headers
}

export async function attemptPost(
  url: string,
  payload: object,
  attempt: number,
  fetchImpl: typeof fetch = fetch
): Promise<WebhookDispatchResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    const controller = new AbortController()
    timeout = setTimeout(() => controller.abort(), 10_000)

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: buildWebhookHeaders(url, payload as Record<string, unknown>),
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth_rejected'
        : 'http_rejected'
      logger.warn(
        { url: redactWebhookUrl(url), status: response.status, attempt },
        'Webhook returned non-OK status'
      )
      return {
        ok: false,
        category,
        httpStatus: response.status,
        errorCode: category,
      }
    }

    return { ok: true, category: 'ok', httpStatus: response.status, errorCode: null }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError'
    const category = timedOut ? 'timeout' : 'unreachable'
    logger.warn(
      { url: redactWebhookUrl(url), attempt, errorCode: category },
      'Webhook request failed'
    )
    return { ok: false, category, httpStatus: null, errorCode: category }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/** Post a webhook with retries; telemetry is deliberately non-blocking. */
export async function postWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
  dependencies: WebhookDispatcherDependencies = {}
): Promise<void> {
  const orgId = payload.orgId as string
  const url = normalizeJumpstartInboundWebhookUrl(webhookUrl)
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const sleep = dependencies.sleep
    ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  const writeHealth = dependencies.persistHealth ?? persistWebhookHealth
  let lastResult: WebhookDispatchResult = {
    ok: false,
    category: 'unreachable',
    httpStatus: null,
    errorCode: 'unreachable',
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    lastResult = await attemptPost(url, payload, attempt + 1, fetchImpl)
    if (lastResult.ok) {
      writeHealthWithoutBlocking(orgId, lastResult, writeHealth)
      logger.debug({ orgId, event: payload.event }, 'Webhook delivered')
      return
    }
    if (attempt < MAX_RETRIES - 1) await sleep(RETRY_DELAYS[attempt])
  }

  const failure: WebhookFailure = {
    orgId,
    url: redactWebhookUrl(url),
    attempts: MAX_RETRIES,
    category: lastResult.category as Exclude<WebhookDispatchCategory, 'ok'>,
    httpStatus: lastResult.httpStatus,
    errorCode: lastResult.errorCode ?? 'unknown_failure',
    timestamp: new Date().toISOString(),
  }
  failureLog.push(failure)
  if (failureLog.length > MAX_FAILURES_STORED) failureLog.shift()

  writeHealthWithoutBlocking(orgId, lastResult, writeHealth)
  logger.error(
    {
      orgId,
      url: failure.url,
      category: failure.category,
      status: failure.httpStatus,
    },
    'Webhook delivery failed after all retries'
  )
}

function writeHealthWithoutBlocking(
  sessionKey: string,
  result: WebhookDispatchResult,
  writer: typeof persistWebhookHealth
): void {
  const previous = healthWriteChains.get(sessionKey) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => writer(sessionKey, result))
  healthWriteChains.set(sessionKey, next)
  void next
    .catch((err) => {
      logger.warn(
        { sessionKey, err: err instanceof Error ? err.message : 'unknown_error' },
        'Webhook health writer rejected'
      )
    })
    .finally(() => {
      if (healthWriteChains.get(sessionKey) === next) healthWriteChains.delete(sessionKey)
    })
}

export function getWebhookFailures(orgId?: string): WebhookFailure[] {
  if (orgId) return failureLog.filter((failure) => failure.orgId === orgId)
  return [...failureLog]
}

export function clearWebhookFailures(orgId: string): number {
  const before = failureLog.length
  const keep = failureLog.filter((failure) => failure.orgId !== orgId)
  failureLog.length = 0
  failureLog.push(...keep)
  return before - failureLog.length
}

export function rekeyWebhookFailures(fromOrgId: string, toOrgId: string): void {
  if (fromOrgId === toOrgId) return
  for (const failure of failureLog) {
    if (failure.orgId === fromOrgId) failure.orgId = toOrgId
  }
}
