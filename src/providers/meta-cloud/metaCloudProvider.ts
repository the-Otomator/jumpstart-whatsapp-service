import type { WhatsAppProvider, SendResult, ProviderType } from '../types'
import type { Session, SendMessageRequest } from '../../types'
import { postWebhook } from '../../lib/webhookDispatcher'
import { saveSessionMeta, loadSessionMeta, deleteSessionMeta, listStoredSessions, updateSessionMeta } from '../../lib/sessionStore'
import { logger, orgLogger } from '../../lib/logger'
import { jumpstartSupabase } from '../../lib/jumpstartSupabase'
import { OFFICIAL_OTP_SESSION, isOfficialOtp } from '../../lib/officialOtp'
import {
  requireWebhookUrl,
  WEBHOOK_URL_REQUIRED,
} from '../../lib/webhookUrl'
import { resolveSessionWebhookUrl } from '../../lib/sessionWebhookUrl'

interface MetaCloudConfig {
  accessToken: string
  phoneNumberId: string
  wabaId: string
  webhookUrl?: string
}

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export class MetaCloudProvider implements WhatsAppProvider {
  readonly type: ProviderType = 'meta-cloud'

  private sessions = new Map<string, Session>()
  private configs = new Map<string, MetaCloudConfig>()

  /** Recover only the pinned platform sender from its existing registry secret. */
  async recoverOfficialOtpSession(signal: AbortSignal): Promise<void> {
    if (this.sessions.get(OFFICIAL_OTP_SESSION)?.status === 'connected' && this.configs.has(OFFICIAL_OTP_SESSION)) return
    if (!jumpstartSupabase) throw new Error('Official OTP registry unavailable')
    const accountId = '1f63d665-b065-49c7-ad04-92427cfb7265'
    const { data: account, error: accountError } = await jumpstartSupabase.from('wa_meta_accounts')
      .select('id, phone_number_id, waba_id, display_phone_number')
      .eq('id', accountId).eq('status', 'connected').eq('token_health', 'healthy')
      .is('sending_paused_at', null).abortSignal(signal).maybeSingle()
    if (accountError || !account?.phone_number_id || String(account.display_phone_number).replace(/\D/g, '') !== '972555040363') {
      throw new Error('Official OTP account unavailable')
    }
    const { data: secret, error: secretError } = await jumpstartSupabase.from('wa_meta_secrets')
      .select('access_token').eq('account_id', accountId).abortSignal(signal).maybeSingle()
    if (secretError || !secret?.access_token) throw new Error('Official OTP registry token unavailable')
    const webhookUrl = requireWebhookUrl(await resolveSessionWebhookUrl(OFFICIAL_OTP_SESSION))
    signal.throwIfAborted()
    const response = await fetch(`${GRAPH_API_BASE}/${account.phone_number_id}`, {
      headers: { Authorization: `Bearer ${secret.access_token}` }, signal,
    })
    if (!response.ok) throw new Error(`Official OTP Meta validation failed: ${response.status}`)
    const info = await response.json() as { display_phone_number?: string }
    if (info.display_phone_number?.replace(/\D/g, '') !== '972555040363') throw new Error('Official OTP sender mismatch')
    signal.throwIfAborted()
    this.configs.set(OFFICIAL_OTP_SESSION, { accessToken: secret.access_token,
      phoneNumberId: account.phone_number_id, wabaId: account.waba_id, webhookUrl })
    this.sessions.set(OFFICIAL_OTP_SESSION, { orgId: OFFICIAL_OTP_SESSION, provider: 'meta-cloud',
      status: 'connected', phoneNumber: '972555040363', webhookUrl })
    saveSessionMeta({ orgId: OFFICIAL_OTP_SESSION, provider: 'meta-cloud', autoRestore: true,
      webhookUrl, createdAt: new Date().toISOString(), lastConnected: new Date().toISOString(),
      phoneNumber: '972555040363', metaPhoneNumberId: account.phone_number_id,
      metaWabaId: account.waba_id, metaAccessToken: secret.access_token })
    orgLogger(OFFICIAL_OTP_SESSION).info('Recovered official OTP Meta session from registry')
  }

  async start(orgId: string, webhookUrl?: string, config?: Partial<MetaCloudConfig>): Promise<void> {
    const log = orgLogger(orgId)
    const resolvedWebhookUrl = requireWebhookUrl(webhookUrl)

    // Use provided config or fall back to environment defaults
    const accessToken = config?.accessToken ?? process.env.META_CLOUD_API_ACCESS_TOKEN
    const phoneNumberId = config?.phoneNumberId ?? process.env.META_CLOUD_API_PHONE_NUMBER_ID
    const wabaId = config?.wabaId ?? process.env.META_CLOUD_API_WABA_ID

    if (!accessToken || !phoneNumberId) {
      throw new Error('Meta Cloud API requires accessToken and phoneNumberId')
    }

    const metaConfig: MetaCloudConfig = {
      accessToken,
      phoneNumberId,
      wabaId: wabaId ?? '',
      webhookUrl: resolvedWebhookUrl,
    }

    // Validate the token by fetching phone number info
    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meta Cloud API token validation failed: ${res.status} ${body}`)
    }

    const phoneInfo = await res.json() as { display_phone_number?: string; verified_name?: string }

    const session: Session = {
      orgId,
      provider: 'meta-cloud',
      status: 'connected',  // Meta Cloud is immediately connected (no QR)
      phoneNumber: phoneInfo.display_phone_number?.replace(/[^0-9]/g, ''),
      webhookUrl: resolvedWebhookUrl,
      lastError: undefined,
    }

    this.sessions.set(orgId, session)
    this.configs.set(orgId, metaConfig)

    // Persist metadata for auto-restore
    saveSessionMeta({
      orgId,
      provider: 'meta-cloud',
      webhookUrl: resolvedWebhookUrl,
      createdAt: new Date().toISOString(),
      phoneNumber: session.phoneNumber,
      lastConnected: new Date().toISOString(),
      autoRestore: true,
      metaPhoneNumberId: phoneNumberId,
      metaAccessToken: accessToken,
      metaWabaId: wabaId ?? '',
    })

    log.info({ phone: session.phoneNumber, phoneNumberId }, 'Meta Cloud session started')

    await postWebhook(resolvedWebhookUrl, { event: 'connected', orgId, phone: session.phoneNumber, provider: 'meta-cloud' })
  }

  stop(orgId: string, options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }): void {
    const log = orgLogger(orgId)
    this.sessions.delete(orgId)
    this.configs.delete(orgId)

    if (!options?.keepAuthFiles) {
      deleteSessionMeta(orgId)
    }

    log.info('Meta Cloud session stopped')
  }

  getStatus(orgId: string): Session | undefined {
    return this.sessions.get(orgId)
  }

  getQR(_orgId: string): string | undefined {
    return undefined  // Meta Cloud doesn't use QR
  }

  async sendMessage(req: SendMessageRequest): Promise<SendResult> {
    const config = this.configs.get(req.orgId)
    if (!config) throw new Error(`Session ${req.orgId} not connected (meta-cloud)`)

    const payload = this.buildPayload(req)

    const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(isOfficialOtp(req) ? `Official OTP Meta send failed: ${res.status}` : `Meta Cloud API send failed: ${res.status} ${body}`)
    }

    const result = await res.json() as { messages?: Array<{ id: string }> }
    const messageId = result.messages?.[0]?.id ?? ''
    if (isOfficialOtp(req) && !messageId) throw new Error('Official OTP Meta response missing message ID')

    return { messageId }
  }

  listActiveSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  updateWebhookUrl(orgId: string, webhookUrl: string): { previous: string | undefined; next: string } {
    const resolved = requireWebhookUrl(webhookUrl)
    const session = this.sessions.get(orgId)
    if (!session) {
      throw new Error(`Session ${orgId} not found`)
    }
    const previous = session.webhookUrl
    session.webhookUrl = resolved
    session.lastError = undefined
    const config = this.configs.get(orgId)
    if (config) config.webhookUrl = resolved
    updateSessionMeta(orgId, { webhookUrl: resolved })
    return { previous, next: resolved }
  }

  async restoreSessions(): Promise<void> {
    const orgIds = listStoredSessions()
    for (const orgId of orgIds) {
      const meta = loadSessionMeta(orgId)
      if (!meta || meta.provider !== 'meta-cloud') continue

      const webhookUrl = await resolveSessionWebhookUrl(orgId)
      if (!webhookUrl) {
        const lastError = `${WEBHOOK_URL_REQUIRED}: registry and persisted meta have no usable webhookUrl`
        logger.error({ orgId }, 'Skipping Meta Cloud restore: no usable webhookUrl')
        this.sessions.set(orgId, {
          orgId,
          provider: 'meta-cloud',
          status: 'disconnected',
          lastError,
        })
        continue
      }

      try {
        await this.start(orgId, webhookUrl, {
          accessToken: meta.metaAccessToken,
          phoneNumberId: meta.metaPhoneNumberId,
          wabaId: meta.metaWabaId,
        })
        logger.info({ orgId }, 'Meta Cloud session restored')
      } catch (err) {
        logger.error({ orgId, err }, 'Failed to restore Meta Cloud session')
      }
    }
  }

  // ── Payload builders ──────────────────────────────────────────

  private buildPayload(req: SendMessageRequest): Record<string, unknown> {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhone(req.to),
    }

    switch (req.type) {
      case 'text':
        return { ...base, type: 'text', text: { preview_url: false, body: req.message ?? '' } }

      case 'image':
        return { ...base, type: 'image', image: { link: req.mediaUrl, caption: req.message } }

      case 'video':
        return { ...base, type: 'video', video: { link: req.mediaUrl, caption: req.message } }

      case 'audio':
        return { ...base, type: 'audio', audio: { link: req.mediaUrl } }

      case 'document':
        return { ...base, type: 'document', document: { link: req.mediaUrl, caption: req.message, filename: req.filename ?? 'document' } }

      case 'location':
        return { ...base, type: 'location', location: { latitude: req.latitude, longitude: req.longitude } }

      case 'contact':
        return {
          ...base,
          type: 'contacts',
          contacts: [{
            name: { formatted_name: req.contactName },
            phones: [{ phone: req.contactPhone, type: 'CELL' }],
          }],
        }

      case 'template':
        if (!req.template) throw new Error('Template field is required for type "template"')
        return {
          ...base,
          type: 'template',
          template: {
            name: req.template.name,
            language: { code: req.template.language },
            components: req.template.components ?? [],
          },
        }

      default:
        return { ...base, type: 'text', text: { body: req.message ?? '' } }
    }
  }

  /** Format phone to E.164 (with +). Meta expects the + prefix. */
  private formatPhone(phone: string): string {
    const clean = phone.replace(/[^0-9]/g, '')
    return clean.startsWith('+') ? clean : `+${clean}`
  }

  // ── Incoming webhook handler (called from route) ──────────────

  async handleIncomingWebhook(body: any): Promise<void> {
    if (!body?.entry) return

    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        if (!value?.messages && !value?.statuses) continue

        const phoneNumberId = value.metadata?.phone_number_id

        // Find the org that owns this phone number
        let targetOrgId: string | undefined
        let targetWebhookUrl: string | undefined

        for (const [orgId, config] of this.configs.entries()) {
          if (config.phoneNumberId === phoneNumberId) {
            targetOrgId = orgId
            targetWebhookUrl = config.webhookUrl
            break
          }
        }

        if (!targetOrgId) {
          logger.warn({ phoneNumberId }, 'Incoming Meta webhook for unknown phone number ID')
          continue
        }

        for (const msg of value.messages ?? []) {
          const payload: Record<string, unknown> = {
            event: 'message',
            orgId: targetOrgId,
            provider: 'meta-cloud',
            messageId: msg.id ?? '',
            from: msg.from ?? '',
            fromName: value.contacts?.[0]?.profile?.name ?? '',
            message: msg.text?.body ?? msg.caption ?? '',
            timestamp: msg.timestamp ? Number(msg.timestamp) : Math.floor(Date.now() / 1000),
            isGroup: false,  // Cloud API doesn't support groups the same way
          }

          if (msg.type && msg.type !== 'text') {
            payload.mediaType = msg.type
          }

          if (targetWebhookUrl) {
            await postWebhook(targetWebhookUrl, payload)
          }
        }

        // Handle status updates
        for (const status of value.statuses ?? []) {
          const statusMap: Record<string, string> = {
            sent: 'sent',
            delivered: 'delivered',
            read: 'read',
            failed: 'failed',
          }
          const mappedStatus = statusMap[status.status]
          if (!mappedStatus) continue

          const payload = {
            event: 'message_status',
            orgId: targetOrgId,
            provider: 'meta-cloud',
            messageId: status.id ?? '',
            status: mappedStatus,
            to: status.recipient_id ?? '',
          }

          if (targetWebhookUrl) {
            await postWebhook(targetWebhookUrl, payload)
          }
        }
      }
    }
  }
}
