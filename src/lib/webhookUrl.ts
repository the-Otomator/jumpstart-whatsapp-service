/** Shared webhook URL validation and secret redaction. */

export const WEBHOOK_URL_REQUIRED = 'WEBHOOK_URL_REQUIRED'

/** True when value is a non-empty absolute http(s) URL. */
export function isValidWebhookUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Redact `secret` query parameter so logs/API responses never leak the shared secret.
 * Leaves other query params intact. Returns the input unchanged if it is not a valid URL.
 */
export function redactWebhookUrl(url: string): string {
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('secret')) {
      parsed.searchParams.set('secret', '***')
    }
    return parsed.toString()
  } catch {
    // Best-effort for malformed URLs that still embed ?secret=
    return url.replace(/([?&]secret=)[^&]*/gi, '$1***')
  }
}

export class WebhookUrlRequiredError extends Error {
  readonly code = WEBHOOK_URL_REQUIRED

  constructor(message = 'webhookUrl is required and must be an absolute http(s) URL') {
    super(message)
    this.name = 'WebhookUrlRequiredError'
  }
}

/** Throw WebhookUrlRequiredError when url is missing/invalid. */
export function requireWebhookUrl(url: unknown): string {
  if (!isValidWebhookUrl(url)) {
    throw new WebhookUrlRequiredError()
  }
  return url.trim()
}
