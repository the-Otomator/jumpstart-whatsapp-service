const TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface CacheEntry {
  subject: string
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

export function getCachedSubject(groupJid: string): string | null {
  const entry = cache.get(groupJid)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(groupJid)
    return null
  }
  return entry.subject
}

export function setCachedSubject(groupJid: string, subject: string): void {
  cache.set(groupJid, { subject, fetchedAt: Date.now() })
}
