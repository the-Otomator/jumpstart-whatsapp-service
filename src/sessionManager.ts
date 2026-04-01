import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  proto,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import { Session, IncomingMessage } from './types'
import { baileysLogger, childLogger } from './lib/logger'
import { dispatchWebhook } from './lib/webhookDispatcher'
import { saveSessionMeta, removeSessionMeta, loadAllSessions } from './lib/sessionStore'

const log = childLogger('sessionManager')

export const sessions = new Map<string, Session>()
export const sockets = new Map<string, ReturnType<typeof makeWASocket>>()

export async function startSession(orgId: string, webhookUrl?: string): Promise<void> {
  if (sockets.has(orgId)) {
    sockets.get(orgId)?.end(undefined)
    sockets.delete(orgId)
  }

  const session: Session = { orgId, status: 'connecting', webhookUrl }
  sessions.set(orgId, session)
  saveSessionMeta(orgId, webhookUrl)

  const authDir = path.join(process.cwd(), 'sessions', orgId)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

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
  sockets.set(orgId, sock)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const base64 = await QRCode.toDataURL(qr)
      session.status = 'qr'
      session.qr = base64
      log.info({ orgId }, 'QR code generated')
      if (webhookUrl) await dispatchWebhook(webhookUrl, { event: 'qr', orgId, qr: base64 })
    }
    if (connection === 'open') {
      session.status = 'connected'
      session.phoneNumber = sock.user?.id?.split(':')[0]
      session.qr = undefined
      log.info({ orgId, phone: session.phoneNumber }, 'session connected')
      if (webhookUrl) await dispatchWebhook(webhookUrl, { event: 'connected', orgId, phone: session.phoneNumber })
    }
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      session.status = 'disconnected'
      log.warn({ orgId, statusCode }, 'session disconnected')
      if (webhookUrl) await dispatchWebhook(webhookUrl, { event: 'disconnected', orgId })
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => startSession(orgId, webhookUrl), 5000)
      } else {
        sockets.delete(orgId)
        removeSessionMeta(orgId)
      }
    }
  })

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return
    for (const msg of msgs) {
      if (msg.key.fromMe) continue
      if (!msg.message) continue
      try {
        const incoming = await parseIncomingMessage(orgId, sock, msg)
        if (incoming && webhookUrl) {
          await dispatchWebhook(webhookUrl, incoming)
        }
      } catch (err) {
        log.error({ orgId, err }, 'failed to process incoming message')
      }
    }
  })
}

async function parseIncomingMessage(
  orgId: string,
  sock: ReturnType<typeof makeWASocket>,
  msg: proto.IWebMessageInfo,
): Promise<IncomingMessage | null> {
  const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') ?? ''
  if (!from) return null

  const m = msg.message!
  const base: Omit<IncomingMessage, 'type' | 'text' | 'mediaUrl' | 'mimetype' | 'caption'> = {
    event: 'message',
    orgId,
    from,
    pushName: msg.pushName ?? undefined,
    messageId: msg.key.id ?? '',
    timestamp: typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Date.now() / 1000,
  }

  // Text message
  if (m.conversation || m.extendedTextMessage) {
    return { ...base, type: 'text', text: m.conversation ?? m.extendedTextMessage?.text ?? '' }
  }

  // Media messages
  const mediaTypes = [
    { key: 'imageMessage' as const, type: 'image' as const },
    { key: 'videoMessage' as const, type: 'video' as const },
    { key: 'audioMessage' as const, type: 'audio' as const },
    { key: 'documentMessage' as const, type: 'document' as const },
    { key: 'stickerMessage' as const, type: 'sticker' as const },
  ]

  for (const { key, type } of mediaTypes) {
    if (m[key]) {
      let mediaUrl: string | undefined
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {})
        mediaUrl = `data:${(m[key] as { mimetype?: string })?.mimetype ?? 'application/octet-stream'};base64,${(buffer as Buffer).toString('base64')}`
      } catch (err) {
        log.warn({ orgId, type, err }, 'failed to download media')
      }
      return {
        ...base,
        type,
        mediaUrl,
        mimetype: (m[key] as { mimetype?: string })?.mimetype ?? undefined,
        caption: (m[key] as { caption?: string })?.caption ?? undefined,
      }
    }
  }

  return { ...base, type: 'other' }
}

export async function restoreSessions(): Promise<void> {
  const stored = loadAllSessions()
  const orgIds = Object.keys(stored)
  if (orgIds.length === 0) return
  log.info({ count: orgIds.length }, 'restoring sessions')
  for (const orgId of orgIds) {
    try {
      await startSession(orgId, stored[orgId].webhookUrl)
      log.info({ orgId }, 'session restored')
    } catch (err) {
      log.error({ orgId, err }, 'failed to restore session')
    }
  }
}

export function getStatus(orgId: string): Session | undefined {
  return sessions.get(orgId)
}

export function getQR(orgId: string): string | undefined {
  const s = sessions.get(orgId)
  return s?.status === 'qr' ? s.qr : undefined
}

export function stopSession(orgId: string): void {
  sockets.get(orgId)?.end(undefined)
  sockets.delete(orgId)
  sessions.delete(orgId)
  removeSessionMeta(orgId)
  log.info({ orgId }, 'session stopped')
}

export function stopAllSessions(): void {
  for (const [orgId, sock] of sockets) {
    sock.end(undefined)
    log.info({ orgId }, 'session closed for shutdown')
  }
  sockets.clear()
  sessions.clear()
}
