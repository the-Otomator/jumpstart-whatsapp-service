/**
 * Unit tests: disconnect reason formatting + reconcile + heartbeat payload.
 * Run: npx ts-node --transpile-only src/lib/waDeviceMonitor.test.ts
 */
import assert from 'assert'
import { Boom } from '@hapi/boom'
import { DisconnectReason } from '@whiskeysockets/baileys'
import { formatDisconnectReason, toWaDeviceStatus } from './disconnectReason'
import {
  buildHeartbeatUpdates,
  reconcileSessions,
  type WaDeviceRow,
} from './waDeviceReconcile'
import type { Session } from '../types'

function testFormatDisconnectReason(): void {
  // Classic bug: undefined statusCode used to yield "unknown (undefined)"
  assert.strictEqual(
    formatDisconnectReason({ error: undefined }),
    'unknown (no error)'
  )
  assert.strictEqual(formatDisconnectReason(undefined), 'unknown (no error)')
  assert.strictEqual(formatDisconnectReason(null), 'unknown (no error)')

  const loggedOut = new Boom('logged out', { statusCode: DisconnectReason.loggedOut })
  const lo = formatDisconnectReason({ error: loggedOut })
  assert.ok(lo.includes('401') || lo.includes('loggedOut') || lo.includes('logged out'), lo)

  const timedOut = new Boom('timed out', { statusCode: DisconnectReason.timedOut })
  const to = formatDisconnectReason({ error: timedOut })
  assert.ok(to.includes('408') || to.includes('timedOut') || to.includes('timed out'), to)

  // Error without Boom statusCode
  assert.strictEqual(
    formatDisconnectReason({ error: new Error('socket hang up') }),
    'socket hang up'
  )

  assert.strictEqual(toWaDeviceStatus('connected'), 'connected')
  assert.strictEqual(toWaDeviceStatus('qr'), 'qr')
  assert.strictEqual(toWaDeviceStatus('connecting'), 'disconnected')
  assert.strictEqual(toWaDeviceStatus('disconnected'), 'disconnected')
}

function testReconcile(): void {
  const live: Session[] = [
    {
      orgId: 'wm-workmatch-mnwwlhdg',
      provider: 'baileys',
      status: 'connected',
      phoneNumber: '972506927219',
    },
    {
      orgId: 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62-d1fde265',
      provider: 'baileys',
      status: 'connected',
      phoneNumber: '972505253669',
    },
  ]

  const rows: WaDeviceRow[] = [
    {
      id: '1',
      organization_id: 'org-lior',
      name: 'שיווק ליאור',
      session_key: '32f936f4-dead-beef-cafe-000000000001',
      status: 'disconnected',
      phone_number: '972504988277',
      last_error: null,
      alerted_at: null,
    },
    {
      id: '2',
      organization_id: 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62',
      name: 'Otomator main',
      session_key: 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62-d1fde265',
      status: 'disconnected', // mismatch vs live connected
      phone_number: '972505253669',
      last_error: null,
      alerted_at: null,
    },
  ]

  const r = reconcileSessions(live, rows)
  assert.strictEqual(r.orphanedSessions.length, 1)
  assert.strictEqual(r.orphanedSessions[0].sessionKey, 'wm-workmatch-mnwwlhdg')
  assert.strictEqual(r.orphanedRows.length, 1)
  assert.strictEqual(r.orphanedRows[0].name, 'שיווק ליאור')
  assert.strictEqual(r.stateMismatch.length, 1)
  assert.strictEqual(
    r.stateMismatch[0].sessionKey,
    'c3aa7a0d-461a-4ed4-882a-58bd063b1e62-d1fde265'
  )
  assert.strictEqual(r.stateMismatch[0].liveStatus, 'connected')
  assert.strictEqual(r.stateMismatch[0].dbStatus, 'disconnected')
}

function testHeartbeatPayload(): void {
  const live: Session[] = [
    {
      orgId: 'sess-open',
      provider: 'baileys',
      status: 'connected',
      phoneNumber: '972501111111',
    },
    {
      orgId: 'sess-half-open',
      provider: 'baileys',
      status: 'connected',
      phoneNumber: '972502222222',
    },
    {
      orgId: 'sess-qr',
      provider: 'baileys',
      status: 'qr',
    },
  ]

  const updates = buildHeartbeatUpdates(live, (key) => key === 'sess-open')
  assert.strictEqual(updates.length, 3)

  const open = updates.find((u) => u.session_key === 'sess-open')!
  assert.strictEqual(open.status, 'connected')
  assert.strictEqual(open.refresh_seen, true)
  assert.strictEqual(open.clear_error, true)

  const half = updates.find((u) => u.session_key === 'sess-half-open')!
  assert.strictEqual(half.status, 'disconnected')
  assert.strictEqual(half.refresh_seen, false)

  const qr = updates.find((u) => u.session_key === 'sess-qr')!
  assert.strictEqual(qr.status, 'qr')
  assert.strictEqual(qr.refresh_seen, false)
}

testFormatDisconnectReason()
testReconcile()
testHeartbeatPayload()
console.log('waDeviceMonitor.test.ts: all passed')
