import pino from 'pino'

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

// Applied at the shared logger so request auto-logs and every child logger use
// the same credential policy. Keep webhook URLs redacted because legacy URLs
// may carry a query-string secret.
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-partner-key"]',
  'req.headers["x-api-key"]',
  'req.headers["x-meta-access-token"]',
  'req.headers["x-hub-signature-256"]',
  'webhookUrl',
  '*.webhookUrl',
  'sessions[*].webhookUrl',
  'req.body.webhookUrl',
  'req.body.metaAccessToken',
  'req.body.meta.accessToken',
  'metaAccessToken',
  'accessToken',
  '*.accessToken',
]

export const logger = pino({
  level,
  redact: { paths: LOG_REDACT_PATHS, censor: '[Redacted]' },
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
