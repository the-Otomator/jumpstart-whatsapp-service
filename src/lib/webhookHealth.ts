import { jumpstartSupabase } from './jumpstartSupabase'
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

/** Best-effort durable health; only fixed classifications are persisted. */
export async function persistWebhookHealth(
  sessionKey: string,
  result: WebhookHealthResult,
  observedAt = new Date().toISOString()
): Promise<void> {
  if (!jumpstartSupabase || !sessionKey) return

  try {
    if (result.category === 'ok') {
      const { error } = await jumpstartSupabase
        .from('wa_devices')
        .update({
          webhook_audit_status: 'ok',
          webhook_last_audited_at: observedAt,
          webhook_last_success_at: observedAt,
          webhook_last_failure_code: null,
          webhook_last_http_status: result.httpStatus,
          webhook_consecutive_failures: 0,
        })
        .eq('session_key', sessionKey)
      if (error) throw new Error(error.message)
      return
    }

    const { data, error: readError } = await jumpstartSupabase
      .from('wa_devices')
      .select('webhook_consecutive_failures')
      .eq('session_key', sessionKey)
      .maybeSingle()
    if (readError) throw new Error(readError.message)

    const previous = Number(data?.webhook_consecutive_failures ?? 0)
    const consecutiveFailures = Number.isSafeInteger(previous) && previous >= 0
      ? previous + 1
      : 1
    const { error } = await jumpstartSupabase
      .from('wa_devices')
      .update({
        webhook_audit_status: result.category,
        webhook_last_audited_at: observedAt,
        webhook_last_failure_at: observedAt,
        webhook_last_failure_code: result.errorCode,
        webhook_last_http_status: result.httpStatus,
        webhook_consecutive_failures: consecutiveFailures,
      })
      .eq('session_key', sessionKey)
    if (error) throw new Error(error.message)
  } catch (err) {
    logger.warn(
      { sessionKey, err: err instanceof Error ? err.message : 'unknown_error' },
      'Webhook health persistence failed'
    )
  }
}
