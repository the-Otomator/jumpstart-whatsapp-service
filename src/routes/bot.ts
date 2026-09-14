import { Router, Request, Response } from 'express'
import { logger } from '../lib/logger'
import { processBotMessage } from '../bot'

const router = Router()

router.post('/process', async (req: Request, res: Response) => {
  const body = req.body
  const {
    organizationId,
    conversationId,
    messageId,
    messageBody,
    contactPhone,
    deviceId,
    orgIdOnDevice,
  } = body ?? {}

  if (
    !organizationId ||
    !conversationId ||
    !messageId ||
    !contactPhone ||
    !deviceId ||
    !orgIdOnDevice
  ) {
    res.status(400).json({ ok: false, error: 'Missing required fields' })
    return
  }

  const tenantUrl = process.env.BOT_SUPABASE_URL?.trim()
  const tenantServiceKey = process.env.BOT_SUPABASE_SERVICE_KEY?.trim()
  if (!tenantUrl || !tenantServiceKey) {
    logger.error('BOT_SUPABASE_URL or BOT_SUPABASE_SERVICE_KEY is not configured')
    res.status(503).json({ ok: false, error: 'Bot service is not configured' })
    return
  }

  try {
    const result = await processBotMessage({
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
      model: body.model,
      maxHistoryMessages: body.maxHistoryMessages,
    })
    res.json({
      ok: true,
      botRunId: result.runId,
      replyText: result.replyText,
      messageId: result.waMessageId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err: msg, conversationId }, 'POST /api/bot/process failed')
    res.json({ ok: false, error: msg })
  }
})

export default router
