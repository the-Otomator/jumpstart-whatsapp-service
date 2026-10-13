import { lookupWhatsappDevice } from './supabase'
import { jumpstartSupabase } from './jumpstartSupabase'
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
  jumpstart?: { from: (table: string) => any } | null
}

/** Hub routing first, exact JumpStart registry next, legacy disk metadata last. */
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
  const jumpstart = options.jumpstart === undefined ? jumpstartSupabase : options.jumpstart
  if (jumpstart) {
    const { data, error } = await jumpstart.from('wa_devices')
      .select('id, organization_id, status, webhook_secret').eq('session_key', sessionKey).limit(2)
    if (error || !Array.isArray(data) || data.length > 1) throw new Error('WEBHOOK_DEVICE_LOOKUP_FAILED')
    if (data.length === 1) {
      const row = data[0]
      if (!row.id || !row.organization_id || row.status === 'revoked') throw new Error('WEBHOOK_DEVICE_UNAVAILABLE')
      setSessionWebhookSecret(sessionKey, row.webhook_secret)
      const base = process.env.JUMPSTART_SUPABASE_URL ?? 'https://dgxnnwnugdxzeopleera.supabase.co'
      return new URL('/functions/v1/wa-webhook', base).href
    }
  }
  const metaValue = (options.loadMeta ?? loadSessionMeta)(sessionKey)?.webhookUrl
  return isValidWebhookUrl(metaValue) ? metaValue.trim() : undefined
}
