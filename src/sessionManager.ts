import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import { Session } from './types'
import { logger, orgLogger } from './lib/logger'
import { postWebhook, rekeyWebhookFailures } from './lib/webhookDispatcher'
import {
  saveSessionMeta,
  loadSessionMeta,
  updateSessionMeta,
  deleteSessionMeta,
  deleteSessionAuthDir,
  listStoredSessions,
  migrateSessionAuthDir,
} from './lib/sessionStore'
import pino from 'pino'

const baileysLogger = pino({ level: 'silent' })

export const sessions = new Map<string, Session>()
export const sockets: Map<string, any> = new Map()

/** Stops auto-reconnect when the session was ended deliberately (e.g. admin DELETE / Edit). */
const intentionallyStoppedOrgIds = new Set<string>()

// ── Start a session ────────────────────────────────────────────

export async function startSession(orgId: string, webhookUrl?: string): Promise<void> {
  const log = orgLogger(orgId)
  intentionallyStoppedOrgIds.delete(orgId)

  // Clean up any existing session first
  if (sockets.has(orgId)) {
    log.info('Restarting existing session')
    sockets.get(orgId)?.end(undefined)
    sockets.delete(orgId)
  }

  const session: Session = { orgId, status: 'connecting', webhookUrl }
  sessions.set(orgId, session)

  // Persist metadata so we can auto-restore after restart
  saveSessionMeta({
    orgId,
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
  sockets.set(orgId, sock)

  sock.ev.on('creds.update', saveCreds)

  // ── Connection events ──────────────────────────────────────
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

      if (intentionallyStoppedOrgIds.has(orgId)) {
        intentionallyStoppedOrgIds.delete(orgId)
        log.info('Intentional stop — not scheduling reconnect')
        sockets.delete(orgId)
        return
      }

      if (statusCode !== DisconnectReason.loggedOut) {
        log.info('Reconnecting in 5 seconds...')
        setTimeout(() => startSession(orgId, webhookUrl), 5000)
      } else {
        log.info('Logged out — not reconnecting')
        sockets.delete(orgId)
      }
    }
  })

  // ── Incoming messages ──────────────────────────────────────
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

  // ── Message status updates (sent/delivered/read) ───────────
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

// ── Helpers ────────────────────────────────────────────────────

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

// ── Session queries ────────────────────────────────────────────

export function getStatus(orgId: string): Session | undefined {
  return sessions.get(orgId)
}

export function getQR(orgId: string): string | undefined {
  const s = sessions.get(orgId)
  return s?.status === 'qr' ? s.qr : undefined
}

export function stopSession(
  orgId: string,
  options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }
): void {
  const keepAuth = options?.keepAuthFiles === true
  const purgeAuth = options?.purgeAuthDir === true
  const log = orgLogger(orgId)
  intentionallyStoppedOrgIds.add(orgId)
  sockets.get(orgId)?.end(undefined)
  sockets.delete(orgId)
  sessions.delete(orgId)
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

/**
 * Move paired WhatsApp auth from one org folder to another and reconnect under `toOrgId`
 * (no new QR if creds are valid).
 */
export async function migrateSession(
  fromOrgId: string,
  toOrgId: string,
  webhookUrl?: string
): Promise<void> {
  if (fromOrgId === toOrgId) {
    await startSession(fromOrgId, webhookUrl)
    return
  }

  const log = orgLogger(fromOrgId)
  log.info({ toOrgId }, 'Migrating WhatsApp session to new organization')

  stopSession(fromOrgId, { keepAuthFiles: true })

  try {
    migrateSessionAuthDir(fromOrgId, toOrgId)
  } catch (err) {
    logger.error({ fromOrgId, toOrgId, err }, 'migrateSessionAuthDir failed')
    throw err
  }

  rekeyWebhookFailures(fromOrgId, toOrgId)

  await startSession(toOrgId, webhookUrl)

  orgLogger(toOrgId).info({ fromOrgId }, 'Session migrate complete — connected under new org')
}

export function listActiveSessions(): Session[] {
  return Array.from(sessions.values())
}

// ── Auto-restore on startup ────────────────────────────────────

export async function restoreSessions(): Promise<void> {
  const orgIds = listStoredSessions()
  if (orgIds.length === 0) {
    logger.info('No stored sessions to restore')
    return
  }

  logger.info({ count: orgIds.length }, 'Restoring sessions from disk')

  for (const orgId of orgIds) {
    const meta = loadSessionMeta(orgId)
    if (meta && meta.autoRestore !== false) {
      try {
        await startSession(orgId, meta.webhookUrl)
        logger.info({ orgId }, 'Session restored')
      } catch (err) {
        logger.error({ orgId, err }, 'Failed to restore session')
      }
    }
  }
}
