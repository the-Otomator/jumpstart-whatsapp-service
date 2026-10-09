import { Server } from 'http'
import { logger } from './logger'
import { listActiveSessions, stopSession } from '../sessionManager'
import { flushAllAuthWrites } from './hardenedMultiFileAuthState'

let isShuttingDown = false

export function setupGracefulShutdown(
  server: Server,
  opts?: { onShutdown?: () => void }
): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    logger.info({ signal }, 'Shutdown signal received, cleaning up...')

    try {
      opts?.onShutdown?.()
    } catch (err) {
      logger.warn({ err }, 'onShutdown hook failed')
    }

    // 1. Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed')
    })

    // 2. Close all WhatsApp sessions (keep auth + meta on disk for next start)
    const active = listActiveSessions()
    logger.info({ count: active.length }, 'Closing WhatsApp sessions')

    for (const { orgId } of active) {
      try {
        stopSession(orgId, { keepAuthFiles: true })
        logger.debug({ orgId }, 'Session socket closed')
      } catch (err) {
        logger.warn({ orgId, err }, 'Error closing session')
      }
    }

    // Baileys emits creds.update without awaiting its listener. Draining the
    // per-folder queues is necessary before process.exit can discard writes.
    const capMs = 10_000
    let cap: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        flushAllAuthWrites(),
        new Promise<never>((_, reject) => {
          cap = setTimeout(() => reject(new Error('auth flush timed out')), capMs)
        }),
      ])
      logger.info('Auth writes flushed before shutdown')
    } catch (err) {
      logger.error({ err }, 'Auth writes did not flush before shutdown deadline')
    } finally {
      if (cap) clearTimeout(cap)
    }
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export function isServiceShuttingDown(): boolean {
  return isShuttingDown
}
