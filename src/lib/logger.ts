import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

/** Baileys-compatible silent logger (suppresses internal noise) */
export const baileysLogger = pino({ level: 'silent' })

export function childLogger(name: string, extra?: Record<string, unknown>) {
  return logger.child({ module: name, ...extra })
}
