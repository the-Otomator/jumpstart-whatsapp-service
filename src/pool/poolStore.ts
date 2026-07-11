import fs from 'fs'
import path from 'path'
import { logger } from '../lib/logger'
import type { PoolPersistedState } from './types'
import { createInitialHealth } from './healthScore'

const SESSIONS_DIR = path.join(process.cwd(), 'sessions')

function poolStatePath(orgId: string): string {
  return path.join(SESSIONS_DIR, orgId, 'wa_sender_rate_config.json')
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function createDefaultPoolState(orgId: string): PoolPersistedState {
  const now = new Date().toISOString()
  return {
    orgId,
    warmupStage: 0,
    warmupStartedAt: now,
    paused: false,
    health: createInitialHealth(),
    marketingSentDayKey: dayKey(),
    marketingSentToday: 0,
    marketingSentTimestamps: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function loadPoolState(orgId: string): PoolPersistedState {
  const filePath = poolStatePath(orgId)
  if (!fs.existsSync(filePath)) {
    return createDefaultPoolState(orgId)
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PoolPersistedState
    return {
      ...createDefaultPoolState(orgId),
      ...parsed,
      health: { ...createInitialHealth(), ...parsed.health },
    }
  } catch (err) {
    logger.warn({ orgId, err }, 'Failed to read pool state — using defaults')
    return createDefaultPoolState(orgId)
  }
}

export function savePoolState(state: PoolPersistedState): void {
  const dir = path.join(SESSIONS_DIR, state.orgId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const updated: PoolPersistedState = {
    ...state,
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(poolStatePath(state.orgId), JSON.stringify(updated, null, 2), 'utf-8')
}

export function resetMarketingDayIfNeeded(state: PoolPersistedState): PoolPersistedState {
  const today = dayKey()
  if (state.marketingSentDayKey === today) return state
  return {
    ...state,
    marketingSentDayKey: today,
    marketingSentToday: 0,
    marketingSentTimestamps: [],
  }
}
