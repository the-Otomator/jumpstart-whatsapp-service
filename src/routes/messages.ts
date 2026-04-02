import { Router, Request, Response } from 'express'
import { sessions, sockets } from '../sessionManager'
import { SendMessageRequest } from '../types'
import { validateBody, sendMessageSchema, sendBulkSchema } from '../middleware/validate'
import { orgLogger } from '../lib/logger'
import { AnyMessageContent } from '@whiskeysockets/baileys'

const router = Router()

function formatJid(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, '')
  return clean.endsWith('@s.whatsapp.net') ? clean : `${clean}@s.whatsapp.net`
}

/** Build the Baileys message content from our SendMessageRequest */
async function buildMessageContent(req: SendMessageRequest): Promise<AnyMessageContent> {
  switch (req.type) {
    case 'text':
      return { text: req.message ?? '' }

    case 'image': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'image/jpeg'};base64,${req.mediaBase64}` }
      return { image: media, caption: req.message }
    }

    case 'video': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'video/mp4'};base64,${req.mediaBase64}` }
      return { video: media, caption: req.message }
    }

    case 'audio': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'audio/mpeg'};base64,${req.mediaBase64}` }
      return { audio: media, mimetype: req.mimetype ?? 'audio/mpeg' }
    }

    case 'document': {
      const media = req.mediaUrl
        ? { url: req.mediaUrl }
        : { url: `data:${req.mimetype ?? 'application/octet-stream'};base64,${req.mediaBase64}` }
      return {
        document: media,
        mimetype: req.mimetype ?? 'application/octet-stream',
        fileName: req.filename ?? 'document',
        caption: req.message,
      }
    }

    case 'location':
      return {
        location: {
          degreesLatitude: req.latitude!,
          degreesLongitude: req.longitude!,
        },
      }

    case 'contact': {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${req.contactName}`,
        `TEL;type=CELL;type=VOICE;waid=${req.contactPhone}:+${req.contactPhone}`,
        'END:VCARD',
      ].join('\n')
      return {
        contacts: {
          displayName: req.contactName!,
          contacts: [{ vcard }],
        },
      }
    }

    default:
      return { text: req.message ?? '' }
  }
}

async function sendOne(req: SendMessageRequest): Promise<string> {
  const session = sessions.get(req.orgId)
  if (!session || session.status !== 'connected') {
    throw new Error(`Session ${req.orgId} not connected`)
  }
  const sock = sockets.get(req.orgId)!
  const jid = formatJid(req.to)
  const content = await buildMessageContent(req)
  const result = await sock.sendMessage(jid, content)
  return result?.key?.id ?? ''
}

// ── Send single message ─────────────────────────────────────────
router.post('/send', validateBody(sendMessageSchema), async (req: Request, res: Response) => {
  const body = req.body as SendMessageRequest
  const log = orgLogger(body.orgId)

  try {
    const messageId = await sendOne(body)
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
      const messageId = await sendOne(msg)
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
