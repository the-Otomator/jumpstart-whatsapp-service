import { observeWaDevice } from './waDeviceLiveness'
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
  try {
    const {error} = await observeWaDevice(sessionKey, {status, refreshSeen: status === 'connected',
      phoneNumber: status === 'connected' && opts?.phoneNumber ? opts.phoneNumber : undefined, lastError: opts?.lastError, clearError: status !== 'disconnected'})
    if (error) throw error
  } catch (err) {
    logger.warn({sessionKey, status, err}, 'Error writing wa_devices status')
  }
}
