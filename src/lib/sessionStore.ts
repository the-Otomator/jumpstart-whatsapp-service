import fs from 'fs'
import path from 'path'
import { logger } from './logger'

export interface SessionMeta {
  orgId: string
  /** Defaults to Baileys when missing (existing installs). */
  provider?: 'baileys' | 'meta-cloud'
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

const SESSIONS_DIR = path.join(process.cwd(), 'sessions')

function metaPath(orgId: string): string {
  return path.join(SESSIONS_DIR, orgId, 'meta.json')
}

/** Save session metadata to disk */
export function saveSessionMeta(meta: SessionMeta): void {
  const dir = path.join(SESSIONS_DIR, meta.orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(metaPath(meta.orgId), JSON.stringify(meta, null, 2), 'utf-8')
  logger.debug({ orgId: meta.orgId }, 'Session metadata saved')
}

/** Load session metadata from disk */
export function loadSessionMeta(orgId: string): SessionMeta | null {
  const filePath = metaPath(orgId)
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as SessionMeta
  } catch (err) {
    logger.warn({ orgId, err }, 'Failed to read session metadata')
    return null
  }
}

/** Update specific fields in session metadata */
export function updateSessionMeta(orgId: string, updates: Partial<SessionMeta>): void {
  const existing = loadSessionMeta(orgId)
  if (!existing) return

  const updated = { ...existing, ...updates }
  saveSessionMeta(updated)
}

/** Delete session metadata from disk */
export function deleteSessionMeta(orgId: string): void {
  const filePath = metaPath(orgId)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    logger.debug({ orgId }, 'Session metadata deleted')
  }
}

/** Remove `sessions/<orgId>` (creds, meta, keys) — next pairing needs a new QR scan */
export function deleteSessionAuthDir(orgId: string): void {
  const dir = path.join(SESSIONS_DIR, orgId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    logger.debug({ orgId }, 'Session directory removed')
  }
}

/** List all org IDs that have session directories (for auto-restore) */
export function listStoredSessions(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return []

  return fs.readdirSync(SESSIONS_DIR).filter((name) => {
    const dir = path.join(SESSIONS_DIR, name)
    return (
      fs.statSync(dir).isDirectory() &&
      (fs.existsSync(path.join(dir, 'creds.json')) || fs.existsSync(path.join(dir, 'meta.json')))
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

  const fromDir = path.join(SESSIONS_DIR, fromOrgId)
  const toDir = path.join(SESSIONS_DIR, toOrgId)
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

  const meta = loadSessionMeta(toOrgId)
  if (meta) {
    saveSessionMeta({
      ...meta,
      orgId: toOrgId,
    })
  }
}
