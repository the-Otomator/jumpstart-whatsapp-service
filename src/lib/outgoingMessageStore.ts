/**
 * Per-session store of outgoing Baileys message content for getMessage retries.
 * Disk-backed under sessions/<orgId>/outgoing/ so restarts can still satisfy retries.
 */
import { promises as fsp } from 'fs'
import path from 'path'
import type { proto } from '@whiskeysockets/baileys'
import { logger } from './logger'

/** Keep messages long enough to cover delayed decrypt retries (WhatsApp can retry for days). */
export const OUTGOING_MSG_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Hard cap per session — oldest entries evicted when exceeded. */
export const OUTGOING_MSG_MAX_PER_SESSION = 5_000
/**
 * Run enforceBound every N successful stores (amortised), not on every write.
 * Worst-case overshoot above the cap: OUTGOING_MSG_ENFORCE_EVERY - 1 entries
 * (plus the write that triggers the next enforce).
 */
export const OUTGOING_MSG_ENFORCE_EVERY = 100
/** Drop crash-orphaned `.tmp` files older than this during eviction. */
export const OUTGOING_TMP_ORPHAN_MAX_AGE_MS = 5 * 60 * 1000

export interface StoredOutgoingMessage {
  remoteJid: string
  message: proto.IMessage
  storedAt: number
}

const SESSIONS_DIR = (): string => path.join(process.cwd(), 'sessions')

/** Per-org store counter for amortised eviction. */
const storeCounts = new Map<string, number>()

function storeDir(orgId: string): string {
  return path.join(SESSIONS_DIR(), orgId, 'outgoing')
}

function entryPath(orgId: string, messageId: string): string {
  // Sanitize id for filesystem (Baileys ids are alphanumeric but stay defensive).
  const safe = messageId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(storeDir(orgId), `${safe}.json`)
}

async function ensureDir(orgId: string): Promise<void> {
  await fsp.mkdir(storeDir(orgId), { recursive: true })
}

function isExpired(storedAt: number, now = Date.now()): boolean {
  return now - storedAt > OUTGOING_MSG_TTL_MS
}

/**
 * Persist an outgoing message for later getMessage lookup.
 * Never rejects — failures are logged and swallowed so sends are not failed.
 */
export async function storeOutgoingMessage(
  orgId: string,
  key: { id?: string | null; remoteJid?: string | null },
  message: proto.IMessage | null | undefined
): Promise<void> {
  const id = key.id
  if (!id || !message) return

  try {
    await ensureDir(orgId)
    const entry: StoredOutgoingMessage = {
      remoteJid: key.remoteJid ?? '',
      message,
      storedAt: Date.now(),
    }
    const finalPath = entryPath(orgId, id)
    const tmp = `${finalPath}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(entry), 'utf-8')
    await fsp.rename(tmp, finalPath)

    const n = (storeCounts.get(orgId) ?? 0) + 1
    storeCounts.set(orgId, n)
    if (n % OUTGOING_MSG_ENFORCE_EVERY === 0) {
      await enforceBound(orgId)
    }
  } catch (err) {
    logger.warn({ orgId, messageId: id, err }, 'Failed to store outgoing message for retry')
  }
}

/**
 * Look up stored content for a WAMessageKey.
 * Returns undefined on miss / expiry / error — never throws.
 */
export async function getOutgoingMessage(
  orgId: string,
  key: proto.IMessageKey
): Promise<proto.IMessage | undefined> {
  try {
    const id = key.id
    if (!id) return undefined
    const filePath = entryPath(orgId, id)

    let raw: string
    try {
      raw = await fsp.readFile(filePath, 'utf-8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return undefined
      throw err
    }

    const entry = JSON.parse(raw) as StoredOutgoingMessage
    if (isExpired(entry.storedAt)) {
      try {
        await fsp.unlink(filePath)
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

/**
 * Drop expired files and, if over cap, delete oldest first.
 *
 * Age / eviction order use filesystem mtime (mtimeMs), not JSON content.
 * Writes go through tmp + rename, so mtime is set at rename and tracks
 * `storedAt` closely enough for TTL and oldest-first eviction — do not
 * reintroduce readFile + JSON.parse here.
 */
export async function enforceBound(orgId: string): Promise<void> {
  const dir = storeDir(orgId)
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  const now = Date.now()
  type EntryMeta = { name: string; mtimeMs: number; full: string }
  const metas: EntryMeta[] = []

  await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name)

      if (name.endsWith('.tmp')) {
        try {
          const st = await fsp.stat(full)
          if (now - st.mtimeMs > OUTGOING_TMP_ORPHAN_MAX_AGE_MS) {
            await fsp.unlink(full)
          }
        } catch {
          // ignore
        }
        return
      }

      if (!name.endsWith('.json')) return

      try {
        const st = await fsp.stat(full)
        // mtimeMs ≈ storedAt (set at atomic rename after write) — see module comment above.
        if (isExpired(st.mtimeMs, now)) {
          await fsp.unlink(full)
          return
        }
        metas.push({ name, mtimeMs: st.mtimeMs, full })
      } catch {
        try {
          await fsp.unlink(full)
        } catch {
          // ignore
        }
      }
    })
  )

  if (metas.length <= OUTGOING_MSG_MAX_PER_SESSION) return

  metas.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const toRemove = metas.length - OUTGOING_MSG_MAX_PER_SESSION
  await Promise.all(
    metas.slice(0, toRemove).map(async (meta) => {
      try {
        await fsp.unlink(meta.full)
      } catch {
        // ignore
      }
    })
  )
}

/** Test helper: wipe a session's outgoing store. */
export async function clearOutgoingMessageStore(orgId: string): Promise<void> {
  storeCounts.delete(orgId)
  const dir = storeDir(orgId)
  try {
    await fsp.rm(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

/** Test helper: reset amortisation counter without wiping files. */
export function resetStoreCountForTests(orgId: string): void {
  storeCounts.delete(orgId)
}
