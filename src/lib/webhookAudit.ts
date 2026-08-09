import { randomUUID } from 'crypto'
import { listStoredSessions, loadSessionMeta } from './sessionStore'
import { logger } from './logger'
import { attemptPost, normalizeJumpstartInboundWebhookUrl } from './webhookDispatcher'
import { persistWebhookHealth, type WebhookHealthResult } from './webhookHealth'

const DEFAULT_INTERVAL_MS = 15 * 60_000
const JITTER_RATIO = 0.1

let timer: ReturnType<typeof setInterval> | null = null
let running = false

interface WebhookAuditDependencies {
  listSessions?: typeof listStoredSessions
  loadMeta?: typeof loadSessionMeta
  attempt?: typeof attemptPost
  persist?: typeof persistWebhookHealth
  probeId?: () => string
}

function auditEnabled(): boolean {
  const value = (process.env.WA_WEBHOOK_AUDIT_ENABLED ?? 'off').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on' || value === 'yes'
}

function configuredIntervalMs(): number {
  const configured = Number(process.env.WA_WEBHOOK_AUDIT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MS
}

function auditIntervalWithJitter(baseMs: number): number {
  const factor = 1 + ((Math.random() * 2) - 1) * JITTER_RATIO
  return Math.max(1_000, Math.round(baseMs * factor))
}

function invalidConfig(
  category: 'invalid_config' | 'missing_meta',
  errorCode: string
): WebhookHealthResult {
  return { category, httpStatus: null, errorCode }
}

export async function runWebhookAudit(
  dependencies: WebhookAuditDependencies = {}
): Promise<void> {
  if (running) {
    logger.warn('Skipping overlapping webhook audit')
    return
  }
  running = true
  const listSessions = dependencies.listSessions ?? listStoredSessions
  const loadMeta = dependencies.loadMeta ?? loadSessionMeta
  const probe = dependencies.attempt ?? attemptPost
  const persist = dependencies.persist ?? persistWebhookHealth
  const createProbeId = dependencies.probeId ?? randomUUID
  try {
    for (const sessionKey of listSessions()) {
      const meta = loadMeta(sessionKey)
      if (!meta) {
        await persist(sessionKey, invalidConfig('missing_meta', 'missing_meta'))
        continue
      }

      let parsed: URL
      try {
        parsed = new URL(meta.webhookUrl ?? '')
      } catch {
        await persist(sessionKey, invalidConfig('invalid_config', 'invalid_url'))
        continue
      }
      if (parsed.protocol !== 'https:') {
        await persist(sessionKey, invalidConfig('invalid_config', 'non_https_url'))
        continue
      }
      if (parsed.searchParams.has('secret')) {
        await persist(sessionKey, invalidConfig('invalid_config', 'legacy_query_secret'))
        continue
      }

      const result = await probe(
        normalizeJumpstartInboundWebhookUrl(parsed.toString()),
        { event: 'webhook.probe', orgId: sessionKey, probeId: createProbeId() },
        1
      )
      await persist(sessionKey, result)
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown_error' },
      'Webhook audit pass failed'
    )
  } finally {
    running = false
  }
}

export function startWebhookAudit(): void {
  if (timer || !auditEnabled()) return
  const intervalMs = auditIntervalWithJitter(configuredIntervalMs())
  logger.info({ intervalMs }, 'Starting webhook configuration and auth audit')
  timer = setInterval(() => {
    void runWebhookAudit()
  }, intervalMs)
  if (typeof timer === 'object' && 'unref' in timer) {
    ;(timer as NodeJS.Timeout).unref()
  }
}

export function stopWebhookAudit(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
