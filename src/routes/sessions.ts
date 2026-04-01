import { Router, Request, Response } from 'express'
import { startSession, getQR, getStatus, stopSession } from '../sessionManager'

const router = Router()

router.post('/:orgId/start', async (req: Request, res: Response) => {
  const { orgId } = req.params
  const { webhookUrl } = req.body
  try {
    await startSession(orgId, webhookUrl)
    res.json({ success: true, orgId, status: 'connecting' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:orgId/qr', (req: Request, res: Response) => {
  const { orgId } = req.params
  const qr = getQR(orgId)
  if (!qr) {
    res.status(404).json({ error: 'No QR available — session not in QR state' })
    return
  }
  res.json({ qr })
})

router.get('/:orgId/status', (req: Request, res: Response) => {
  const { orgId } = req.params
  const session = getStatus(orgId)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  res.json(session)
})

router.delete('/:orgId', (req: Request, res: Response) => {
  const { orgId } = req.params
  stopSession(orgId)
  res.json({ success: true, orgId })
})

export default router
