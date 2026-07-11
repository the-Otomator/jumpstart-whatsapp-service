import { Router, Request, Response } from 'express'
import { SendMessageRequest, CapacityEstimateRequest } from '../types'
import {
  validateBody,
  sendMessageSchema,
  sendBulkSchema,
  capacityEstimateSchema,
} from '../middleware/validate'
import { orgLogger } from '../lib/logger'
import { getSenderPool } from '../pool'

const router = Router()

/** Shared by `POST /api/messages/send` and `POST /api/sessions/:orgId/send`. */
export async function sendWhatsAppMessage(req: SendMessageRequest): Promise<string> {
  const lane = req.lane ?? 'operational'
  const pool = getSenderPool(req.orgId)
  return pool.enqueueAndWait(req, lane)
}

// ── Capacity planner (marketing journeys / bulk send) ───────────
router.post(
  '/capacity-estimate',
  validateBody(capacityEstimateSchema),
  async (req: Request, res: Response) => {
    const body = req.body as CapacityEstimateRequest
    const pool = getSenderPool(body.orgId)
    const estimate = pool.estimateCapacity(body)
    res.json(estimate)
  }
)

// ── Pool status (per sender session) ────────────────────────────
router.get('/pool-status/:orgId', async (req: Request, res: Response) => {
  const orgId = req.params.orgId
  const pool = getSenderPool(orgId)
  res.json(pool.getStatus())
})

// ── Send single message ─────────────────────────────────────────
router.post('/send', validateBody(sendMessageSchema), async (req: Request, res: Response) => {
  const body = req.body as SendMessageRequest
  const log = orgLogger(body.orgId)
  const lane = body.lane ?? 'operational'

  try {
    if (body.enqueue && lane === 'marketing') {
      const pool = getSenderPool(body.orgId)
      const jobId = pool.enqueue(body, 'marketing')
      log.info({ to: body.to, type: body.type, jobId, lane }, 'Message enqueued')
      res.json({ success: true, queued: true, jobId, lane })
      return
    }

    const messageId = await sendWhatsAppMessage(body)
    log.info({ to: body.to, type: body.type, messageId, lane }, 'Message sent')
    res.json({ success: true, messageId, lane })
  } catch (err) {
    const msg = (err as Error).message
    const status = msg.includes('not connected') ? 404 : 500
    const code = msg.includes('not connected') ? 'SESSION_NOT_CONNECTED' : 'SEND_FAILED'
    log.error({ to: body.to, err: msg }, 'Failed to send message')
    res.status(status).json({ error: msg, code })
  }
})

// ── Send bulk messages ──────────────────────────────────────────
router.post('/send-bulk', validateBody(sendBulkSchema), async (req: Request, res: Response) => {
  const messages = req.body as SendMessageRequest[]
  const results: {
    to: string
    success: boolean
    messageId?: string
    jobId?: string
    queued?: boolean
    error?: string
  }[] = []

  for (const msg of messages) {
    const log = orgLogger(msg.orgId)
    const lane = msg.lane ?? 'marketing'

    try {
      if (msg.enqueue && lane === 'marketing') {
        const pool = getSenderPool(msg.orgId)
        const jobId = pool.enqueue(msg, 'marketing')
        results.push({ to: msg.to, success: true, jobId, queued: true })
        log.debug({ to: msg.to, jobId }, 'Bulk message enqueued')
        continue
      }

      const messageId = await sendWhatsAppMessage({ ...msg, lane })
      results.push({ to: msg.to, success: true, messageId })
      log.debug({ to: msg.to, messageId, lane }, 'Bulk message sent')
    } catch (err) {
      const errMsg = (err as Error).message
      results.push({ to: msg.to, success: false, error: errMsg })
      log.warn({ to: msg.to, err: errMsg }, 'Bulk message failed')
    }
  }

  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  res.json({ results, summary: { total: results.length, succeeded, failed } })
})

export default router
