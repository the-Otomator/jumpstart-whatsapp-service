/**
 * Per-session store of outgoing Baileys message content for getMessage retries.
 * Disk-backed under sessions/<orgId>/outgoing/ so restarts can still satisfy retries.
 */
import fs from 'fs'
import path from 'path'
import type { proto } from '@whiskeysockets/baileys'
import { logger } from './logger'

/** Keep messages long enough to cover delayed decrypt retries (WhatsApp can retry for days). */
export const OUTGOING_MSG_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Hard cap per session — oldest entries evicted when exceeded. */
export const OUTGOING_MSG_MAX_PER_SESSION = 5_000

export interface StoredOutgoingMessage {
  remoteJid: string
  message: proto.IMessage
  storedAt: number
}

const SESSIONS_DIR = (): string => path.join(process.cwd(), 'sessions')

function storeDir(orgId: string): string {
  return path.join(SESSIONS_DIR(), orgId, 'outgoing')
}

function entryPath(orgId: string, messageId: string): string {
  // Sanitize id for filesystem (Baileys ids are alphanumeric but stay defensive).
  const safe = messageId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(storeDir(orgId), `${safe}.json`)
}

function ensureDir(orgId: string): void {
  const dir = storeDir(orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function isExpired(storedAt: number, now = Date.now()): boolean {
  return now - storedAt > OUTGOING_MSG_TTL_MS
}

/** Persist an outgoing message for later getMessage lookup. */
export function storeOutgoingMessage(
  orgId: string,
  key: { id?: string | null; remoteJid?: string | null },
  message: proto.IMessage | null | undefined
): void {
  const id = key.id
  if (!id || !message) return

  try {
    ensureDir(orgId)
    const entry: StoredOutgoingMessage = {
      remoteJid: key.remoteJid ?? '',
      message,
      storedAt: Date.now(),
    }
    const tmp = `${entryPath(orgId, id)}.tmp`
    const finalPath = entryPath(orgId, id)
    fs.writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
    fs.renameSync(tmp, finalPath)
    enforceBound(orgId)
  } catch (err) {
    logger.warn({ orgId, messageId: id, err }, 'Failed to store outgoing message for retry')
  }
}

/**
 * Look up stored content for a WAMessageKey.
 * Returns undefined on miss / expiry / error — never throws.
 */
export function getOutgoingMessage(
  orgId: string,
  key: proto.IMessageKey
): proto.IMessage | undefined {
  try {
    const id = key.id
    if (!id) return undefined
    const filePath = entryPath(orgId, id)
    if (!fs.existsSync(filePath)) return undefined

    const raw = fs.readFileSync(filePath, 'utf-8')
    const entry = JSON.parse(raw) as StoredOutgoingMessage
    if (isExpired(entry.storedAt)) {
      try {
        fs.unlinkSync(filePath)
      } catch {
        // best-effort
      }
      return undefined
    }
    // If remoteJid is present on both, require match so one chat cannot pull another's content.
    if (key.remoteJid && entry.remoteJid && key.remoteJid !== entry.remoteJid) {
      return undefined
    }
    return entry.message
  } catch {
    return undefined
  }
}

/** Drop expired files and, if over cap, delete oldest first. */
export function enforceBound(orgId: string): void {
  const dir = storeDir(orgId)
  if (!fs.existsSync(dir)) return

  const now = Date.now()
  type EntryMeta = { name: string; storedAt: number; full: string }
  const metas: EntryMeta[] = []

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const full = path.join(dir, name)
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const entry = JSON.parse(raw) as StoredOutgoingMessage
      if (isExpired(entry.storedAt, now)) {
        fs.unlinkSync(full)
        continue
      }
      metas.push({ name, storedAt: entry.storedAt, full })
    } catch {
      try {
        fs.unlinkSync(full)
      } catch {
        // ignore
      }
    }
  }

  if (metas.length <= OUTGOING_MSG_MAX_PER_SESSION) return

  metas.sort((a, b) => a.storedAt - b.storedAt)
  const toRemove = metas.length - OUTGOING_MSG_MAX_PER_SESSION
  for (let i = 0; i < toRemove; i++) {
    try {
      fs.unlinkSync(metas[i].full)
    } catch {
      // ignore
    }
  }
}

/** Test helper: wipe a session's outgoing store. */
export function clearOutgoingMessageStore(orgId: string): void {
  const dir = storeDir(orgId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
