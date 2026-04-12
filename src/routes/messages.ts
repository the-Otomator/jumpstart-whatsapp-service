import { Router, Request, Response } from 'express'
import { SendMessageRequest } from '../types'
import { validateBody, sendMessageSchema, sendBulkSchema } from '../middleware/validate'
import { orgLogger } from '../lib/logger'
import { getProviderForOrg } from '../providers'

const router = Router()

/** Shared by `POST /api/messages/send` and `POST /api/sessions/:orgId/send`. */
export async function sendWhatsAppMessage(req: SendMessageRequest): Promise<string> {
  const provider = getProviderForOrg(req.orgId)
  if (!provider) throw new Error(`Session ${req.orgId} not connected`)

  const status = provider.getStatus(req.orgId)
  if (!status || status.status !== 'connected') {
    throw new Error(`Session ${req.orgId} not connected`)
  }

  const result = await provider.sendMessage(req)
  return result.messageId
}

// ── Send single message ─────────────────────────────────────────
router.post('/send', validateBody(sendMessageSchema), async (req: Request, res: Response) => {
  const body = req.body as SendMessageRequest
  const log = orgLogger(body.orgId)

  try {
    const messageId = await sendWhatsAppMessage(body)
    log.info({ to: body.to, type: body.type, messageId }, 'Message sent')
    res.json({ success: true, messageId })
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
  const results: { to: string; success: boolean; messageId?: string; error?: string }[] = []

  for (const msg of messages) {
    const log = orgLogger(msg.orgId)
    try {
      const messageId = await sendWhatsAppMessage(msg)
      results.push({ to: msg.to, success: true, messageId })
      log.debug({ to: msg.to, messageId }, 'Bulk message sent')
    } catch (err) {
      const errMsg = (err as Error).message
      results.push({ to: msg.to, success: false, error: errMsg })
      log.warn({ to: msg.to, err: errMsg }, 'Bulk message failed')
    }
    // Rate limiting delay between messages
    await new Promise((r) => setTimeout(r, 1500))
  }

  const succeeded = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  res.json({ results, summary: { total: results.length, succeeded, failed } })
})

export default router
