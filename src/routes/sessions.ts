import { Router, Request, Response } from 'express'
import { startSession, getQR, getStatus, stopSession, listActiveSessions } from '../sessionManager'
import {
  validateBody,
  validateParams,
  startSessionSchema,
  orgIdParamsSchema,
} from '../middleware/validate'
import { getWebhookFailures, clearWebhookFailures } from '../lib/webhookDispatcher'
import { orgLogger } from '../lib/logger'

const router = Router()

// ── List all active sessions ────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const all = listActiveSessions().map(({ qr, ...rest }) => rest)
  res.json({ sessions: all, count: all.length })
})

// ── Start a session ─────────────────────────────────────────────
router.post(
  '/:orgId/start',
  validateParams(orgIdParamsSchema),
  validateBody(startSessionSchema),
  async (req: Request, res: Response) => {
    const { orgId } = req.params
    const { webhookUrl } = req.body
    const log = orgLogger(orgId)

    try {
      await startSession(orgId, webhookUrl)
      log.info('Session start requested')
      res.json({ success: true, orgId, status: 'connecting' })
    } catch (err) {
      log.error({ err }, 'Failed to start session')
      res.status(500).json({
        error: (err as Error).message,
        code: 'SESSION_START_FAILED',
      })
    }
  }
)

// ── Get QR code ─────────────────────────────────────────────────
router.get(
  '/:orgId/qr',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    const qr = getQR(orgId)
    if (!qr) {
      res.status(404).json({
        error: 'No QR available — session not in QR state',
        code: 'QR_NOT_AVAILABLE',
      })
      return
    }
    res.json({ qr })
  }
)

// ── Get session status ──────────────────────────────────────────
router.get(
  '/:orgId/status',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    const session = getStatus(orgId)
    if (!session) {
      res.status(404).json({
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      })
      return
    }
    const { qr, ...status } = session
    res.json(status)
  }
)

// ── Stop a session ──────────────────────────────────────────────
router.delete(
  '/:orgId',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    stopSession(orgId)
    orgLogger(orgId).info('Session stopped via API')
    res.json({ success: true, orgId })
  }
)

// ── Webhook failures ────────────────────────────────────────────
router.get(
  '/:orgId/webhook-failures',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    const failures = getWebhookFailures(orgId)
    res.json({ failures, count: failures.length })
  }
)

router.delete(
  '/:orgId/webhook-failures',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    const cleared = clearWebhookFailures(orgId)
    res.json({ success: true, cleared })
  }
)

export default router
