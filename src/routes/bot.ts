import { Router, Request, Response } from 'express'
import { logger } from '../lib/logger'
import { processBotMessage } from '../bot'

const router = Router()

router.post('/process', async (req: Request, res: Response) => {
  const body = req.body
  const {
    organizationId,
    tenantUrl,
    tenantServiceKey,
    conversationId,
    messageId,
    messageBody,
    contactPhone,
    deviceId,
    orgIdOnDevice,
  } = body ?? {}

  if (
    !organizationId ||
    !tenantUrl ||
    !tenantServiceKey ||
    !conversationId ||
    !messageId ||
    !contactPhone ||
    !deviceId ||
    !orgIdOnDevice
  ) {
    res.status(400).json({ ok: false, error: 'Missing required fields' })
    return
  }

  try {
    const botRunId = await processBotMessage({
      organizationId,
      tenantUrl,
      tenantServiceKey,
      conversationId,
      messageId,
      messageBody: messageBody ?? '',
      contactPhone,
      deviceId,
      orgIdOnDevice,
      systemPrompt: body.systemPrompt,
      maxHistoryMessages: body.maxHistoryMessages,
    })
    res.json({ ok: true, botRunId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err: msg, conversationId }, 'POST /api/bot/process failed')
    res.json({ ok: false, error: msg })
  }
})

export default router
