import type { WhatsAppProvider, SendResult, ProviderType } from '../types'
import type { Session, SendMessageRequest } from '../../types'
import { postWebhook } from '../../lib/webhookDispatcher'
import { saveSessionMeta, loadSessionMeta, deleteSessionMeta, listStoredSessions } from '../../lib/sessionStore'
import { logger, orgLogger } from '../../lib/logger'

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

  async start(orgId: string, webhookUrl?: string, config?: Partial<MetaCloudConfig>): Promise<void> {
    const log = orgLogger(orgId)

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
      webhookUrl,
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
      webhookUrl,
    }

    this.sessions.set(orgId, session)
    this.configs.set(orgId, metaConfig)

    // Persist metadata for auto-restore
    saveSessionMeta({
      orgId,
      provider: 'meta-cloud',
      webhookUrl,
      createdAt: new Date().toISOString(),
      phoneNumber: session.phoneNumber,
      lastConnected: new Date().toISOString(),
      autoRestore: true,
      metaPhoneNumberId: phoneNumberId,
      metaAccessToken: accessToken,
      metaWabaId: wabaId ?? '',
    })

    log.info({ phone: session.phoneNumber, phoneNumberId }, 'Meta Cloud session started')

    if (webhookUrl) {
      await postWebhook(webhookUrl, { event: 'connected', orgId, phone: session.phoneNumber, provider: 'meta-cloud' })
    }
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
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meta Cloud API send failed: ${res.status} ${body}`)
    }

    const result = await res.json() as { messages?: Array<{ id: string }> }
    const messageId = result.messages?.[0]?.id ?? ''

    return { messageId }
  }

  listActiveSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  async restoreSessions(): Promise<void> {
    const orgIds = listStoredSessions()
    for (const orgId of orgIds) {
      const meta = loadSessionMeta(orgId)
      if (!meta || meta.provider !== 'meta-cloud') continue

      try {
        await this.start(orgId, meta.webhookUrl, {
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
