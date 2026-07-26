import { listActiveSessions, getBaileysSocket } from '../sessionManager'
import { isSocketOpen } from '../providers/baileys/baileysProvider'
import { jumpstartSupabase } from './jumpstartSupabase'
import { logger } from './logger'
import { buildHeartbeatUpdates, type WaDeviceRow } from './waDeviceReconcile'
import { toWaDeviceStatus } from './disconnectReason'

const HEARTBEAT_INTERVAL_MS = Number(process.env.WA_HEARTBEAT_INTERVAL_MS ?? 60_000)
const OUTAGE_ALERT_MS = Number(process.env.WA_OUTAGE_ALERT_MS ?? 10 * 60_000)
const ALERT_TO = process.env.WA_ALERT_TO_PHONE ?? '972528393669'
const ALERT_FROM =
  process.env.WA_ALERT_FROM_SESSION_KEY ??
  'c3aa7a0d-461a-4ed4-882a-58bd063b1e62-d1fde265'

/** Default on. Set WA_SESSION_ALERTS=0|false|off to disable. */
function alertsEnabled(): boolean {
  const v = (process.env.WA_SESSION_ALERTS ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

let heartbeatFailures = 0
let timer: ReturnType<typeof setInterval> | null = null
/** Wall-clock when a live session first became non-connected (in-memory). */
const nonConnectedSince = new Map<string, number>()

export function getHeartbeatFailures(): number {
  return heartbeatFailures
}

export function resetHeartbeatFailuresForTests(): void {
  heartbeatFailures = 0
  nonConnectedSince.clear()
}

async function fetchDeviceRows(sessionKeys: string[]): Promise<WaDeviceRow[]> {
  if (!jumpstartSupabase || sessionKeys.length === 0) return []
  const { data, error } = await jumpstartSupabase
    .from('wa_devices')
    .select('id, organization_id, name, session_key, status, phone_number, last_error, alerted_at')
    .in('session_key', sessionKeys)

  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as WaDeviceRow[]
}

async function runHeartbeatTick(): Promise<void> {
  if (!jumpstartSupabase) return

  const live = listActiveSessions()
  const updates = buildHeartbeatUpdates(live, (key) => isSocketOpen(getBaileysSocket(key)))

  try {
    const { data, error } = await jumpstartSupabase.rpc('wa_devices_heartbeat', {
      p_updates: updates,
    })

    if (error) {
      heartbeatFailures += 1
      logger.warn(
        { err: error.message, heartbeatFailures, sessions: updates.length },
        'wa_devices heartbeat failed'
      )
      return
    }

    logger.debug(
      { sessions: updates.length, updated: data ?? null, heartbeatFailures },
      'wa_devices heartbeat ok'
    )
  } catch (err) {
    heartbeatFailures += 1
    logger.warn({ err, heartbeatFailures }, 'wa_devices heartbeat threw')
    return
  }

  if (alertsEnabled()) {
    try {
      await processOutageAlerts(live.map((s) => s.orgId))
    } catch (err) {
      logger.warn({ err }, 'wa_devices outage alert pass failed')
    }
  }
}

async function processOutageAlerts(liveKeys: string[]): Promise<void> {
  if (!jumpstartSupabase) return
  const now = Date.now()
  const live = listActiveSessions()
  const liveByKey = new Map(live.map((s) => [s.orgId, s]))

  // Track non-connected duration for live sessions only.
  for (const key of liveKeys) {
    const s = liveByKey.get(key)
    const status = s ? toWaDeviceStatus(s.status) : 'disconnected'
    const open = isSocketOpen(getBaileysSocket(key))
    const connected = status === 'connected' && open

    if (connected) {
      nonConnectedSince.delete(key)
    } else if (!nonConnectedSince.has(key)) {
      nonConnectedSince.set(key, now)
    }
  }

  // Drop tracking for sessions that left memory entirely.
  for (const key of [...nonConnectedSince.keys()]) {
    if (!liveByKey.has(key)) nonConnectedSince.delete(key)
  }

  const rows = await fetchDeviceRows(liveKeys)
  const rowByKey = new Map(rows.map((r) => [r.session_key, r]))

  for (const key of liveKeys) {
    const row = rowByKey.get(key)
    if (!row) continue

    const since = nonConnectedSince.get(key)
    const connected =
      toWaDeviceStatus(liveByKey.get(key)?.status ?? 'disconnected') === 'connected' &&
      isSocketOpen(getBaileysSocket(key))

    if (connected) {
      if (row.alerted_at) {
        await sendRecoveryAndClear(row)
      }
      continue
    }

    if (!since || now - since < OUTAGE_ALERT_MS) continue
    if (row.alerted_at) continue

    await sendOutageAlert(row, now - since)
  }
}

async function resolveAlertSender(downSessionKey: string): Promise<string | null> {
  if (ALERT_FROM !== downSessionKey) {
    const fromStatus = listActiveSessions().find((s) => s.orgId === ALERT_FROM)
    if (fromStatus?.status === 'connected' && isSocketOpen(getBaileysSocket(ALERT_FROM))) {
      return ALERT_FROM
    }
  }

  const fallback = listActiveSessions().find(
    (s) =>
      s.orgId !== downSessionKey &&
      s.status === 'connected' &&
      isSocketOpen(getBaileysSocket(s.orgId))
  )
  return fallback?.orgId ?? null
}

async function sendOutageAlert(row: WaDeviceRow, durationMs: number): Promise<void> {
  const mins = Math.round(durationMs / 60_000)
  const text =
    `⚠️ WA session down\n` +
    `Device: ${row.name}\n` +
    `Org: ${row.organization_id}\n` +
    `Session: ${row.session_key}\n` +
    `Down for: ~${mins} min\n` +
    `last_error: ${row.last_error ?? '(none)'}`

  const sender = await resolveAlertSender(row.session_key)
  if (!sender) {
    logger.warn(
      { sessionKey: row.session_key, name: row.name },
      'Outage alert suppressed — no healthy alerting session'
    )
    return
  }

  try {
    // Lazy import avoids circular deps (routes → sessionManager → providers → monitor).
    const { sendWhatsAppMessage } = await import('../routes/messages')
    await sendWhatsAppMessage({
      orgId: sender,
      to: ALERT_TO,
      type: 'text',
      message: text,
    })
    await jumpstartSupabase!
      .from('wa_devices')
      .update({ alerted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id)
    logger.info({ sessionKey: row.session_key, sender }, 'Outage alert sent')
  } catch (err) {
    logger.warn({ err, sessionKey: row.session_key }, 'Failed to send outage alert')
  }
}

async function sendRecoveryAndClear(row: WaDeviceRow): Promise<void> {
  const text =
    `✅ WA session back up\n` +
    `Device: ${row.name}\n` +
    `Org: ${row.organization_id}\n` +
    `Session: ${row.session_key}`

  const sender = await resolveAlertSender(row.session_key)
  if (!sender) {
    logger.warn(
      { sessionKey: row.session_key },
      'Recovery alert suppressed — no healthy alerting session; clearing alerted_at anyway'
    )
  } else {
    try {
      const { sendWhatsAppMessage } = await import('../routes/messages')
      await sendWhatsAppMessage({
        orgId: sender,
        to: ALERT_TO,
        type: 'text',
        message: text,
      })
      logger.info({ sessionKey: row.session_key, sender }, 'Recovery alert sent')
    } catch (err) {
      logger.warn({ err, sessionKey: row.session_key }, 'Failed to send recovery alert')
    }
  }

  await jumpstartSupabase!
    .from('wa_devices')
    .update({ alerted_at: null, updated_at: new Date().toISOString() })
    .eq('id', row.id)
}

export function startWaDeviceMonitor(): void {
  if (timer) return
  logger.info(
    {
      intervalMs: HEARTBEAT_INTERVAL_MS,
      alerts: alertsEnabled(),
      jumpstartConfigured: Boolean(jumpstartSupabase),
    },
    'Starting wa_devices session monitor'
  )
  // First tick after a short delay so restoreSessions can settle.
  setTimeout(() => {
    void runHeartbeatTick()
  }, 5_000)
  timer = setInterval(() => {
    void runHeartbeatTick()
  }, HEARTBEAT_INTERVAL_MS)
  // Unref so the timer does not keep the process alive during tests/shutdown races.
  if (typeof timer === 'object' && 'unref' in timer) {
    ;(timer as NodeJS.Timeout).unref()
  }
}

export function stopWaDeviceMonitor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
