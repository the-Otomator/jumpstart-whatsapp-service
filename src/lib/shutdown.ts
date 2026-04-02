import { Server } from 'http'
import { logger } from './logger'
import { sockets, sessions } from '../sessionManager'

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

    // 2. Close all WhatsApp sockets cleanly
    const orgIds = Array.from(sockets.keys())
    logger.info({ count: orgIds.length }, 'Closing WhatsApp sessions')

    for (const orgId of orgIds) {
      try {
        const sock = sockets.get(orgId)
        if (sock) {
          sock.end(undefined)
          logger.debug({ orgId }, 'Session socket closed')
        }
      } catch (err) {
        logger.warn({ orgId, err }, 'Error closing session socket')
      }
    }

    sockets.clear()
    sessions.clear()

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
