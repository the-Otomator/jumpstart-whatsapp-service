import type { WAMessage, WAMessageKey } from '@whiskeysockets/baileys'

type HistoryEvent = { messages: WAMessage[]; syncType?: number | null; peerDataRequestSessionId?: string | null }
type Pending = { id?: string; early: HistoryEvent[]; resolve: (messages: WAMessage[]) => void }
const pending = new Map<string, Pending>()
const lastRequest = new Map<string, number>()

/** Called before the ordinary observation handler. Only our correlated on-demand event is consumed. */
export function acceptHistoryPage(session: string, event: HistoryEvent): boolean {
  const request = pending.get(session)
  if (!request || event.syncType !== 6 || !event.peerDataRequestSessionId) return false
  if (!request.id) { request.early.push(event); return true }
  if (event.peerDataRequestSessionId !== request.id) return false
  request.resolve(event.messages)
  return true
}

export async function requestHistoryPage(input: {
  session: string; enabled: boolean; connected: boolean; anchor: WAMessageKey | null;
  timestampMs: number; fetch: (count: number, key: WAMessageKey, timestamp: number) => Promise<string>;
  now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number;
  authorize?: () => Promise<boolean>;
}): Promise<WAMessage[]> {
  const { session, anchor } = input
  if (!input.enabled || !input.connected || !anchor?.id || !anchor.remoteJid
    || !/@(s\.whatsapp\.net|lid)$/.test(anchor.remoteJid) || typeof anchor.fromMe !== 'boolean'
    || !Number.isFinite(input.timestampMs) || input.timestampMs <= 0) throw new Error('HISTORY_GATE_CLOSED')
  if (pending.has(session)) throw new Error('HISTORY_BUSY')
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectPage!: (reason: Error) => void
  const page = new Promise<WAMessage[]>((resolve, reject) => {
    rejectPage = reject
    pending.set(session, { early: [], resolve })
  })
  // Attach rejection handling before starting a possibly slow provider request.
  const handledPage = page.then(value => value)
  try {
    const delay = Math.max(0, (lastRequest.get(session) ?? -Infinity) + 5_000 - now())
    if (delay) await sleep(delay)
    if (input.authorize && !await input.authorize()) throw new Error('HISTORY_GATE_CLOSED')
    lastRequest.set(session, now())
    timer = setTimeout(() => rejectPage(new Error('HISTORY_PHONE_OFFLINE')), input.timeoutMs ?? 20_000)
    // fetchMessageHistory's timestamp field is oldestMsgTimestampMs in rc14.
    const owner = pending.get(session)
    const sending = input.fetch(50, anchor, input.timestampMs).then(id => {
      const request = pending.get(session)
      if (request && request === owner) {
        request.id = id
        for (const event of request.early) acceptHistoryPage(session, event)
        request.early = []
      }
    })
    sending.catch(error => rejectPage(error))
    const messages = await handledPage
    if (messages.some(message => message.key.remoteJid !== anchor.remoteJid)) throw new Error('HISTORY_CHAT_MISMATCH')
    return messages
  } finally {
    if (timer) clearTimeout(timer)
    pending.delete(session)
  }
}

export function historyMessage(message: WAMessage): Record<string, unknown> | null {
  const content = message.message
  if (!message.key.id) return null
  const inner = content?.ephemeralMessage?.message ?? content?.viewOnceMessage?.message ?? content ?? {}
  const media = inner.imageMessage ?? inner.videoMessage ?? inner.audioMessage ?? inner.documentMessage
  return {
    messageId: message.key.id, jid: message.key.remoteJid, fromMe: message.key.fromMe === true,
    timestamp: Number(message.messageTimestamp),
    message: inner.conversation ?? inner.extendedTextMessage?.text ?? ('caption' in (media ?? {}) ? (media as { caption?: string }).caption : null) ?? null,
    messageType: inner.imageMessage ? 'image' : inner.videoMessage ? 'video' : inner.audioMessage ? 'audio' : inner.documentMessage ? 'document' : 'text',
    mediaMime: media?.mimetype ?? null,
    mediaSize: media?.fileLength ? Number(media.fileLength) : null,
    mediaFilename: inner.documentMessage?.fileName ?? null,
    isBackfill: true, source: 'history-pull', observed: false,
  }
}
