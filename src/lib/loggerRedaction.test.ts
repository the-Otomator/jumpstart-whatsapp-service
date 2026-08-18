import assert from 'assert'
import pino from 'pino'
import { LOG_REDACT_PATHS } from './logger'

const chunks: string[] = []
const destination = {
  write(chunk: string) {
    chunks.push(chunk)
  },
}

const testLogger = pino(
  { redact: { paths: LOG_REDACT_PATHS, censor: '[Redacted]' } },
  destination
)

testLogger.info({
  req: {
    headers: {
      authorization: 'Bearer authorization-secret',
      cookie: 'session=cookie-secret',
      'x-partner-key': 'partner-secret',
      'x-api-key': 'api-secret',
      'x-meta-access-token': 'meta-header-secret',
      'x-hub-signature-256': 'sha256=signature-secret',
      'x-wa-session-key': 'safe-session-key',
    },
    body: {
      webhookUrl: 'https://example.test/hook?secret=webhook-secret',
      metaAccessToken: 'meta-body-secret',
      meta: { accessToken: 'nested-access-secret' },
    },
  },
  webhookUrl: 'https://example.test/hook?secret=top-level-secret',
  session: { webhookUrl: 'https://example.test/hook?secret=child-secret' },
  accessToken: 'top-level-access-secret',
}, 'redaction check')

const output = chunks.join('')
for (const secret of [
  'authorization-secret',
  'cookie-secret',
  'partner-secret',
  'api-secret',
  'meta-header-secret',
  'signature-secret',
  'webhook-secret',
  'meta-body-secret',
  'nested-access-secret',
  'top-level-secret',
  'child-secret',
  'top-level-access-secret',
]) {
  assert(!output.includes(secret), `log output leaked ${secret}`)
}

assert(output.includes('[Redacted]'), 'log output did not include the redaction marker')
assert(output.includes('safe-session-key'), 'non-secret session identity was unexpectedly redacted')

console.log('loggerRedaction.test.ts: all checks passed')
