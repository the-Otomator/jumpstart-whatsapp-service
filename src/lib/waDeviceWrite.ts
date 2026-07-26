import { jumpstartSupabase } from './jumpstartSupabase'
import { logger } from './logger'

/**
 * Immediate write to Jumpstart `wa_devices` on connect / QR / disconnect.
 * Never throws.
 */
export async function writeWaDeviceStatus(
  sessionKey: string,
  status: 'connected' | 'disconnected' | 'qr',
  opts?: { phoneNumber?: string | null; lastError?: string | null }
): Promise<void> {
  if (!jumpstartSupabase) return

  try {
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      status,
      updated_at: now,
    }

    if (status === 'connected') {
      patch.last_seen_at = now
      patch.last_error = null
      if (opts?.phoneNumber) patch.phone_number = opts.phoneNumber
    } else if (status === 'qr') {
      patch.last_error = null
    } else if (opts?.lastError != null) {
      patch.last_error = opts.lastError
    }

    const { error } = await jumpstartSupabase
      .from('wa_devices')
      .update(patch)
      .eq('session_key', sessionKey)

    if (error) {
      logger.warn(
        { sessionKey, status, err: error.message },
        'Failed to write wa_devices status'
      )
    }
  } catch (err) {
    logger.warn({ sessionKey, status, err }, 'Error writing wa_devices status')
  }
}
