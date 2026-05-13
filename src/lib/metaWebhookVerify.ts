import crypto from 'crypto'
import { logger } from './logger'

/**
 * Verify the X-Hub-Signature-256 header from Meta webhooks.
 * Uses META_APP_SECRET (Otomator umbrella app) as the HMAC key.
 * Returns true if signature is valid, false otherwise.
 */
export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    logger.warn('META_APP_SECRET not set — rejecting all webhook signatures')
    return false
  }

  if (!signatureHeader) {
    logger.warn('Missing X-Hub-Signature-256 header')
    return false
  }

  const expectedPrefix = 'sha256='
  if (!signatureHeader.startsWith(expectedPrefix)) {
    logger.warn('X-Hub-Signature-256 header does not start with sha256=')
    return false
  }

  const receivedSig = signatureHeader.slice(expectedPrefix.length)
  const expectedSig = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSig, 'hex'),
      Buffer.from(expectedSig, 'hex'),
    )
  } catch {
    return false
  }
}
