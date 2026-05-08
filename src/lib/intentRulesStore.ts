import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

export interface IntentRule {
  id: string
  name: string
  label: string
  description: string
  examples: string[]
  enabled: boolean
}

interface CacheEntry {
  rules: IntentRule[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = (Number(process.env.INTENT_CACHE_TTL_SECONDS) || 60) * 1000

const otomatorClient = (() => {
  const url = process.env.OTOMATOR_SUPABASE_URL
  const key = process.env.OTOMATOR_SUPABASE_SERVICE_KEY

  if (!url || !key) {
    logger.warn(
      'OTOMATOR_SUPABASE_URL or OTOMATOR_SUPABASE_SERVICE_KEY not set - intent classification disabled'
    )
    return null
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
})()

export async function getRules(orgId: string): Promise<IntentRule[]> {
  if (!otomatorClient) return []

  const cached = cache.get(orgId)
  if (cached && Date.now() < cached.expiresAt) return cached.rules

  try {
    const { data, error } = await otomatorClient
      .from('whatsapp_intent_rules')
      .select('id, name, label, description, examples, enabled')
      .eq('org_id', orgId)
      .eq('enabled', true)

    if (error) {
      logger.warn({ orgId, error: error.message }, 'Failed to fetch intent rules')
      return cached?.rules ?? []
    }

    const rules: IntentRule[] = (data ?? []).map((rule) => ({
      ...rule,
      examples: Array.isArray(rule.examples) ? rule.examples : [],
    }))

    cache.set(orgId, { rules, expiresAt: Date.now() + TTL_MS })
    return rules
  } catch (err) {
    logger.warn({ orgId, err }, 'Error fetching intent rules')
    return cached?.rules ?? []
  }
}

export function invalidateCache(orgId: string): void {
  cache.delete(orgId)
  logger.debug({ orgId }, 'Intent rules cache invalidated')
}
