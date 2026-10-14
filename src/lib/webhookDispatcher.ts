import { logger } from './logger'
import { redactWebhookUrl } from './webhookUrl'
import { persistWebhookHealth, type WebhookHealthResult } from './webhookHealth'
import { isIP } from 'net'

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
const sessionWebhookSecrets = new Map<string, string>()
const legacySecretWarnings = new Set<string>()
const SAFE_REJECT_REASONS = new Set([
  'bad json', 'missing message', 'missing sender', 'group message missing groupId',
  'unknown session key', 'unauthorized', 'missing x-wa-session-key header',
])

function safeWebhookEvent(payload: Record<string, unknown>): string {
  const event = payload.event
  return typeof event === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(event)
    ? event : 'unknown'
}
const DEFAULT_WEBHOOK_SECRET_ALLOWED_HOSTS = [
  'api.jumpstart.co.il',
  'dgxnnwnugdxzeopleera.supabase.co',
]

function webhookSecretAllowedHosts(): Set<string> {
  const configured = process.env.WEBHOOK_SECRET_ALLOWED_HOSTS
  return new Set((configured ? configured.split(',') : DEFAULT_WEBHOOK_SECRET_ALLOWED_HOSTS)
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [a, b] = octets
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0
}

/** Validate caller-controlled outbound targets before any fetch or secret attachment. */
export function assertSafeOutboundUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('OUTBOUND_URL_INVALID')
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('OUTBOUND_URL_UNSAFE')
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const ipVersion = isIP(hostname)
  const blockedName = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.local')
  const blockedIpv4 = ipVersion === 4 && isPrivateIpv4(hostname)
  const blockedIpv6 = ipVersion === 6 && (
    hostname === '::1'
    || hostname === '::'
    || hostname.startsWith('::ffff:')
    || /^f[cd][0-9a-f]{2}:/i.test(hostname)
    || /^fe[89ab][0-9a-f]:/i.test(hostname)
  )

  if (blockedName || blockedIpv4 || blockedIpv6) {
    throw new Error('OUTBOUND_URL_UNSAFE')
  }
  return parsed
}

function mayAttachWebhookSecret(url: URL): boolean {
  return webhookSecretAllowedHosts().has(url.host.toLowerCase())
}

/** Keep the registry-only credential in memory; never persist it in session meta. */
export function setSessionWebhookSecret(sessionKey: string, secret: unknown): void {
  if (typeof secret === 'string' && secret.length > 0) {
    sessionWebhookSecrets.set(sessionKey, secret)
    return
  }
  clearSessionWebhookSecret(sessionKey)
}

export function clearSessionWebhookSecret(sessionKey: string): void {
  sessionWebhookSecrets.delete(sessionKey)
  legacySecretWarnings.delete(sessionKey)
}

/** Assemble the dispatch-only URL. The stored column always replaces a legacy query value. */
export function appendWebhookSecret(webhookUrl: string, webhookSecret: string): string {
  const assembled = new URL(webhookUrl)
  assembled.searchParams.set('secret', webhookSecret)
  return assembled.toString()
}

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

/**
 * Preserve the existing delivery authentication contract.
 *
 * `payload.orgId` is the VPS session identity — the same string CRM stores as
 * `wa_devices.session_key` and passes to `POST /api/sessions/:orgId/start`.
 * It is the organization UUID only for legacy single-device orgs. Multi-device
 * orgs use `<org>__<device8>` or `<org>-<rand8>`. Never substitute the bare
 * organization UUID here: `wa-webhook` exact-matches `session_key` first.
 */
export function buildWebhookHeaders(
  url: string,
  payload: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const parsed = assertSafeOutboundUrl(url)
  const sessionKey = typeof payload.orgId === 'string' ? payload.orgId : undefined
  if (sessionKey && url.includes('/functions/v1/wa-webhook')) {
    headers['x-wa-session-key'] = sessionKey
  }

  if (isJumpstartInboundWebhookPath(url) && mayAttachWebhookSecret(parsed)) {
    const hasQuerySecret = parsed.searchParams.has('secret')
    const secret = process.env.WA_INCOMING_SECRET ?? ''
    if (!hasQuerySecret && secret) {
      headers['Authorization'] = `Bearer ${secret}`
      headers['x-webhook-secret'] = secret
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
    assertSafeOutboundUrl(url)

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: buildWebhookHeaders(url, payload as Record<string, unknown>),
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error',
    })

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth_rejected'
        : 'http_rejected'
      // Never log arbitrary response text: upstream errors can contain user data.
      let reason = category
      if (response.status === 400) {
        try {
          const body = await response.json() as { error?: unknown }
          if (typeof body.error === 'string' && SAFE_REJECT_REASONS.has(body.error)) {
            reason = body.error
          }
        } catch { /* non-JSON response */ }
      }
      logger.warn(
        { url: redactWebhookUrl(url), status: response.status, attempt,
          event: safeWebhookEvent(payload as Record<string, unknown>), reason },
        'Webhook returned non-OK status'
      )
      return {
        ok: false,
        category,
        httpStatus: response.status,
        errorCode: reason,
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
  const normalizedUrl = normalizeJumpstartInboundWebhookUrl(webhookUrl)
  const parsedUrl = assertSafeOutboundUrl(normalizedUrl)
  const secretHostAllowed = mayAttachWebhookSecret(parsedUrl)
  if (!secretHostAllowed) parsedUrl.searchParams.delete('secret')
  const webhookSecret = sessionWebhookSecrets.get(orgId)
  let url = parsedUrl.toString()
  if (webhookSecret && secretHostAllowed) {
    const alreadyHasSecret = parsedUrl.searchParams.has('secret')
    url = appendWebhookSecret(url, webhookSecret)
    if (alreadyHasSecret && !legacySecretWarnings.has(orgId)) {
      legacySecretWarnings.add(orgId)
      logger.warn(
        { orgId, url: redactWebhookUrl(url) },
        'Registry webhook_secret overrides legacy secret query parameter'
      )
    }
  }
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
      event: safeWebhookEvent(payload),
      reason: failure.errorCode,
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
