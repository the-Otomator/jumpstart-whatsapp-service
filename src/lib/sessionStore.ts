import fs from 'fs'
import path from 'path'
import { logger } from './logger'

export interface SessionMeta {
  orgId: string
  webhookUrl?: string
  createdAt: string
  phoneNumber?: string
  lastConnected?: string
  autoRestore: boolean
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

/** List all org IDs that have session directories (for auto-restore) */
export function listStoredSessions(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return []

  return fs.readdirSync(SESSIONS_DIR).filter((name) => {
    const dir = path.join(SESSIONS_DIR, name)
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'creds.json'))
  })
}
