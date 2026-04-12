import { logger } from './logger'

interface WebhookFailure {
  orgId: string
  url: string
  payload: object
  attempts: number
  lastError: string
  timestamp: string
}

const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 15000] // exponential-ish backoff
const MAX_FAILURES_STORED = 100

/** In-memory queue of recent webhook failures (per org) */
const failureLog: WebhookFailure[] = []

async function attemptPost(url: string, payload: object, attempt: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      logger.warn({ url, status: res.status, attempt }, 'Webhook returned non-OK status')
      return false
    }

    return true
  } catch (err) {
    logger.warn({ url, attempt, err: (err as Error).message }, 'Webhook request failed')
    return false
  }
}

/** Post a webhook with retry logic */
export async function postWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const orgId = payload.orgId as string

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const success = await attemptPost(webhookUrl, payload, attempt + 1)
    if (success) {
      logger.debug({ orgId, event: (payload as Record<string, unknown>).event }, 'Webhook delivered')
      return
    }

    // Wait before retry (except on last attempt)
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }

  // All retries exhausted — log failure
  const failure: WebhookFailure = {
    orgId,
    url: webhookUrl,
    payload,
    attempts: MAX_RETRIES,
    lastError: 'All retry attempts exhausted',
    timestamp: new Date().toISOString(),
  }

  failureLog.push(failure)
  if (failureLog.length > MAX_FAILURES_STORED) failureLog.shift()

  logger.error({ orgId, url: webhookUrl }, 'Webhook delivery failed after all retries')
}

/** Get recent webhook failures (optionally filtered by orgId) */
export function getWebhookFailures(orgId?: string): WebhookFailure[] {
  if (orgId) return failureLog.filter((f) => f.orgId === orgId)
  return [...failureLog]
}

/** Clear failures for an org */
export function clearWebhookFailures(orgId: string): number {
  const before = failureLog.length
  const keep = failureLog.filter((f) => f.orgId !== orgId)
  failureLog.length = 0
  failureLog.push(...keep)
  return before - failureLog.length
}

/** Point stored failure rows at the new org after session migrate */
export function rekeyWebhookFailures(fromOrgId: string, toOrgId: string): void {
  if (fromOrgId === toOrgId) return
  for (const f of failureLog) {
    if (f.orgId === fromOrgId) f.orgId = toOrgId
  }
}
