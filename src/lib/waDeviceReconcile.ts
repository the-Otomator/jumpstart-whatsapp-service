import type { Session } from '../types'

export interface WaDeviceRow {
  id: string
  organization_id: string
  name: string
  session_key: string
  status: string
  phone_number: string | null
  last_error: string | null
  alerted_at?: string | null
}

export interface OrphanedSession {
  sessionKey: string
  status: string
  phoneNumber: string | null
}

export interface OrphanedRow {
  id: string
  organizationId: string
  name: string
  sessionKey: string
  status: string
  phoneNumber: string | null
}

export interface StateMismatch {
  sessionKey: string
  liveStatus: string
  dbStatus: string
  name: string
  organizationId: string
}

export interface ReconcileResult {
  orphanedSessions: OrphanedSession[]
  orphanedRows: OrphanedRow[]
  stateMismatch: StateMismatch[]
}

/** Pure reconcile — live sessions vs wa_devices rows. Writes nothing. */
export function reconcileSessions(
  live: Session[],
  rows: WaDeviceRow[]
): ReconcileResult {
  const liveByKey = new Map(live.map((s) => [s.orgId, s]))
  const rowByKey = new Map(rows.map((r) => [r.session_key, r]))

  const orphanedSessions: OrphanedSession[] = []
  for (const s of live) {
    if (!rowByKey.has(s.orgId)) {
      orphanedSessions.push({
        sessionKey: s.orgId,
        status: s.status,
        phoneNumber: s.phoneNumber ?? null,
      })
    }
  }

  const orphanedRows: OrphanedRow[] = []
  const stateMismatch: StateMismatch[] = []
  for (const r of rows) {
    const liveSession = liveByKey.get(r.session_key)
    if (!liveSession) {
      orphanedRows.push({
        id: r.id,
        organizationId: r.organization_id,
        name: r.name,
        sessionKey: r.session_key,
        status: r.status,
        phoneNumber: r.phone_number,
      })
      continue
    }
    // Compare using the same vocabulary heartbeat writes (connected/qr/disconnected).
    const liveStatus =
      liveSession.status === 'connected'
        ? 'connected'
        : liveSession.status === 'qr'
          ? 'qr'
          : 'disconnected'
    if (liveStatus !== r.status) {
      stateMismatch.push({
        sessionKey: r.session_key,
        liveStatus,
        dbStatus: r.status,
        name: r.name,
        organizationId: r.organization_id,
      })
    }
  }

  return { orphanedSessions, orphanedRows, stateMismatch }
}

export interface HeartbeatUpdate {
  session_key: string
  status: string
  refresh_seen: boolean
  last_error: string | null
  clear_error: boolean
}

/** Build one batched heartbeat payload from live sessions. */
export function buildHeartbeatUpdates(
  live: Session[],
  isOpen: (sessionKey: string) => boolean
): HeartbeatUpdate[] {
  return live.map((s) => {
    const open = isOpen(s.orgId)
    const status =
      s.status === 'connected' && open
        ? 'connected'
        : s.status === 'qr'
          ? 'qr'
          : 'disconnected'
    const healthy = status === 'connected'
    return {
      session_key: s.orgId,
      status,
      refresh_seen: healthy,
      last_error: null,
      clear_error: healthy,
    }
  })
}
