import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from './logger'
import { supabase as hubSupabase } from './supabase'

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
  client: SupabaseClient | null = jumpstartSupabase,
  hubClient: SupabaseClient | null = hubSupabase
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
  if (data?.session_key) return `${JUMPSTART_URL}/functions/v1/wa-webhook`

  // Legacy Jumpstart purchase links were registered only in the Hub table.
  // Require an exact Hub row, a session key derived from its org UUID, and an
  // existing Jumpstart organization before assigning Jumpstart's webhook.
  if (!hubClient) return null
  const { data: hubDevice, error: hubError } = await hubClient
    .from('whatsapp_devices')
    .select('org_id, session_key, provider')
    .eq('session_key', sessionKey)
    .maybeSingle()

  if (hubError) {
    logger.warn({ sessionKey, err: hubError.message }, 'Failed to resolve legacy Hub device')
    return null
  }

  const orgId = typeof hubDevice?.org_id === 'string' ? hubDevice.org_id : ''
  const isDerivedKey =
    sessionKey.startsWith(`${orgId}-`) || sessionKey.startsWith(`${orgId}__`)
  if (!orgId || hubDevice?.provider !== 'baileys' || !isDerivedKey) return null

  const { data: organization, error: orgError } = await client
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle()

  if (orgError) {
    logger.warn({ sessionKey, orgId, err: orgError.message }, 'Failed to verify Jumpstart org')
    return null
  }
  if (!organization?.id) return null

  return `${JUMPSTART_URL}/functions/v1/wa-webhook`
}
