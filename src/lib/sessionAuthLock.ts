/**
 * Single-writer lock per sessions/<sessionKey>/ directory.
 * Prevents two processes from opening the same Baileys auth state (ratch corruption).
 */
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { logger } from './logger'

const SESSIONS_DIR = (): string => path.join(process.cwd(), 'sessions')
const LOCK_FILENAME = '.session.lock'

/** Stable for process lifetime — distinguishes this boot from a recycled PID. */
export const PROCESS_BOOT_ID =
  process.env.WA_BOOT_ID ?? `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`

export interface SessionLockPayload {
  pid: number
  bootId: string
  acquiredAt: string
  hostname?: string
}

export class SessionLockError extends Error {
  readonly code = 'SESSION_LOCK_HELD'
  constructor(
    public readonly orgId: string,
    public readonly holder: SessionLockPayload
  ) {
    super(
      `Session lock held for ${orgId} by pid=${holder.pid} bootId=${holder.bootId}`
    )
    this.name = 'SessionLockError'
  }
}

function lockPath(orgId: string): string {
  return path.join(SESSIONS_DIR(), orgId, LOCK_FILENAME)
}

function readLock(orgId: string): SessionLockPayload | null {
  const filePath = lockPath(orgId)
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionLockPayload
  } catch {
    return null
  }
}

function writeLockAtomic(orgId: string, payload: SessionLockPayload): void {
  const dir = path.join(SESSIONS_DIR(), orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const finalPath = lockPath(orgId)
  const tmp = `${finalPath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
  fs.renameSync(tmp, finalPath)
}

/** True if a process with this pid appears to be alive (best-effort, Windows + POSIX). */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM: process exists but we lack permission — treat as alive.
    if (code === 'EPERM') return true
    return false
  }
}

function isLockHeldByUs(holder: SessionLockPayload): boolean {
  return holder.pid === process.pid && holder.bootId === PROCESS_BOOT_ID
}

/**
 * Acquire exclusive lock for a session auth dir.
 * Reclaims stale locks (dead PID, or same PID with a previous boot id after process restart).
 * Throws SessionLockError if another live process holds the lock.
 */
export function acquireSessionLock(orgId: string): SessionLockPayload {
  const existing = readLock(orgId)
  if (existing) {
    if (isLockHeldByUs(existing)) {
      return existing
    }
    // Same PID + different bootId ⇒ this process restarted and reused the OS pid; reclaim.
    if (existing.pid === process.pid && existing.bootId !== PROCESS_BOOT_ID) {
      logger.warn(
        { orgId, staleBootId: existing.bootId },
        'Reclaiming session lock from previous boot of this process'
      )
    } else if (isPidAlive(existing.pid)) {
      logger.error(
        { orgId, holderPid: existing.pid, holderBootId: existing.bootId },
        'Refusing to open Baileys session — lock held by another live process'
      )
      throw new SessionLockError(orgId, existing)
    } else {
      logger.warn(
        { orgId, stalePid: existing.pid, staleBootId: existing.bootId },
        'Reclaiming stale Baileys session lock'
      )
    }
  }

  const payload: SessionLockPayload = {
    pid: process.pid,
    bootId: PROCESS_BOOT_ID,
    acquiredAt: new Date().toISOString(),
    hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME,
  }
  writeLockAtomic(orgId, payload)
  return payload
}

/** Release lock only if we still own it. */
export function releaseSessionLock(orgId: string): void {
  const existing = readLock(orgId)
  if (!existing) return
  if (!isLockHeldByUs(existing)) {
    logger.warn(
      { orgId, holderPid: existing.pid },
      'Not releasing session lock — owned by another process'
    )
    return
  }
  try {
    fs.unlinkSync(lockPath(orgId))
  } catch (err) {
    logger.warn({ orgId, err }, 'Failed to release session lock')
  }
}

/** Test helper. */
export function readSessionLock(orgId: string): SessionLockPayload | null {
  return readLock(orgId)
}

/** Test helper: plant a lock file as if held by another process. */
export function plantSessionLock(orgId: string, payload: SessionLockPayload): void {
  writeLockAtomic(orgId, payload)
}
