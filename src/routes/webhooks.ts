import { Router, Request, Response } from 'express'
import { verifyMetaSignature } from '../lib/metaWebhookVerify'
import { getMetaCloudProvider } from '../providers'
import { postWebhook } from '../lib/webhookDispatcher'
import { logger } from '../lib/logger'

const router = Router()

/**
 * GET /webhooks/meta — Meta webhook verification handshake.
 * Meta sends this when you register/change the webhook URL in App Dashboard.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Meta webhook (/webhooks/meta) verified successfully')
    res.status(200).send(challenge)
    return
  }

  logger.warn({ mode, tokenMatch: token === verifyToken }, 'Meta webhook verification failed (/webhooks/meta)')
  res.status(403).send('Forbidden')
})

/**
 * POST /webhooks/meta — Incoming events from Meta (template status updates, etc.)
 * Public endpoint, but HMAC-verified via X-Hub-Signature-256 + META_APP_SECRET.
 */
router.post('/', async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody as Buffer | undefined
  const signature = req.headers['x-hub-signature-256'] as string | undefined

  if (!rawBody || !verifyMetaSignature(rawBody, signature)) {
    logger.warn({ hasRawBody: !!rawBody, hasSignature: !!signature }, 'Meta webhook signature verification failed')
    res.status(401).json({ error: 'Invalid signature', code: 'SIGNATURE_INVALID' })
    return
  }

  // Return 200 quickly — Meta requires fast ack
  res.status(200).send('EVENT_RECEIVED')

  try {
    await processWebhookPayload(req.body)
  } catch (err) {
    logger.error({ err }, 'Error processing Meta webhook (/webhooks/meta)')
  }
})

// ── Payload processing ─────────────────────────────────────────

async function processWebhookPayload(body: any): Promise<void> {
  if (!body?.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const field = change.field
      const value = change.value

      if (field === 'message_template_status_update') {
        await handleTemplateStatusUpdate(value)
      }
    }
  }
}

/**
 * Forward template_status_update events to the org's webhookUrl.
 * Resolves the org via the MetaCloudProvider's active sessions (phoneNumberId → orgId).
 */
async function handleTemplateStatusUpdate(value: any): Promise<void> {
  const event = value?.event
  const templateName = value?.message_template_name
  const templateId = value?.message_template_id?.toString()
  const newStatus = value?.event // 'APPROVED' | 'REJECTED' | 'PENDING' | 'DISABLED' etc.

  logger.info({ templateName, templateId, event: newStatus }, 'Template status update received')

  // Resolve orgId — Meta sends the WABA ID in the entry-level account info,
  // but the value itself doesn't always include phoneNumberId.
  // We try to match via the provider's active sessions.
  const provider = getMetaCloudProvider()
  const sessions = provider.listActiveSessions()

  // For template status updates, the org context comes from the entry.
  // We forward to ALL active Meta Cloud session webhook URLs since the
  // WABA is shared at the org level. In practice, each WABA maps to one org.
  for (const session of sessions) {
    if (!session.webhookUrl) continue

    const payload = {
      event: 'template_status',
      orgId: session.orgId,
      provider: 'meta-cloud',
      templateName: templateName ?? null,
      templateId: templateId ?? null,
      status: newStatus ?? null,
      rawValue: value,
    }

    await postWebhook(session.webhookUrl, payload)
  }

  if (sessions.length === 0) {
    logger.warn({ templateName, event: newStatus }, 'Template status update received but no active Meta Cloud sessions to forward to')
  }
}

export default router
