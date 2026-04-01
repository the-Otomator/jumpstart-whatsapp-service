import { Server } from 'http'
import { childLogger } from './logger'

const log = childLogger('shutdown')

export function setupGracefulShutdown(
  server: Server,
  cleanup: () => Promise<void> | void,
): void {
  let shuttingDown = false

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'graceful shutdown initiated')

    server.close(() => log.info('http server closed'))

    try {
      await cleanup()
    } catch (err) {
      log.error({ err }, 'error during cleanup')
    }

    log.info('shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
