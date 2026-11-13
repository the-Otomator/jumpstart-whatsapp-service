import fs from 'fs'
import path from 'path'
import { logger } from './logger'
import type { WaChannel } from '../types'

export interface SessionMeta {
  orgId: string
  /** Defaults to Baileys when missing (existing installs). */
  provider?: 'baileys' | 'meta-cloud'
  /** phone ↔ baileys, official ↔ meta-cloud. Inferred from provider when missing (migration). */
  channel?: WaChannel
  webhookUrl?: string
  createdAt: string
  phoneNumber?: string
  lastConnected?: string
  autoRestore: boolean
  // Meta Cloud specific
  metaPhoneNumberId?: string
  metaAccessToken?: string
  metaWabaId?: string
}

function withChannel(meta: SessionMeta): SessionMeta {
  if (meta.channel === 'phone' || meta.channel === 'official') return meta
  const channel: WaChannel = meta.provider === 'meta-cloud' ? 'official' : 'phone'
  return { ...meta, channel }
}

const SESSIONS_DIR = (): string => path.join(process.cwd(), 'sessions')

/** Read only the pairing flag; never log WhatsApp credential material. */
export function hasStoredLoginIdentity(orgId: string): boolean {
  try {
    const credentials = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR(), orgId, 'creds.json'), 'utf-8'))
    // Baileys v7 selects login versus pairing using creds.me, not registered.
    // Live connected sessions can legitimately retain registered=false.
    return typeof credentials.me?.id === 'string' && credentials.me.id.length > 0
  } catch {
    return false
  }
}

function legacyMetaPath(orgId: string): string {
  return path.join(SESSIONS_DIR(), orgId, 'meta.json')
}

function channelMetaPath(orgId: string, channel: WaChannel): string {
  return path.join(SESSIONS_DIR(), orgId, `meta.${channel}.json`)
}

function readJsonMeta(filePath: string): SessionMeta | null {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionMeta
  } catch (err) {
    logger.warn({ filePath, err }, 'Failed to read session metadata')
    return null
  }
}

/**
 * One-time migrate legacy `meta.json` → `meta.<channel>.json` without touching Baileys creds
 * (no reconnect). Safe to call on every load.
 */
function migrateLegacyMetaFile(orgId: string): void {
  const legacy = legacyMetaPath(orgId)
  if (!fs.existsSync(legacy)) return
  const raw = readJsonMeta(legacy)
  if (!raw) return
  const normalized = withChannel(raw)
  const channel = normalized.channel!
  const dest = channelMetaPath(orgId, channel)
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, JSON.stringify(normalized, null, 2), 'utf-8')
    logger.info({ orgId, channel }, 'Migrated legacy meta.json to channel file')
  }
  try {
    fs.unlinkSync(legacy)
  } catch {
    // leave legacy if unlink fails; channel file is source of truth
  }
}

/** Save session metadata to disk (channel-scoped file). */
export function saveSessionMeta(meta: SessionMeta): void {
  const normalized = withChannel(meta)
  const channel = normalized.channel!
  const dir = path.join(SESSIONS_DIR(), normalized.orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  migrateLegacyMetaFile(normalized.orgId)
  fs.writeFileSync(channelMetaPath(normalized.orgId, channel), JSON.stringify(normalized, null, 2), 'utf-8')
  logger.debug({ orgId: normalized.orgId, channel }, 'Session metadata saved')
}

/**
 * Load session metadata.
 * - With channel: that channel only.
 * - Without channel: phone first, then official (legacy single-session callers / Baileys).
 */
export function loadSessionMeta(orgId: string, channel?: WaChannel): SessionMeta | null {
  migrateLegacyMetaFile(orgId)

  if (channel) {
    const meta = readJsonMeta(channelMetaPath(orgId, channel))
    return meta ? withChannel(meta) : null
  }

  const phone = readJsonMeta(channelMetaPath(orgId, 'phone'))
  if (phone) return withChannel(phone)

  const official = readJsonMeta(channelMetaPath(orgId, 'official'))
  if (official) return withChannel(official)

  // Legacy path if migrate could not run (e.g. empty parse)
  const legacy = readJsonMeta(legacyMetaPath(orgId))
  return legacy ? withChannel(legacy) : null
}

/** Update specific fields in session metadata */
export function updateSessionMeta(
  orgId: string,
  updates: Partial<SessionMeta>,
  channel?: WaChannel
): void {
  const existing = loadSessionMeta(orgId, channel ?? updates.channel)
  if (!existing) return

  const updated = withChannel({ ...existing, ...updates, orgId })
  saveSessionMeta(updated)
}

/** Delete session metadata for one channel (default: phone for back-compat). */
export function deleteSessionMeta(orgId: string, channel: WaChannel = 'phone'): void {
  migrateLegacyMetaFile(orgId)
  const filePath = channelMetaPath(orgId, channel)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    logger.debug({ orgId, channel }, 'Session metadata deleted')
  }
  // Clean leftover legacy if it matched this channel
  const legacy = readJsonMeta(legacyMetaPath(orgId))
  if (legacy && withChannel(legacy).channel === channel) {
    try {
      fs.unlinkSync(legacyMetaPath(orgId))
    } catch {
      /* ignore */
    }
  }
}

