import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { QueuedJob } from './types'
import { orgLogger } from '../lib/logger'

type StoredJob = Pick<QueuedJob, 'id' | 'req' | 'lane' | 'enqueuedAt' | 'paymentHeld'>
type Outcome = 'sending' | 'sent' | 'failed' | 'restricted' | 'expired'

function directory(session: string): string {
  if (!/^[\w-]+$/.test(session)) throw new Error('invalid_sender_session')
  return path.join(process.cwd(), 'sessions', session, 'send-queue')
}

function write(session: string, id: string, entry: StoredJob | { outcome: Outcome; at: number }) {
  if (!/^[\w-]+$/.test(id)) throw new Error('invalid_sender_job')
  const dir = directory(session)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, id + '.json')
  const temp = path.join(dir, randomUUID() + '.tmp')
  try {
    fs.writeFileSync(temp, JSON.stringify(entry), { mode: 0o600, flag: 'wx', flush: true })
    fs.renameSync(temp, target)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

export function storeSenderJob(session: string, job: StoredJob): void {
  const { signal: _signal, ...req } = job.req
  write(session, job.id, { id: job.id, req, lane: job.lane, enqueuedAt: job.enqueuedAt, paymentHeld: job.paymentHeld })
}

export function recordSenderJobOutcome(session: string, id: string, outcome: Outcome): void {
  const skipped = outcome === 'restricted' || outcome === 'expired'
  write(session, id, { outcome, at: Date.now(), ...(skipped ? { status: 'skipped', reason: outcome } : {}) })
}

export function restoreSenderJobs(session: string): StoredJob[] {
  const dir = directory(session)
  if (!fs.existsSync(dir)) return []
  const jobs: StoredJob[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const file = path.join(dir, entry.name)
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredJob | { outcome: Outcome; at: number }
      if ('req' in stored && stored.id + '.json' === entry.name && stored.req.orgId === session) jobs.push(stored)
      else if ('at' in stored && Date.now() - stored.at > 7 * 86_400_000) fs.unlinkSync(file)
    } catch {
      orgLogger(session).warn({ jobFile: entry.name }, 'Could not read a durable WhatsApp queue record')
    }
  }
  return jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt)
}
