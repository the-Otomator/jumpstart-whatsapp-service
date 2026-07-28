/**
 * Per-session Baileys encryption / retry telemetry.
 * Surfaced on GET /health so decrypt stuck-states are visible without VPS digging.
 */

export interface SessionCryptoStats {
  retryReceipts: number
  getMessageHits: number
  getMessageMisses: number
  decryptFailures: number
}

const stats = new Map<string, SessionCryptoStats>()

function empty(): SessionCryptoStats {
  return {
    retryReceipts: 0,
    getMessageHits: 0,
    getMessageMisses: 0,
    decryptFailures: 0,
  }
}

function bucket(orgId: string): SessionCryptoStats {
  let s = stats.get(orgId)
  if (!s) {
    s = empty()
    stats.set(orgId, s)
  }
  return s
}

export function recordRetryReceipt(orgId: string): void {
  bucket(orgId).retryReceipts += 1
}

export function recordGetMessageHit(orgId: string): void {
  bucket(orgId).getMessageHits += 1
}

export function recordGetMessageMiss(orgId: string): void {
  bucket(orgId).getMessageMisses += 1
}

export function recordDecryptFailure(orgId: string): void {
  bucket(orgId).decryptFailures += 1
}

export function getSessionCryptoStats(orgId: string): SessionCryptoStats {
  return { ...bucket(orgId) }
}

export function getAllCryptoStats(): Record<string, SessionCryptoStats> {
  const out: Record<string, SessionCryptoStats> = {}
  for (const [orgId, s] of stats) {
    out[orgId] = { ...s }
  }
  return out
}

/** Aggregate totals across sessions (for compact /health). */
export function getCryptoStatsTotals(): SessionCryptoStats & { sessionsTracked: number } {
  const totals = empty()
  let sessionsTracked = 0
  for (const s of stats.values()) {
    sessionsTracked += 1
    totals.retryReceipts += s.retryReceipts
    totals.getMessageHits += s.getMessageHits
    totals.getMessageMisses += s.getMessageMisses
    totals.decryptFailures += s.decryptFailures
  }
  return { ...totals, sessionsTracked }
}

/** Test helper. */
export function resetCryptoStats(): void {
  stats.clear()
}
