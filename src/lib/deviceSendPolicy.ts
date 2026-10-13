import { jumpstartSupabase } from './jumpstartSupabase'
import { orgLogger } from './logger'

type PolicyClient = { from: (table: string) => any }

/** No positive cache: queued jobs must recheck policy at delivery time. */
export async function readDeviceListenOnly(sessionKey: string, client: PolicyClient | null = jumpstartSupabase): Promise<boolean> {
  if (!client) throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
  const { data, error } = await client.from('wa_devices')
    .select('id, listen_only').eq('session_key', sessionKey).limit(2)
  if (error || !Array.isArray(data) || data.length !== 1 || typeof data[0].listen_only !== 'boolean') {
    throw new Error('WA_DEVICE_POLICY_UNAVAILABLE')
  }
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
