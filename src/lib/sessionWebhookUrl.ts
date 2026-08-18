import { getDeviceWebhookUrl } from './supabase'
import { loadSessionMeta } from './sessionStore'
import { isValidWebhookUrl } from './webhookUrl'

export interface ResolveSessionWebhookOptions {
  /** Prefetched by validateOrg so the connect route does not query the device twice. */
  deviceWebhookUrl?: unknown
  lookupDeviceWebhookUrl?: typeof getDeviceWebhookUrl
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
  const registryValue = hasPrefetchedDeviceValue
    ? options.deviceWebhookUrl
    : await (options.lookupDeviceWebhookUrl ?? getDeviceWebhookUrl)(sessionKey)

  if (isValidWebhookUrl(registryValue)) return registryValue.trim()

  const metaValue = (options.loadMeta ?? loadSessionMeta)(sessionKey)?.webhookUrl
  return isValidWebhookUrl(metaValue) ? metaValue.trim() : undefined
}
