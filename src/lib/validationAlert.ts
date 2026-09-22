import { logger } from './logger'
import * as waDeviceMonitor from './waDeviceMonitor'

const DEFAULT_ALERT_MS = 1_800_000

let orgValidationFailures = 0
let lastOrgValidationError: string | null = null
let lastOrgValidationErrorAt: string | null = null

/** Last alert send time per error code (in-memory throttle). */
const lastAlertAtByCode = new Map<string, number>()

type AlertSendFn = (args: {
  orgId: string
  to: string
  type: 'text'
  message: string
}) => Promise<unknown>

/** Test seam — when set, used instead of routes/messages.sendWhatsAppMessage. */
let alertSendOverride: AlertSendFn | null = null

export function __setValidationAlertSendForTests(fn: AlertSendFn | null): void {
  alertSendOverride = fn
}

export function getOrgValidationFailures(): number {
  return orgValidationFailures
}

export function getLastOrgValidationError(): string | null {
  return lastOrgValidationError
}

export function getLastOrgValidationErrorAt(): string | null {
  return lastOrgValidationErrorAt
}

export function resetOrgValidationAlertStateForTests(): void {
  orgValidationFailures = 0
  lastOrgValidationError = null
  lastOrgValidationErrorAt = null
  lastAlertAtByCode.clear()
  alertSendOverride = null
}

function alertThrottleMs(): number {
  const raw = Number(process.env.WA_VALIDATION_ALERT_MS ?? DEFAULT_ALERT_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_ALERT_MS
}

export function extractValidationErrorCode(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    const colon = error.indexOf(':')
    return colon > 0 ? error.slice(0, colon).trim() : error.trim()
  }
  if (error instanceof Error && error.message.trim()) {
    const msg = error.message.trim()
    const colon = msg.indexOf(':')
    return colon > 0 ? msg.slice(0, colon).trim() : msg
  }
  return 'ORG_VALIDATION_ERROR'
}

function formatErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'unknown error'
}

/**
 * Record an org-validation `unavailable` outcome and optionally WhatsApp-alert.
 * Never throws.
 */
export async function recordOrgValidationFailure(
  orgId: string,
  error: unknown
): Promise<void> {
  try {
    const message = formatErrorMessage(error)
    const code = extractValidationErrorCode(error)
    orgValidationFailures += 1
    lastOrgValidationError = message
    lastOrgValidationErrorAt = new Date().toISOString()

    if (!waDeviceMonitor.alertsEnabled()) return

    const now = Date.now()
    const last = lastAlertAtByCode.get(code) ?? 0
    if (now - last < alertThrottleMs()) return

    // Mark throttle before send so concurrent/repeat failures in-window do not double-alert.
    lastAlertAtByCode.set(code, now)

    const sender = await waDeviceMonitor.resolveAlertSender()
    if (!sender) {
      logger.warn(
        { orgId, code },
        'Org validation alert suppressed — no healthy alerting session'
      )
      return
    }

    const text =
      `⚠️ WA service: אימות ארגון נכשל — ${orgId} — ${message}. חיבור מכשירים חסום.`

    const send =
      alertSendOverride ??
      (async (args) => {
        const { sendWhatsAppMessage } = await import('../routes/messages')
        return sendWhatsAppMessage(args)
      })

    await send({
      orgId: sender,
      to: waDeviceMonitor.getAlertToPhone(),
      type: 'text',
      message: text,
    })
    logger.info({ orgId, code, sender }, 'Org validation failure alert sent')
  } catch (err) {
    logger.warn({ err, orgId }, 'Failed to record/send org validation alert')
  }
}
