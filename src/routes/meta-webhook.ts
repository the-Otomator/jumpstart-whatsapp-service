import { Router, Request, Response } from 'express'
import { getMetaCloudProvider } from '../providers'
import { logger } from '../lib/logger'

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

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Meta webhook verified successfully')
    res.status(200).send(challenge)
    return
  }

  logger.warn({ mode, tokenMatch: token === verifyToken }, 'Meta webhook verification failed')
  res.status(403).send('Forbidden')
})

/**
 * POST /meta-webhook — Incoming messages + status updates
 * No auth — Meta sends these directly. Validation via payload structure.
 */
router.post('/', async (req: Request, res: Response) => {
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
