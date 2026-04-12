import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  proto,
  AnyMessageContent,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import pino from 'pino'
import type { WhatsAppProvider, SendResult, ProviderType } from '../types'
import type { Session, SendMessageRequest } from '../../types'
import { logger, orgLogger } from '../../lib/logger'
import { postWebhook, rekeyWebhookFailures } from '../../lib/webhookDispatcher'
import {
  saveSessionMeta,
  loadSessionMeta,
  updateSessionMeta,
  deleteSessionMeta,
  deleteSessionAuthDir,
  listStoredSessions,
  migrateSessionAuthDir,
} from '../../lib/sessionStore'

const baileysLogger = pino({ level: 'silent' })

export class BaileysProvider implements WhatsAppProvider {
  readonly type: ProviderType = 'baileys'

  private sessions = new Map<string, Session>()
  private sockets = new Map<string, ReturnType<typeof makeWASocket>>()
  private intentionallyStoppedOrgIds = new Set<string>()

  async start(orgId: string, webhookUrl?: string): Promise<void> {
    const log = orgLogger(orgId)
    this.intentionallyStoppedOrgIds.delete(orgId)

    if (this.sockets.has(orgId)) {
      log.info('Restarting existing session')
      this.sockets.get(orgId)?.end(undefined)
      this.sockets.delete(orgId)
    }

    const session: Session = {
      orgId,
      provider: 'baileys',
      status: 'connecting',
      webhookUrl,
    }
    this.sessions.set(orgId, session)

    saveSessionMeta({
      orgId,
      provider: 'baileys',
      webhookUrl,
      createdAt: new Date().toISOString(),
      autoRestore: true,
    })

    const authDir = path.join(process.cwd(), 'sessions', orgId)
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()

    log.info({ version }, 'Creating Baileys socket')

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
    })
    this.sockets.set(orgId, sock)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const base64 = await QRCode.toDataURL(qr)
        session.status = 'qr'
        session.qr = base64
        log.info('QR code generated, waiting for scan')
        if (webhookUrl) await postWebhook(webhookUrl, { event: 'qr', orgId, qr: base64 })
      }

      if (connection === 'open') {
        session.status = 'connected'
        session.phoneNumber = sock.user?.id?.split(':')[0]
        session.qr = undefined
        log.info({ phone: session.phoneNumber }, 'Session connected')

        updateSessionMeta(orgId, {
          phoneNumber: session.phoneNumber,
          lastConnected: new Date().toISOString(),
        })

        if (webhookUrl) {
          await postWebhook(webhookUrl, { event: 'connected', orgId, phone: session.phoneNumber })
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const reason = DisconnectReason[statusCode as number] ?? `unknown (${statusCode})`
        session.status = 'disconnected'

        log.warn({ statusCode, reason }, 'Session disconnected')

        if (webhookUrl) {
          await postWebhook(webhookUrl, { event: 'disconnected', orgId, reason })
        }

        if (this.intentionallyStoppedOrgIds.has(orgId)) {
          this.intentionallyStoppedOrgIds.delete(orgId)
          log.info('Intentional stop — not scheduling reconnect')
          this.sockets.delete(orgId)
          return
        }

        if (statusCode !== DisconnectReason.loggedOut) {
          log.info('Reconnecting in 5 seconds...')
          setTimeout(() => this.start(orgId, webhookUrl), 5000)
        } else {
          log.info('Logged out — not reconnecting')
          this.sockets.delete(orgId)
        }
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue

        const from = msg.key.remoteJid ?? ''
        const isGroup = from.endsWith('@g.us')
        const senderPhone = isGroup
          ? msg.key.participant?.split('@')[0] ?? ''
          : from.split('@')[0]

        const textContent = extractTextContent(msg.message)
        const mediaType = detectMediaType(msg.message)

        const payload: Record<string, unknown> = {
          event: 'message',
          orgId,
          messageId: msg.key.id ?? '',
          from: senderPhone,
          fromName: msg.pushName ?? '',
          message: textContent,
          timestamp: msg.messageTimestamp
            ? Number(msg.messageTimestamp)
            : Math.floor(Date.now() / 1000),
          isGroup,
        }

        if (isGroup) {
          payload.groupId = from.split('@')[0]
        }
        if (mediaType) {
          payload.mediaType = mediaType
        }

        log.debug({ from: senderPhone, isGroup, mediaType }, 'Incoming message')

        if (webhookUrl) await postWebhook(webhookUrl, payload)
      }
    })

    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        const statusMap: Record<number, string> = {
          2: 'sent',
          3: 'delivered',
          4: 'read',
        }
        const status = statusMap[update.update?.status ?? 0]
        if (!status) continue

        const to = update.key.remoteJid?.split('@')[0] ?? ''

        log.debug({ messageId: update.key.id, status, to }, 'Message status update')

        if (webhookUrl) {
          await postWebhook(webhookUrl, {
            event: 'message_status',
            orgId,
            messageId: update.key.id ?? '',
            status,
            to,
          })
        }
      }
    })
  }

  stop(orgId: string, options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }): void {
    const keepAuth = options?.keepAuthFiles === true
    const purgeAuth = options?.purgeAuthDir === true
    const log = orgLogger(orgId)
    this.intentionallyStoppedOrgIds.add(orgId)
    this.sockets.get(orgId)?.end(undefined)
    this.sockets.delete(orgId)
    this.sessions.delete(orgId)
    if (purgeAuth) {
      deleteSessionAuthDir(orgId)
      log.info('Session stopped — all pairing data removed from disk')
    } else if (!keepAuth) {
      deleteSessionMeta(orgId)
      log.info('Session stopped and metadata removed')
    } else {
      log.info('Session stopped (auth files kept for migrate)')
    }
  }

  getStatus(orgId: string): Session | undefined {
    return this.sessions.get(orgId)
  }

  getQR(orgId: string): string | undefined {
    const s = this.sessions.get(orgId)
    return s?.status === 'qr' ? s.qr : undefined
  }

  async sendMessage(req: SendMessageRequest): Promise<SendResult> {
    const sock = this.sockets.get(req.orgId)
    if (!sock) {
      throw new Error(`Session ${req.orgId} not connected`)
    }
    const jid = formatJid(req.to)
    const content = await buildMessageContent(req)
    const result = await sock.sendMessage(jid, content)
    return { messageId: result?.key?.id ?? '' }
  }

  listActiveSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  async restoreSessions(): Promise<void> {
    const orgIds = listStoredSessions()
    if (orgIds.length === 0) {
      logger.info('No stored sessions to restore')
      return
    }

    logger.info({ count: orgIds.length }, 'Restoring sessions from disk')

    for (const orgId of orgIds) {
      const meta = loadSessionMeta(orgId)
      if (meta && meta.autoRestore !== false) {
        if (meta.provider === 'meta-cloud') continue
        try {
          await this.start(orgId, meta.webhookUrl)
          logger.info({ orgId }, 'Session restored')
        } catch (err) {
          logger.error({ orgId, err }, 'Failed to restore session')
        }
      }
    }
  }

  async migrateSession(fromOrgId: string, toOrgId: string, webhookUrl?: string): Promise<void> {
    if (fromOrgId === toOrgId) {
      await this.start(fromOrgId, webhookUrl)
      return
    }

    const log = orgLogger(fromOrgId)
    log.info({ toOrgId }, 'Migrating WhatsApp session to new organization')

    this.stop(fromOrgId, { keepAuthFiles: true })

    try {
      migrateSessionAuthDir(fromOrgId, toOrgId)
    } catch (err) {
      logger.error({ fromOrgId, toOrgId, err }, 'migrateSessionAuthDir failed')
      throw err
    }

    rekeyWebhookFailures(fromOrgId, toOrgId)

    await this.start(toOrgId, webhookUrl)

    orgLogger(toOrgId).info({ fromOrgId }, 'Session migrate complete — connected under new org')
  }
}

