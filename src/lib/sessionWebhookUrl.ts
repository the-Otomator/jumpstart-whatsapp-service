import { lookupWhatsappDevice } from './supabase'
import { loadSessionMeta } from './sessionStore'
import { isValidWebhookUrl } from './webhookUrl'
import {
  clearSessionWebhookSecret,
  setSessionWebhookSecret,
} from './webhookDispatcher'

export interface ResolveSessionWebhookOptions {
  /** Prefetched by validateOrg so the connect route does not query the device twice. */
  deviceWebhookUrl?: unknown
  deviceWebhookSecret?: unknown
  lookupDevice?: typeof lookupWhatsappDevice
  loadMeta?: typeof loadSessionMeta
}

/** Resolve server-owned webhook routing: device registry first, legacy disk meta second. */
export async function resolveSessionWebhookUrl(
  sessionKey: string,
  options: ResolveSessionWebhookOptions = {}
): Promise<string | undefined> {
  const hasPrefetchedDeviceValue = Object.prototype.hasOwnProperty.call(
    options,
    'deviceWebhookUrl'
  )
  const device = hasPrefetchedDeviceValue
    ? {
        webhookUrl: options.deviceWebhookUrl,
        webhookSecret: options.deviceWebhookSecret,
      }
    : await (options.lookupDevice ?? lookupWhatsappDevice)(sessionKey)

  if (isValidWebhookUrl(device.webhookUrl)) {
    setSessionWebhookSecret(sessionKey, device.webhookSecret)
    return device.webhookUrl.trim()
  }

  clearSessionWebhookSecret(sessionKey)
  const metaValue = (options.loadMeta ?? loadSessionMeta)(sessionKey)?.webhookUrl
  return isValidWebhookUrl(metaValue) ? metaValue.trim() : undefined
}
