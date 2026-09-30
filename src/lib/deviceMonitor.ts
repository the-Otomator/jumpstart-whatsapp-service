import { listActiveSessions, getBaileysSocket } from '../sessionManager'
import { listStoredSessions } from './sessionStore'
import { supabase, updateDeviceStatus } from './supabase'
import { logger } from './logger'
import { withTimeout } from './withTimeout'

const INTERVAL_MS = 30_000
const OUTAGE_MS = 2 * 60_000
const downSince = new Map<string, number>()
const alerted = new Set<string>()
let ticking = false

export interface MonitoredDevice {
  session_key: string
  status: string
}

/** One device transition; dependencies are injected so alert delivery is testable. */
export async function processDeviceState(
  row: MonitoredDevice,
  connected: boolean,
  now: number,
  writeStatus: (key: string, status: 'connected' | 'disconnected') => Promise<void>,
  sendAlert: (message: string) => Promise<void>
): Promise<void> {
  const key = row.session_key
  const status = connected ? 'connected' : 'disconnected'
  if (row.status !== status) await writeStatus(key, status)
  if (connected) {
    downSince.delete(key)
    alerted.delete(key)
    return
  }
  if (!downSince.has(key)) downSince.set(key, now)
  if (now - downSince.get(key)! < OUTAGE_MS || alerted.has(key)) return
  await sendAlert(`⚠️ WA session down\nSession: ${key}\nDown for: ${Math.floor((now - downSince.get(key)!) / 60_000)} min`)
  alerted.add(key)
}

function liveConnected(key: string): boolean {
  const session = listActiveSessions().find((item) => item.orgId === key)
  if (session?.status !== 'connected') return false
  if (session.provider !== 'baileys') return true
  return (getBaileysSocket(key) as { ws?: { readyState?: number } } | undefined)?.ws?.readyState === 1
}

export async function runDeviceMonitorTick(): Promise<void> {
  if (!supabase) return
  const keys = listStoredSessions()
  if (keys.length === 0) return
  const { data, error } = await supabase
    .from('whatsapp_devices')
    .select('session_key,status')
    .in('session_key', keys)
  if (error) throw error
  for (const row of (data ?? []) as MonitoredDevice[]) {
    try {
      await processDeviceState(row, liveConnected(row.session_key), Date.now(),
      (key, status) => updateDeviceStatus(key, status),
      async (message) => {
        const to = process.env.WA_ALERT_TO_PHONE
        if (!to) throw new Error('WA_ALERT_TO_PHONE is not configured')
        const sender = listActiveSessions().find((item) => item.orgId !== row.session_key && liveConnected(item.orgId))
        if (!sender) throw new Error('No healthy alert sender')
        const { sendWhatsAppMessage } = await import('../routes/messages')
        await withTimeout(sendWhatsAppMessage({ orgId: sender.orgId, to, type: 'text', message }), 15_000, 'alert_timeout')
      })
    } catch (err) {
      logger.warn({ err, sessionKey: row.session_key }, 'Device status or alert failed')
    }
  }
}

export function startDeviceMonitor(): void {
  const tick = () => {
    if (ticking) return
    ticking = true
    void runDeviceMonitorTick()
      .catch((err) => logger.warn({ err }, 'Device monitor tick failed'))
      .finally(() => { ticking = false })
  }
  setTimeout(tick, 5_000).unref()
  setInterval(tick, INTERVAL_MS).unref()
}
