import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  proto,
  AnyMessageContent,
} from '@whiskeysockets/baileys'
import {
  cacheInboundMedia,
  publicMediaUrl,
  type MediaType,
} from '../../lib/mediaCache'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import pino from 'pino'
import type { WhatsAppProvider, SendResult, ProviderType } from '../types'
import type { Session, SendMessageRequest } from '../../types'
import { logger, orgLogger } from '../../lib/logger'
import { updateDeviceStatus } from '../../lib/supabase'
import { writeWaDeviceStatus } from '../../lib/waDeviceWrite'
import { formatDisconnectReason } from '../../lib/disconnectReason'
import { postWebhook, rekeyWebhookFailures } from '../../lib/webhookDispatcher'
import { getSenderPool } from '../../pool'
import {
  saveSessionMeta,
  loadSessionMeta,
  updateSessionMeta,
  deleteSessionMeta,
  deleteSessionAuthDir,
  listStoredSessions,
  migrateSessionAuthDir,
} from '../../lib/sessionStore'
import { WA_SEND_TIMEOUT_MS, withTimeout } from '../../lib/withTimeout'
import {
  type ExtendedMessageKey,
  resolveGroupInbound,
  shouldPostInboundWebhook,
  jidLocalPart,
  pickPnDigits,
} from '../../lib/groupInbound'
import { getCachedSubject, setCachedSubject } from '../../lib/groupSubjectCache'
import {
  DEFAULT_BACKFILL_AGE_LIMIT_SECONDS,
  evaluateBackfill,
} from '../../lib/backfillGuard'
import {
  isValidWebhookUrl,
  requireWebhookUrl,
  WEBHOOK_URL_REQUIRED,
} from '../../lib/webhookUrl'
import { useHardenedMultiFileAuthState } from '../../lib/hardenedMultiFileAuthState'
import {
  acquireSessionLock,
  releaseSessionLock,
  SessionLockError,
} from '../../lib/sessionAuthLock'
import {
  getOutgoingMessage,
  storeOutgoingMessage,
} from '../../lib/outgoingMessageStore'
import { MsgRetryCounterCache, MSG_RETRY_MAX_COUNT } from '../../lib/msgRetryCache'
import {
  recordDecryptFailure,
  recordGetMessageHit,
  recordGetMessageMiss,
  recordRetryReceipt,
} from '../../lib/baileysTelemetry'

const baileysLogger = pino({ level: 'silent' })

const WS_OPEN = 1
const RECONNECT_DELAY_MS = 5000
const SEND_TIMEOUT_RECONNECT_DELAY_MS = 2000
/** Proactive half-open probe interval while status says connected. */
const KEEPALIVE_INTERVAL_MS = Number(process.env.WA_KEEPALIVE_INTERVAL_MS ?? 25_000)
/** Consecutive failed keepalive probes before teardown (transient half-open churn guard). */
const KEEPALIVE_MISS_THRESHOLD = 2

type BaileysSocket = ReturnType<typeof makeWASocket>

/**
 * Baileys 6.7+ wraps the raw `ws` in WebSocketClient: no `.readyState` on `sock.ws`,
 * use `sock.ws.isOpen` (or `sock.ws.socket.readyState`). Legacy/raw sockets still expose readyState.
 */
export function isSocketOpen(sock: BaileysSocket | undefined): boolean {
  if (!sock) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Baileys WebSocketClient; socket is protected
  const ws = (sock as any).ws as
    | { isOpen?: boolean; socket?: { readyState?: number }; readyState?: number }
    | undefined
  if (ws && typeof ws.isOpen === 'boolean') return ws.isOpen
  const raw = ws?.socket ?? ws
  return raw?.readyState === WS_OPEN
}

export class BaileysProvider implements WhatsAppProvider {
  readonly type: ProviderType = 'baileys'

  private sessions = new Map<string, Session>()
  private sockets = new Map<string, BaileysSocket>()
  private intentionallyStoppedOrgIds = new Set<string>()
  /**
   * Sockets whose close must not schedule reconnect (replaced by start() restart,
   * or torn down by forceTeardown). Identity-based so a NEW socket's 'open' cannot
   * clear the guard before the OLD socket's close fires (the P0b race).
   */
  private suppressReconnectSockets = new WeakSet<object>()
  /** At most one pending reconnect timer per org — prevents restart loops. */
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>()
  /** Consecutive half-open keepalive misses per org; reset on a successful open probe. */
  private keepaliveMisses = new Map<string, number>()
  /** Wall-clock ms when connection.update → open last fired (reconnect backfill window). */
  private lastOpenAtMs = new Map<string, number>()
  /** Per-session retry counters (Baileys CacheStore). */
  private msgRetryCaches = new Map<string, MsgRetryCounterCache>()
  /** Orgs that currently hold the on-disk session lock in this process. */
  private heldSessionLocks = new Set<string>()