function extractTextContent(msg: proto.IMessage): string {
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    ''
  )
}

function detectMediaType(
  msg: proto.IMessage
): 'image' | 'video' | 'audio' | 'document' | 'sticker' | undefined {
  if (msg.imageMessage) return 'image'
  if (msg.videoMessage) return 'video'
  if (msg.audioMessage) return 'audio'
  if (msg.documentMessage) return 'document'
  if (msg.stickerMessage) return 'sticker'
  return undefined
}

function formatJid(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, '')
  return clean.endsWith('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`
}

async function buildMessageContent(req: SendMessageRequest): Promise<AnyMessageContent> {
  switch (req.type) {
    case 'text':
      return { text: req.message ?? '' }

    case 'image': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'image/jpeg'};base64,${req.mediaBase64}` }
      return { image: media, caption: req.message }
    }

    case 'video': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'video/mp4'};base64,${req.mediaBase64}` }
      return { video: media, caption: req.message }
    }

    case 'audio': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'audio/mpeg'};base64,${req.mediaBase64}` }
      return { audio: media, mimetype: req.mimetype ?? 'audio/mpeg' }
    }

    case 'document': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'application/octet-stream'};base64,${req.mediaBase64}` }
      return {
        document: media,
        mimetype: req.mimetype ?? 'application/octet-stream',
        fileName: req.filename ?? 'document',
        caption: req.message,
      }
    }

    case 'location':
      return {
        location: {
          degreesLatitude: req.latitude!,
          degreesLongitude: req.longitude!,
        },
      }

    case 'contact': {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${req.contactName}`,
        `TEL;type=CELL;type=VOICE;waid=${req.contactPhone}:+${req.contactPhone}`,
        'END:VCARD',
      ].join('\n')
      return {
        contacts: {
          displayName: req.contactName!,
          contacts: [{ vcard }],
        },
      }
    }

    default:
      return { text: req.message ?? '' }
  }
}
