import { childLogger } from './logger'

const log = childLogger('webhook')

const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 3000, 10000]

export async function dispatchWebhook(
  url: string,
  payload: object,
  retries = MAX_RETRIES,
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        log.debug({ url, status: res.status }, 'webhook delivered')
        return
      }
      log.warn({ url, status: res.status, attempt }, 'webhook non-ok response')
    } catch (err) {
      log.warn({ url, attempt, err }, 'webhook delivery failed')
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))
    }
  }
  log.error({ url }, 'webhook delivery exhausted all retries')
}
