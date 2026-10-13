import { jumpstartSupabase } from './jumpstartSupabase'
import { supabase as hubSupabase } from './supabase'
import { orgLogger } from './logger'

type PolicyClient = { from: (table: string) => any }

/** No positive cache: queued jobs must recheck policy at delivery time. */
export async function readDeviceListenOnly(sessionKey: string, client: PolicyClient | null = jumpstartSupabase, hub: PolicyClient | null = hubSupabase): Promise<boolean> {
  if (!client) throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
  const { data, error } = await client.from('wa_devices')
    .select('id, listen_only').eq('session_key', sessionKey).limit(2)
  if (error || !Array.isArray(data) || data.length > 1) {
    throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
  }
  if (data.length === 0) {
    // External products share this service. Never infer ownership from a key prefix
    // or disk metadata, and never fall back after a failed JumpStart lookup.
    if (!hub) throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
    const external = await hub.from('whatsapp_devices').select('org_id, webhook_url')
      .eq('session_key', sessionKey).limit(2)
    if (external.error || !Array.isArray(external.data) || external.data.length !== 1) throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
    const row = external.data[0]
    if (typeof row.org_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.org_id) || typeof row.webhook_url !== 'string') throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
    let url: URL
    try { url = new URL(row.webhook_url) } catch { throw new Error('WA_DEVICE_POLICY_UNAVAILABLE') }
    const jumpstartHost = new URL(process.env.JUMPSTART_SUPABASE_URL ?? 'https://dgxnnwnugdxzeopleera.supabase.co').hostname
    // The audited external adapter is WorkMatch's Supabase wa-incoming route.
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) || url.hostname === jumpstartHost || url.hostname === 'dgxnnwnugdxzeopleera.supabase.co' ||
        url.pathname !== '/functions/v1/wa-incoming') throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
    const owner = await client.from('organizations').select('id').eq('id', row.org_id).limit(1)
    if (owner.error || !Array.isArray(owner.data) || owner.data.length !== 0) throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
    return false
  }
  if (typeof data[0].listen_only !== 'boolean') throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
  return data[0].listen_only
}

export async function assertDeviceCanSend(sessionKey: string, client?: PolicyClient | null): Promise<void> {
  try {
    if (await readDeviceListenOnly(sessionKey, client)) throw new Error('WA_DEVICE_LISTEN_ONLY')
  } catch (error) {
    orgLogger(sessionKey).warn({ code: (error as Error).message }, 'WhatsApp send refused by device policy')
    throw error
  }
}
