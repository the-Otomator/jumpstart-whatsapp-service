import { observeWaDevice } from './waDeviceLiveness'
import { logger } from './logger'

export type WebhookHealthStatus =
  | 'ok'
  | 'invalid_config'
  | 'missing_meta'
  | 'auth_rejected'
  | 'http_rejected'
  | 'unreachable'
  | 'timeout'

export interface WebhookHealthResult {
  category: WebhookHealthStatus
  httpStatus: number | null
  errorCode: string | null
}

/** Sampled operational telemetry; no per-delivery read/modify/write. */
export async function persistWebhookHealth(sessionKey: string, result: WebhookHealthResult, _observedAt?: string): Promise<void> {
  if (!sessionKey) return
  try {
    const {error} = await observeWaDevice(sessionKey, {refreshSeen: false, audit: {
      category: result.category, http_status: result.httpStatus, error_code: result.errorCode,
    }})
    if (error) throw error
  } catch (err) {
    logger.warn({sessionKey, err: err instanceof Error ? err.message : 'unknown_error'}, 'Webhook health persistence failed')
  }
}
