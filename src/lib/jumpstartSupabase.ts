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
