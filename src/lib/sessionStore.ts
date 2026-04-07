import fs from 'fs'
import path from 'path'
import { logger } from './logger'

export interface SessionMeta {
  orgId: string
  provider?: 'baileys' | 'meta-cloud'
  webhookUrl?: string
  createdAt: string
  phoneNumber?: string
  lastConnected?: string
  autoRestore: boolean
  partnerName?: string
  // Meta Cloud specific
  metaPhoneNumberId?: string
  metaAccessToken?: string
  metaWabaId?: string
}

const SESSIONS_DIR = path.join(process.cwd(), 'sessions')

function metaPath(orgId: string): string {
  return path.join(SESSIONS_DIR, orgId, 'meta.json')
}

export function saveSessionMeta(meta: SessionMeta): void {
  const dir = path.join(SESSIONS_DIR, meta.orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(metaPath(meta.orgId), JSON.stringify(meta, null, 2), 'utf-8')
  logger.debug({ orgId: meta.orgId }, 'Session metadata saved')
}

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

export function updateSessionMeta(orgId: string, updates: Partial<SessionMeta>): void {
  const existing = loadSessionMeta(orgId)
  if (!existing) return
  saveSessionMeta({ ...existing, ...updates })
}

export function deleteSessionMeta(orgId: string): void {
  const filePath = metaPath(orgId)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    logger.debug({ orgId }, 'Session metadata deleted')
  }
}

export function deleteSessionAuthDir(orgId: string): void {
  const dir = path.join(SESSIONS_DIR, orgId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    logger.debug({ orgId }, 'Session directory removed')
  }
}

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

export function migrateSessionAuthDir(fromOrgId: string, toOrgId: string): void {
  if (fromOrgId === toOrgId) {
    logger.warn({ fromOrgId }, 'migrateSessionAuthDir: same org, skipping')
    return
  }
  const fromDir = path.join(SESSIONS_DIR, fromOrgId)
  const toDir = path.join(SESSIONS_DIR, toOrgId)
  const fromCreds = path.join(fromDir, 'creds.json')
  const toCreds = path.join(toDir, 'creds.json')
  if (!fs.existsSync(fromCreds)) throw new Error(`No WhatsApp credentials at source org ${fromOrgId}`)
  if (fs.existsSync(toDir)) {
    if (fs.existsSync(toCreds)) throw new Error(`Target org ${toOrgId} already has session data`)
    fs.rmSync(toDir, { recursive: true })
  }
  fs.renameSync(fromDir, toDir)
  const meta = loadSessionMeta(toOrgId)
  if (meta) saveSessionMeta({ ...meta, orgId: toOrgId })
}