  async start(orgId: string, webhookUrl?: string): Promise<void> {
    const log = orgLogger(orgId)
    // Fail loud before any socket work — a session without a webhook looks healthy but drops inbound.
    const resolvedWebhookUrl = requireWebhookUrl(webhookUrl)

    // Cancel any pending reconnect before (re)starting — single-timer invariant.
    this.clearReconnectTimer(orgId)
    this.stopKeepalive(orgId)

    // Allow a fresh start after stop()/teardown to reconnect on later closes.
    this.intentionallyStoppedOrgIds.delete(orgId)

    if (this.sockets.has(orgId)) {
      // Mark intentional + suppress-by-socket-identity BEFORE end() so connection.close
      // does not schedule another start(). Shared intentionallyStopped alone races with
      // the new socket's 'open' clearing the flag; WeakSet keeps the old close suppressed.
      log.info('Restarting existing session')
      const old = this.sockets.get(orgId)
      this.intentionallyStoppedOrgIds.add(orgId)
      if (old) this.suppressReconnectSockets.add(old)
      try {
        old?.end(undefined)
      } catch {
        // ignore teardown errors
      }
      this.sockets.delete(orgId)
    }

    const session: Session = {
      orgId,
      provider: 'baileys',
      status: 'connecting',
      webhookUrl: resolvedWebhookUrl,
      lastError: undefined,
    }
    this.sessions.set(orgId, session)

    saveSessionMeta({
      orgId,
      provider: 'baileys',
      webhookUrl: resolvedWebhookUrl,
      createdAt: new Date().toISOString(),
      autoRestore: true,
    })

    // Cross-process single-writer: refuse if another live process holds the auth dir.
    try {
      acquireSessionLock(orgId)
      this.heldSessionLocks.add(orgId)
    } catch (err) {
      if (err instanceof SessionLockError) {
        session.status = 'disconnected'
        session.lastError = err.message
        log.error(
          { holderPid: err.holder.pid, holderBootId: err.holder.bootId },
          'Cannot start session — auth lock held by another process'
        )
      }
      throw err
    }

    const authDir = path.join(process.cwd(), 'sessions', orgId)
    const { state, saveCreds } = await useHardenedMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()

    log.info({ version }, 'Creating Baileys socket')

    if (!this.msgRetryCaches.has(orgId)) {
      this.msgRetryCaches.set(orgId, new MsgRetryCounterCache())
    }
    const msgRetryCounterCache = this.msgRetryCaches.get(orgId)!

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
      // Baileys WS ping; our keepalive still probes readyState for silent half-open.
      keepAliveIntervalMs: 15_000,
      // Cap retries for a poisoned message (Baileys default is also 5).
      maxMsgRetryCount: MSG_RETRY_MAX_COUNT,
      msgRetryCounterCache,
      // Required for decrypt self-heal: recipient retry receipts call this to resend.
      getMessage: async (key) => {
        try {
          recordRetryReceipt(orgId)
          const stored = await getOutgoingMessage(orgId, key)
          if (stored) {
            recordGetMessageHit(orgId)
            return stored
          }
          recordGetMessageMiss(orgId)
          log.warn(
            { messageId: key.id, remoteJid: key.remoteJid },
            'getMessage miss — cannot satisfy decrypt retry; recipient may stay stuck'
          )
          return undefined
        } catch (err) {
          log.warn({ err: (err as Error).message, messageId: key.id }, 'getMessage threw — returning undefined')
          return undefined
        }
      },
    })
    this.sockets.set(orgId, sock)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const base64 = await QRCode.toDataURL(qr)
        session.status = 'qr'
        session.qr = base64
        log.info('QR code generated, waiting for scan')
        // orgId here is the session_key passed to start() (org_id or "org_id-8char").
        await updateDeviceStatus(orgId, 'qr')
        await writeWaDeviceStatus(orgId, 'qr')
        if (session.webhookUrl) {
          await postWebhook(session.webhookUrl, { event: 'qr', orgId, qr: base64 })
        }
      }

      if (connection === 'open') {
        // Fresh live socket — clear stop flag so future unintentional closes reconnect.
        // Old replaced socket remains suppressed via suppressReconnectSockets.
        this.intentionallyStoppedOrgIds.delete(orgId)
        this.lastOpenAtMs.set(orgId, Date.now())
        session.status = 'connected'
        session.phoneNumber = sock.user?.id?.split(':')[0]
        session.qr = undefined
        log.info({ phone: session.phoneNumber }, 'Session connected')

        updateSessionMeta(orgId, {
          phoneNumber: session.phoneNumber,
          lastConnected: new Date().toISOString(),
        })

        // Root-cause fix: write live status to the Hub DB row so every DB-reading
        // surface (admin, get_org_devices, app send-path probe) sees `connected`
        // immediately. This also makes the first connected device the de-facto
        // default sender (probe keys on status === 'connected').
        await updateDeviceStatus(orgId, 'connected', session.phoneNumber)
        await writeWaDeviceStatus(orgId, 'connected', { phoneNumber: session.phoneNumber })

        getSenderPool(orgId).onSessionConnected(session.phoneNumber)

        this.startKeepalive(orgId)

        if (session.webhookUrl) {
          await postWebhook(session.webhookUrl, { event: 'connected', orgId, phone: session.phoneNumber })
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const reason = formatDisconnectReason(lastDisconnect)
        session.status = 'disconnected'
        this.stopKeepalive(orgId)

        log.warn({ statusCode, reason }, 'Session disconnected')

        // Reflect the disconnect in Hub + Jumpstart wa_devices with a real last_error.
        await updateDeviceStatus(orgId, 'disconnected')
        await writeWaDeviceStatus(orgId, 'disconnected', { lastError: reason })

        getSenderPool(orgId).onSessionDisconnected(reason)

        if (session.webhookUrl) {
          await postWebhook(session.webhookUrl, { event: 'disconnected', orgId, reason })
        }

        // Only drop the map entry if it still points at this closing socket
        // (a restart may already have installed a newer one).
        if (this.sockets.get(orgId) === sock) {
          this.sockets.delete(orgId)
        }

        if (this.suppressReconnectSockets.has(sock)) {
          this.intentionallyStoppedOrgIds.delete(orgId)
          log.info('Suppressed close (socket replaced/torn down) — not scheduling reconnect')
          return
        }

        if (this.intentionallyStoppedOrgIds.has(orgId)) {
          this.intentionallyStoppedOrgIds.delete(orgId)
          log.info('Intentional stop — not scheduling reconnect')
          return
        }

        if (statusCode !== DisconnectReason.loggedOut) {
          // Guard: never schedule while a newer socket already exists / is connecting.
          if (this.sockets.has(orgId)) {
            log.info('Socket already present — skipping reconnect schedule')
            return
          }
          log.info('Reconnecting in 5 seconds...')
          this.scheduleReconnect(orgId, session.webhookUrl, RECONNECT_DELAY_MS)
        } else {
          log.info('Logged out — not reconnecting')
        }
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        // Inbound decrypt failure ("Waiting for this message") surfaces as CIPHERTEXT stub.
        if (msg.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
          recordDecryptFailure(orgId)
          log.warn(
            { messageId: msg.key.id, from: msg.key.remoteJid },
            'Inbound CIPHERTEXT stub — local decrypt failure'
          )
          continue
        }

        if (!msg.message || msg.key.fromMe) continue

        const from = msg.key.remoteJid ?? ''
        const keyAny = msg.key as ExtendedMessageKey
        const { isGroup, groupJid, ambiguous } = resolveGroupInbound(keyAny)

        if (ambiguous) {
          log.debug({ key: msg.key }, 'group inbound without @g.us jid')
        }

        const isLid = from.endsWith('@lid')
          || String(msg.key.participant ?? '').endsWith('@lid')

        let senderPn: string | null = pickPnDigits(
          keyAny.senderPn,
          keyAny.remoteJidAlt,
          isGroup ? undefined : (from.endsWith('@s.whatsapp.net') ? from : undefined),
        )
        let participantPn: string | null = isGroup
          ? pickPnDigits(keyAny.participantPn, keyAny.participantAlt, msg.key.participant)
          : null

        // Fallback: Baileys LID↔PN mapping store (present on some 6.7+/7.x builds).
        if (isLid && !senderPn && !isGroup) {
          try {
            const store = (sock as unknown as {
              signalRepository?: { lidMapping?: { getPNForLID?: (lid: string) => Promise<string | null> | string | null } }
            }).signalRepository?.lidMapping
            const lidJid = from.endsWith('@lid') ? from : (keyAny.senderLid ?? null)
            if (store?.getPNForLID && lidJid) {
              const mapped = await Promise.resolve(store.getPNForLID(lidJid))
              senderPn = pickPnDigits(mapped)
            }
          } catch (err) {
            log.debug({ err: (err as Error).message }, 'lidMapping.getPNForLID failed')
          }
        }
        if (isGroup && isLid && !participantPn) {
          try {
            const store = (sock as unknown as {
              signalRepository?: { lidMapping?: { getPNForLID?: (lid: string) => Promise<string | null> | string | null } }
            }).signalRepository?.lidMapping
            const lidJid = String(msg.key.participant ?? '').endsWith('@lid')
              ? String(msg.key.participant)
              : null
            if (store?.getPNForLID && lidJid) {
              const mapped = await Promise.resolve(store.getPNForLID(lidJid))
              participantPn = pickPnDigits(mapped)
            }
          } catch {
            // best-effort
          }
        }

        const senderPhone = isGroup
          ? (participantPn ?? jidLocalPart(msg.key.participant ?? ''))
          : jidLocalPart(from)

        const textContent = extractTextContent(msg.message)
        const mediaType = detectMediaType(msg.message)

        const messageTimestampSec = msg.messageTimestamp
          ? Number(msg.messageTimestamp)
          : Math.floor(Date.now() / 1000)
        const ageLimitSeconds = Number(
          process.env.WA_BACKFILL_AGE_LIMIT_SECONDS ?? DEFAULT_BACKFILL_AGE_LIMIT_SECONDS,
        )
        const backfill = evaluateBackfill({
          messageTimestampSec,
          lastOpenAtMs: this.lastOpenAtMs.get(orgId) ?? null,
          ageLimitSeconds,
        })

        const payload: Record<string, unknown> = {
          event: 'message',
          orgId,
          messageId: msg.key.id ?? '',
          from: senderPhone,
          fromName: msg.pushName ?? '',
          message: textContent,
          timestamp: messageTimestampSec,
          isGroup,
          senderPn: isGroup ? (participantPn ?? senderPn) : senderPn,
          isBackfill: backfill.isBackfill,
          // When true, Hub must persist but must not enqueue for auto-task pipeline.
          skipDownstream: backfill.isBackfill,
          backfillReason: backfill.reason,
        }

        if (backfill.isBackfill) {
          log.info(
            {
              orgId,
              conversation: isGroup ? (groupJid ?? from) : senderPhone,
              wa_message_id: msg.key.id ?? '',
              age_seconds: backfill.ageSeconds,
              reason: backfill.reason,
            },
            'Backfill message skipped for downstream processing',
          )
        }

        if (isGroup && groupJid) {
          payload.groupId = jidLocalPart(groupJid)
          payload.participantPn = participantPn
          payload.senderName = msg.pushName ?? null

          let groupSubject = getCachedSubject(groupJid)
          if (!groupSubject) {
            try {
              const metadata = await sock.groupMetadata(groupJid)
              groupSubject = metadata.subject ?? null
              if (groupSubject) setCachedSubject(groupJid, groupSubject)
            } catch (err) {
              log.debug({ err: (err as Error).message, groupJid }, 'groupMetadata lookup failed')
            }
          }
          if (groupSubject) payload.groupSubject = groupSubject
        }
        if (mediaType) {
          payload.mediaType = mediaType
          if (mediaType === 'audio') {
            const seconds = msg.message?.audioMessage?.seconds
            if (typeof seconds === 'number' && Number.isFinite(seconds)) {
              payload.mediaDurationSeconds = Math.max(0, Math.round(seconds))
            }
          }
          // Download now — Baileys media URLs are not fetchable later (keys on message).
          // Failure must never block the webhook.
          try {
            const messageId = msg.key.id ?? ''
            const cached = await cacheInboundMedia({
              orgId,
              messageId,
              mediaType: mediaType as MediaType,
              waMessage: msg,
            })
            if (cached.mime) payload.mediaMime = cached.mime
            if (cached.size != null) payload.mediaSize = cached.size
            if (cached.filename) payload.mediaFilename = cached.filename
            if (cached.tooLarge) payload.mediaTooLarge = true
            if (cached.filePath && messageId) {
              payload.mediaUrl = publicMediaUrl(orgId, messageId)
            } else if (cached.mime || cached.filename || cached.tooLarge) {
              // Metadata-only (too large or download failed) — no fetchable URL
              if (cached.tooLarge) payload.mediaTooLarge = true
            }
          } catch (err) {
            log.warn(
              { orgId, messageId: msg.key.id, err: (err as Error).message },
              'Media capture error — continuing without media'
            )
          }
        }

        log.debug(
          { from: senderPhone, isGroup, groupJid, senderPn: payload.senderPn, mediaType },
          'Incoming message',
        )

        if (session.webhookUrl && shouldPostInboundWebhook(isGroup, groupJid)) {
          await postWebhook(session.webhookUrl, payload)
        } else if (isGroup && !groupJid) {
          log.debug({ key: msg.key }, 'skipping webhook for group inbound without groupId')
        }
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

        if (status === 'delivered') {
          getSenderPool(orgId).onMessageDelivered()
        }

        if (session.webhookUrl) {
          await postWebhook(session.webhookUrl, {
            event: 'message_status',
            orgId,
            messageId: update.key.id ?? '',
            status,
            to,
          })
        }
      }
    })

    sock.ev.on('group-participants.update', async (ev) => {
      const systemJid = sock.user?.id ?? ''
      const botRemoved =
        ev.action === 'remove' && ev.participants.includes(systemJid)

      if (botRemoved) {
        log.warn({ groupJid: ev.id }, 'System number was kicked from group')
      } else {
        log.debug({ groupJid: ev.id, action: ev.action, count: ev.participants.length }, 'Group participants updated')
      }

      if (session.webhookUrl) {
        await postWebhook(session.webhookUrl, {
          event: 'group_participants_update',
          orgId,
          groupJid: ev.id,
          action: ev.action,
          participants: ev.participants,
          by: (ev as any).author ?? null,
          bot_removed: botRemoved,
        })
      }
    })
  }

  stop(orgId: string, options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }): void {
    const keepAuth = options?.keepAuthFiles === true
    const purgeAuth = options?.purgeAuthDir === true
    const log = orgLogger(orgId)
    this.clearReconnectTimer(orgId)
    this.stopKeepalive(orgId)
    this.intentionallyStoppedOrgIds.add(orgId)
    const sock = this.sockets.get(orgId)
    if (sock) this.suppressReconnectSockets.add(sock)
    sock?.end(undefined)
    this.sockets.delete(orgId)
    this.sessions.delete(orgId)
    this.msgRetryCaches.delete(orgId)
    if (this.heldSessionLocks.has(orgId)) {
      releaseSessionLock(orgId)
      this.heldSessionLocks.delete(orgId)
    }
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

    // Liveness guard: status can still say "connected" on a half-open WS.
    if (!isSocketOpen(sock)) {
      // Tear down + schedule reconnect (same path as send_timeout); still fail this send fast.
      this.forceTeardownAndReconnect(req.orgId, 'half_open_readyState')
      throw new Error(`Session ${req.orgId} not connected`)
    }

    const jid = formatJid(req.to)
    const content = await buildMessageContent(req)
    const result = await withTimeout(
      sock.sendMessage(jid, content) as Promise<
        | { key?: { id?: string | null; remoteJid?: string | null }; message?: proto.IMessage | null }
        | undefined
      >,
      WA_SEND_TIMEOUT_MS,
      'send_timeout'
    )
    // Persist for getMessage decrypt-retry self-heal (TTL ≥ 7 days).
    // Fire-and-forget: store never rejects; must not delay or fail the send.
    if (result?.key?.id && result.message) {
      void storeOutgoingMessage(req.orgId, result.key, result.message)
    } else if (result?.key?.id) {
      // sendMessage sometimes omits .message on the return; store the content we sent.
      void storeOutgoingMessage(req.orgId, { id: result.key.id, remoteJid: jid }, contentAsProto(content))
    }
    return { messageId: result?.key?.id ?? '' }
  }

  /**
   * Half-open socket recovery: flip status off "connected", tear down, reconnect.
   * Called when the pool/provider send ACK times out.
   */
  onSendTimeout(orgId: string): void {
    this.forceTeardownAndReconnect(orgId, 'send_timeout')
  }

  /** Expose the raw Baileys socket for group operations (Baileys-only). */
  getSocket(orgId: string): BaileysSocket | undefined {
    return this.sockets.get(orgId)
  }

  /**
   * Update inbound webhook target without tearing down the Baileys socket.
   * Event handlers read `session.webhookUrl` on each dispatch, so this takes effect immediately.
   */
  updateWebhookUrl(orgId: string, webhookUrl: string): { previous: string | undefined; next: string } {
    const resolved = requireWebhookUrl(webhookUrl)
    const session = this.sessions.get(orgId)
    if (!session) {
      throw new Error(`Session ${orgId} not found`)
    }
    const previous = session.webhookUrl
    session.webhookUrl = resolved
    session.lastError = undefined
    updateSessionMeta(orgId, { webhookUrl: resolved })
    // Ensure meta exists even if updateSessionMeta no-op'd (no prior meta file).
    const meta = loadSessionMeta(orgId)
    if (!meta) {
      saveSessionMeta({
        orgId,
        provider: 'baileys',
        webhookUrl: resolved,
        createdAt: new Date().toISOString(),
        autoRestore: true,
        phoneNumber: session.phoneNumber,
      })
    }
    return { previous, next: resolved }
  }

  listActiveSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  /** Log every stored session whose meta lacks a usable webhookUrl (startup fail-loud). */
  logSessionsMissingWebhook(): void {
    for (const orgId of listStoredSessions()) {
      const meta = loadSessionMeta(orgId)
      if (!meta || meta.provider === 'meta-cloud') continue
      if (!isValidWebhookUrl(meta.webhookUrl)) {
        logger.error(
          { orgId },
          'Stored session meta lacks usable webhookUrl — will not auto-restore'
        )
      }
    }
  }

  async restoreSessions(): Promise<void> {
    const orgIds = listStoredSessions()
    if (orgIds.length === 0) {
      logger.info('No stored sessions to restore')
      return
    }

    this.logSessionsMissingWebhook()
    logger.info({ count: orgIds.length }, 'Restoring sessions from disk')

    for (const orgId of orgIds) {
      const meta = loadSessionMeta(orgId)
      if (meta && meta.autoRestore !== false) {
        if (meta.provider === 'meta-cloud') continue
        if (!isValidWebhookUrl(meta.webhookUrl)) {
          const lastError = `${WEBHOOK_URL_REQUIRED}: persisted meta has no usable webhookUrl`
          logger.error({ orgId }, 'Skipping restore: session meta has no usable webhookUrl')
          this.sessions.set(orgId, {
            orgId,
            provider: 'baileys',
            status: 'disconnected',
            lastError,
          })
          continue
        }
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

  // ── Recovery / reconnect helpers (exported for regression tests via casting) ──

  /** @internal — test/inspection: pending reconnect timers */
  getPendingReconnectCount(): number {
    return this.reconnectTimers.size
  }

  /** @internal */
  hasPendingReconnect(orgId: string): boolean {
    return this.reconnectTimers.has(orgId)
  }

  /** @internal */
  getSocketMapSize(): number {
    return this.sockets.size
  }

  clearReconnectTimer(orgId: string): void {
    const existing = this.reconnectTimers.get(orgId)
    if (existing) {
      clearTimeout(existing)
      this.reconnectTimers.delete(orgId)
    }
  }

  /**
   * Schedule exactly one reconnect for orgId. Replaces any prior timer.
   * Skips start if a socket already exists when the timer fires.
   */
  scheduleReconnect(orgId: string, webhookUrl: string | undefined, delayMs: number): void {
    this.clearReconnectTimer(orgId)
    if (this.sockets.has(orgId)) {
      orgLogger(orgId).info('Skipping reconnect schedule — socket already present')
      return
    }
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(orgId)
      if (this.sockets.has(orgId)) {
        orgLogger(orgId).info('Reconnect timer fired but socket already present — skip')
        return
      }
      void this.start(orgId, webhookUrl)
    }, delayMs)
    this.reconnectTimers.set(orgId, timer)
  }

  /**
   * Shared teardown+reconnect used by send_timeout, half-open readyState, and keepalive.
   */
  forceTeardownAndReconnect(orgId: string, reason: string): void {
    const log = orgLogger(orgId)
    const session = this.sessions.get(orgId)
    if (session) {
      session.status = 'disconnected'
    }
    this.stopKeepalive(orgId)

    log.warn(
      { reason, timeoutMs: WA_SEND_TIMEOUT_MS },
      'forcing socket teardown + reconnect'
    )
    void updateDeviceStatus(orgId, 'disconnected')

    const sock = this.sockets.get(orgId)
    const webhookUrl = session?.webhookUrl ?? loadSessionMeta(orgId)?.webhookUrl
    this.sockets.delete(orgId)

    // Suppress close-driven reconnect; we schedule exactly one via reconnectTimers.
    if (sock) this.suppressReconnectSockets.add(sock)
    this.intentionallyStoppedOrgIds.add(orgId)
    try {
      sock?.end(undefined)
    } catch {
      // ignore teardown errors on a dead socket
    }

    // Clear stop flag so the scheduled start()'s future closes can reconnect.
    this.intentionallyStoppedOrgIds.delete(orgId)
    this.scheduleReconnect(orgId, webhookUrl, SEND_TIMEOUT_RECONNECT_DELAY_MS)
  }

  private startKeepalive(orgId: string): void {
    this.stopKeepalive(orgId)
    this.keepaliveMisses.set(orgId, 0)
    const timer = setInterval(() => {
      this.probeKeepalive(orgId)
    }, KEEPALIVE_INTERVAL_MS)
    // Don't keep the process alive solely for probes.
    if (typeof timer.unref === 'function') timer.unref()
    this.keepaliveTimers.set(orgId, timer)
  }

  /** Exposed for tests: one keepalive probe tick. */
  probeKeepalive(orgId: string): void {
    const session = this.sessions.get(orgId)
    if (!session || session.status !== 'connected') return
    const sock = this.sockets.get(orgId)
    if (!sock) {
      this.forceTeardownAndReconnect(orgId, 'keepalive_missing_socket')
      return
    }
    if (isSocketOpen(sock)) {
      this.keepaliveMisses.set(orgId, 0)
      return
    }
    const misses = (this.keepaliveMisses.get(orgId) ?? 0) + 1
    this.keepaliveMisses.set(orgId, misses)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Baileys WebSocketClient; socket is protected
    const ws = (sock as any).ws as
      | { isOpen?: boolean; socket?: { readyState?: number }; readyState?: number }
      | undefined
    const readyState = ws?.socket?.readyState ?? ws?.readyState
    if (misses < KEEPALIVE_MISS_THRESHOLD) {
      orgLogger(orgId).warn(
        { misses, readyState, isOpen: ws?.isOpen },
        'keepalive half-open probe miss — waiting for consecutive failure'
      )
      return
    }
    orgLogger(orgId).warn(
      { misses, readyState, isOpen: ws?.isOpen },
      'keepalive detected half-open socket — recovering'
    )
    this.forceTeardownAndReconnect(orgId, 'keepalive_half_open')
  }

  private stopKeepalive(orgId: string): void {
    const timer = this.keepaliveTimers.get(orgId)
    if (timer) {
      clearInterval(timer)
      this.keepaliveTimers.delete(orgId)
    }
    this.keepaliveMisses.delete(orgId)
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

/** Best-effort map of AnyMessageContent → proto.IMessage for retry store fallback. */
function contentAsProto(content: AnyMessageContent): proto.IMessage {
  const c = content as Record<string, unknown>
  if (typeof c.text === 'string') {
    return { conversation: c.text }
  }
  if (c.image) {
    return { imageMessage: { caption: typeof c.caption === 'string' ? c.caption : undefined } }
  }
  if (c.video) {
    return { videoMessage: { caption: typeof c.caption === 'string' ? c.caption : undefined } }
  }
  if (c.audio) {
    return { audioMessage: {} }
  }
  if (c.document) {
    return {
      documentMessage: {
        caption: typeof c.caption === 'string' ? c.caption : undefined,
        fileName: typeof c.fileName === 'string' ? c.fileName : undefined,
      },
    }
  }
  if (c.location && typeof c.location === 'object') {
    const loc = c.location as { degreesLatitude?: number; degreesLongitude?: number }
    return {
      locationMessage: {
        degreesLatitude: loc.degreesLatitude,
        degreesLongitude: loc.degreesLongitude,
      },
    }
  }
  return { conversation: '' }
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
