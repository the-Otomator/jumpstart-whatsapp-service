import { Router, Request, Response } from 'express'
import { getMetaCloudProvider } from '../providers'
import { logger } from '../lib/logger'
import { verifyMetaSignature } from '../lib/metaWebhookVerify'
import { credentialMatches } from '../auth'

// TODO: unify into /webhooks/meta in a follow-up task
const router = Router()

/**
 * GET /meta-webhook — Webhook verification (Meta sends this on setup)
 * No auth — Meta calls this directly.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN

  const tokenMatch = typeof token === 'string'
    && typeof verifyToken === 'string'
    && verifyToken.length > 0
    && credentialMatches(token, verifyToken)
  if (mode === 'subscribe' && tokenMatch) {
    logger.info('Meta webhook verified successfully')
    res.status(200).send(challenge)
    return
  }

  logger.warn({ mode, tokenMatch }, 'Meta webhook verification failed')
  res.status(403).send('Forbidden')
})

/**
 * POST /meta-webhook — Incoming messages + status updates
 * Public endpoint, authenticated by Meta's X-Hub-Signature-256 HMAC.
 */
router.post('/', async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody as Buffer | undefined
  const signature = req.headers['x-hub-signature-256'] as string | undefined
  if (!rawBody || !verifyMetaSignature(rawBody, signature)) {
    logger.warn({ hasRawBody: !!rawBody, hasSignature: !!signature }, 'Legacy Meta webhook signature verification failed')
    res.status(401).json({ error: 'Invalid signature', code: 'SIGNATURE_INVALID' })
    return
  }

  // Meta requires 200 response quickly, process async
  res.status(200).send('EVENT_RECEIVED')

  try {
    const provider = getMetaCloudProvider()
    await provider.handleIncomingWebhook(req.body)
  } catch (err) {
    logger.error({ err }, 'Error processing Meta webhook')
  }
})

export default router
