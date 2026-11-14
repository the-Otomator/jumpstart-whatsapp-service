import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { logger } from '../lib/logger'
import type { SendMessageRequest } from '../types'

const policySchema = z.object({
  keyHash: z.string().regex(/^[a-f0-9]{64}$/),
  session: z.string().min(1),
  recipient: z.literal('972528393669'),
  dailyCap: z.number().int().min(1).max(100),
  revoked: z.boolean(),
})

const requestSchema = z.object({
  orgId: z.string().min(1),
  to: z.string(),
  message: z.string().min(1).max(4096).regex(/^\[QA · [^\]\r\n]+\]\s+\S/),
}).strict()

// Reserve before sending. Failed or ambiguous sends still consume a slot.
export async function reserveQaSend(directory: string, day: string, cap: number): Promise<boolean> {
  const dayDirectory = join(directory, day)
  await mkdir(dayDirectory, { recursive: true, mode: 0o700 })
  for (let slot = 0; slot < cap; slot++) {
    try {
      await writeFile(join(dayDirectory, String(slot)), '', { flag: 'wx', mode: 0o600 })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return false
}

export function qaWhatsAppSend(send: (request: SendMessageRequest) => Promise<string>): RequestHandler {
  return async (req, res) => {
    const refuse = (status: number, code: string) => {
      logger.warn({ code }, 'QA WhatsApp send refused')
      res.status(status).json({ error: code })
    }
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1]
    if (!token) return refuse(401, 'QA_AUTH_REQUIRED')

    const directory = process.env.WA_QA_POLICY_DIRECTORY
    if (!directory || !isAbsolute(directory)) return refuse(503, 'QA_UNAVAILABLE')

    try {
      const policy = policySchema.parse(JSON.parse(await readFile(join(directory, 'policy.json'), 'utf8')))
      const digest = createHash('sha256').update(token).digest()
      if (policy.revoked || !timingSafeEqual(digest, Buffer.from(policy.keyHash, 'hex'))) {
        return refuse(403, 'QA_KEY_REFUSED')
      }

      const parsed = requestSchema.safeParse(req.body)
      if (!parsed.success) return refuse(400, 'QA_INVALID_MESSAGE')
      const { orgId, to, message } = parsed.data
      if (orgId !== policy.session || to !== policy.recipient) return refuse(403, 'QA_SCOPE_REFUSED')

      const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem' }).format(new Date())
      if (!await reserveQaSend(directory, day, policy.dailyCap)) return refuse(429, 'QA_CAP_REACHED')

      const messageId = await send({ orgId: policy.session, to: policy.recipient, type: 'text', message })
      logger.info({ messageId }, 'QA WhatsApp send accepted')
      res.json({ messageId })
    } catch {
      refuse(503, 'QA_UNAVAILABLE')
    }
  }
}