/**
 * Remove Baileys auth material for an org without wiping the official Meta channel.
 * Deletes creds/keys under `sessions/<orgId>/` and phone meta; keeps `meta.official.json`.
 */
export function deleteSessionAuthDir(orgId: string): void {
  const dir = path.join(SESSIONS_DIR(), orgId)
  if (!fs.existsSync(dir)) return

  migrateLegacyMetaFile(orgId)
  const officialMeta = readJsonMeta(channelMetaPath(orgId, 'official'))

  // Remove baileys artifacts but preserve official meta across recreate.
  for (const name of fs.readdirSync(dir)) {
    if (name === 'meta.official.json') continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
  }

  if (officialMeta) {
    saveSessionMeta(officialMeta)
  } else if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  logger.debug({ orgId }, 'Phone session directory purged (official meta preserved if present)')
}

/** List all org IDs that have session directories (for auto-restore) */
export function listStoredSessions(): string[] {
  const root = SESSIONS_DIR()
  if (!fs.existsSync(root)) return []

  return fs.readdirSync(root).filter((name) => {
    const dir = path.join(root, name)
    if (!fs.statSync(dir).isDirectory()) return false
    migrateLegacyMetaFile(name)
    return (
      fs.existsSync(path.join(dir, 'creds.json')) ||
      fs.existsSync(path.join(dir, 'meta.json')) ||
      fs.existsSync(path.join(dir, 'meta.phone.json')) ||
      fs.existsSync(path.join(dir, 'meta.official.json'))
    )
  })
}

/**
 * Move `sessions/<fromOrgId>` → `sessions/<toOrgId>` (including creds + meta).
 * Caller must stop the live socket first. Target must not already have creds.
 */
export function migrateSessionAuthDir(fromOrgId: string, toOrgId: string): void {
  if (fromOrgId === toOrgId) {
    logger.warn({ fromOrgId }, 'migrateSessionAuthDir: same org, skipping')
    return
  }

  migrateLegacyMetaFile(fromOrgId)

  const fromDir = path.join(SESSIONS_DIR(), fromOrgId)
  const toDir = path.join(SESSIONS_DIR(), toOrgId)
  const fromCreds = path.join(fromDir, 'creds.json')
  const toCreds = path.join(toDir, 'creds.json')

  if (!fs.existsSync(fromCreds)) {
    throw new Error(`No WhatsApp credentials at source org ${fromOrgId}`)
  }

  if (fs.existsSync(toDir)) {
    if (fs.existsSync(toCreds)) {
      throw new Error(
        `Target org ${toOrgId} already has session data — disconnect and remove it first, or pick another org`
      )
    }
    fs.rmSync(toDir, { recursive: true })
  }

  fs.renameSync(fromDir, toDir)

  for (const channel of ['phone', 'official'] as const) {
    const meta = loadSessionMeta(toOrgId, channel)
    if (meta) {
      saveSessionMeta({
        ...meta,
        orgId: toOrgId,
        channel,
      })
    }
  }
}
