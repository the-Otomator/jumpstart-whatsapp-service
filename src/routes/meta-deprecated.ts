import { Router, Request, Response } from 'express'

/** Official Meta Cloud API is handled by JumpStart Supabase Edge Functions — not this VPS. */
const DEPRECATED_MSG = {
  error: 'Meta Cloud endpoints are deprecated on wa.otomator.pro (Baileys-only VPS).',
  code: 'META_CLOUD_DEPRECATED',
  replacement: {
    webhook: 'https://api.jumpstart.co.il/functions/v1/wa-webhook',
    onboard: 'whatsapp-onboard Edge Function',
    send: 'wa-meta-send Edge Function',
    status: 'wa-meta-session-status Edge Function',
  },
}

const router = Router()

router.all('*', (_req: Request, res: Response) => {
  res.status(410).json(DEPRECATED_MSG)
})

export default router
