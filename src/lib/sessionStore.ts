import fs from 'fs'
import path from 'path'
import { childLogger } from './logger'

const log = childLogger('sessionStore')

export interface StoredSession {
  orgId: string
  webhookUrl?: string
}

const STORE_PATH = path.join(process.cwd(), 'sessions', '_store.json')

function ensureDir(): void {
  const dir = path.dirname(STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function saveSessionMeta(orgId: string, webhookUrl?: string): void {
  const all = loadAllSessions()
  all[orgId] = { orgId, webhookUrl }
  ensureDir()
  fs.writeFileSync(STORE_PATH, JSON.stringify(all, null, 2))
  log.debug({ orgId }, 'session meta saved')
}

export function removeSessionMeta(orgId: string): void {
  const all = loadAllSessions()
  delete all[orgId]
  ensureDir()
  fs.writeFileSync(STORE_PATH, JSON.stringify(all, null, 2))
  log.debug({ orgId }, 'session meta removed')
}

export function loadAllSessions(): Record<string, StoredSession> {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
