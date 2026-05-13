import type { TemplateInfo } from '../types'

const TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  templates: TemplateInfo[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

export function getCached(orgId: string): TemplateInfo[] | null {
  const entry = cache.get(orgId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(orgId)
    return null
  }
  return entry.templates
}

export function setCache(orgId: string, templates: TemplateInfo[]): void {
  cache.set(orgId, { templates, fetchedAt: Date.now() })
}

export function invalidate(orgId: string): void {
  cache.delete(orgId)
}
