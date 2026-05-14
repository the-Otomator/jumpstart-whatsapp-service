import { Server } from 'http'
import { logger } from './logger'
import { listActiveSessions, stopSession } from '../sessionManager'

let isShuttingDown = false

export function setupGracefulShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    logger.info({ signal }, 'Shutdown signal received, cleaning up...')

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

    // 3. Give a moment for cleanup, then exit
    setTimeout(() => {
      logger.info('Shutdown complete')
      process.exit(0)
    }, 2000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export function isServiceShuttingDown(): boolean {
  return isShuttingDown
}
