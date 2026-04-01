import { Router, Request, Response } from 'express'
import { sessions, sockets } from '../sessionManager'
import { SendMessageRequest } from '../types'

const router = Router()

function formatJid(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, '')
  return clean.endsWith('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`
}

async function sendOne(req: SendMessageRequest): Promise<string> {
  const session = sessions.get(req.orgId)
  if (!session || session.status !== 'connected') {
    throw new Error(`Session ${req.orgId} not connected`)
  }
  const sock = sockets.get(req.orgId)!
  const jid = formatJid(req.to)
  const result = await sock.sendMessage(jid, { text: req.message })
  return result?.key?.id ?? ''
}

router.post('/send', async (req: Request, res: Response) => {
  const body = req.body as SendMessageRequest
  try {
    const messageId = await sendOne(body)
    res.json({ success: true, messageId })
  } catch (err) {
    const msg = (err as Error).message
    const status = msg.includes('not connected') ? 404 : 500
    res.status(status).json({ error: msg })
  }
})

router.post('/send-bulk', async (req: Request, res: Response) => {
  const messages = req.body as SendMessageRequest[]
  const results: { to: string; success: boolean; messageId?: string; error?: string }[] = []

  for (const msg of messages) {
    try {
      const messageId = await sendOne(msg)
      results.push({ to: msg.to, success: true, messageId })
    } catch (err) {
      results.push({ to: msg.to, success: false, error: (err as Error).message })
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  res.json({ results })
})

export default router
