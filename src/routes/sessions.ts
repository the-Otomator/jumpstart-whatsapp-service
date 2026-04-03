import { Router, Request, Response } from 'express'
import {
  startSession,
  migrateSession,
  getQR,
  getStatus,
  stopSession,
  listActiveSessions,
} from '../sessionManager'
import {
  validateBody,
  validateParams,
  startSessionSchema,
  migrateSessionSchema,
  orgIdParamsSchema,
} from '../middleware/validate'
import { getWebhookFailures, clearWebhookFailures } from '../lib/webhookDispatcher'
import { orgLogger } from '../lib/logger'
import { validateOrg } from '../lib/supabase'

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

    const orgCheck = await validateOrg(orgId)
    if (!orgCheck.valid) {
      res.status(403).json({
        error: 'No active subscription for this organization',
        code: 'ORG_NOT_AUTHORIZED',
      })
      return
    }

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

// ── Purge instance (stop socket + delete creds + meta) — next connect needs QR ──
router.post(
  '/:orgId/purge',
  validateParams(orgIdParamsSchema),
  (req: Request, res: Response) => {
    const { orgId } = req.params
    stopSession(orgId, { purgeAuthDir: true })
    orgLogger(orgId).info('Session instance purged via API')
    res.json({ success: true, orgId, purged: true })
  }
)

// ── Migrate session (auth folder) to another org — keeps pairing, no new QR ──
router.post(
  '/:orgId/migrate',
  validateParams(orgIdParamsSchema),
  validateBody(migrateSessionSchema),
  async (req: Request, res: Response) => {
    const fromOrgId = req.params.orgId
    const { targetOrgId, webhookUrl } = req.body as {
      targetOrgId: string
      webhookUrl?: string
    }

    if (fromOrgId === targetOrgId) {
      res.status(400).json({
        error: 'Source and target organization must differ',
        code: 'SAME_ORG',
      })
      return
    }

    const orgCheck = await validateOrg(targetOrgId)
    if (!orgCheck.valid) {
      res.status(403).json({
        error: 'No active subscription for target organization',
        code: 'ORG_NOT_AUTHORIZED',
      })
      return
    }

    try {
      await migrateSession(fromOrgId, targetOrgId, webhookUrl)
      res.json({ success: true, fromOrgId, targetOrgId })
    } catch (err) {
      orgLogger(fromOrgId).error({ err, targetOrgId }, 'Session migrate failed')
      res.status(500).json({
        error: (err as Error).message,
        code: 'SESSION_MIGRATE_FAILED',
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
    const purge =
      req.query.purge === 'true' ||
      req.query.purge === '1' ||
      req.query.wipe === 'true'
    stopSession(orgId, { purgeAuthDir: purge })
    orgLogger(orgId).info({ purge }, 'Session stop via API')
    res.json({ success: true, orgId, purged: purge })
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