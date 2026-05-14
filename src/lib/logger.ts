import pino from 'pino'

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

export const logger = pino({
  level,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino/file', options: { destination: 1 } } // stdout in dev
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'whatsapp-service' },
})

/** Create a child logger scoped to a specific org */
export function orgLogger(orgId: string) {
  return logger.child({ orgId })
}
