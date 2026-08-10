import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from './logger'

/**
 * Jumpstart platform Supabase (dgxnnwnugdxzeopleera) — owns `public.wa_devices`.
 * Hub (mzalzjtsyrjycaxolldv) stays on SUPABASE_URL for org validation / whatsapp_devices.
 */
const JUMPSTART_URL =
  process.env.JUMPSTART_SUPABASE_URL ?? 'https://dgxnnwnugdxzeopleera.supabase.co'
const JUMPSTART_KEY = process.env.JUMPSTART_SUPABASE_SERVICE_KEY

if (!JUMPSTART_KEY) {
  logger.warn(
    'JUMPSTART_SUPABASE_SERVICE_KEY not set — wa_devices heartbeat/reconcile/alerts disabled'
  )
}

export const jumpstartSupabase: SupabaseClient | null = JUMPSTART_KEY
  ? createClient(JUMPSTART_URL, JUMPSTART_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

/** Resolve the fixed Jumpstart webhook only for a registered device session. */
export async function resolveJumpstartWebhookUrl(
  sessionKey: string,
  client: SupabaseClient | null = jumpstartSupabase
): Promise<string | null> {
  if (!client) return null

  const { data, error } = await client
    .from('wa_devices')
    .select('session_key')
    .eq('session_key', sessionKey)
    .maybeSingle()

  if (error) {
    logger.warn({ sessionKey, err: error.message }, 'Failed to resolve Jumpstart webhook')
    return null
  }
  if (!data?.session_key) return null

  return `${JUMPSTART_URL}/functions/v1/wa-webhook`
}
