import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import { Session } from './types'

export const sessions = new Map<string, Session>()
export const sockets = new Map<string, ReturnType<typeof makeWASocket>>()

async function postWebhook(webhookUrl: string, payload: object): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch { /* ignore webhook errors */ }
}

export async function startSession(orgId: string, webhookUrl?: string): Promise<void> {
  const session: Session = { orgId, status: 'connecting', webhookUrl }
  sessions.set(orgId, session)

  const authDir = path.join(process.cwd(), 'sessions', orgId)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  const sock = makeWASocket({ auth: state, printQRInTerminal: false })
  sockets.set(orgId, sock)

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const base64 = await QRCode.toDataURL(qr)
      session.status = 'qr'
      session.qr = base64
      if (webhookUrl) await postWebhook(webhookUrl, { event: 'qr', orgId, qr: base64 })
    }
    if (connection === 'open') {
      session.status = 'connected'
      session.phoneNumber = sock.user?.id?.split(':')[0]
      session.qr = undefined
      if (webhookUrl) await postWebhook(webhookUrl, { event: 'connected', orgId, phone: session.phoneNumber })
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
      session.status = 'disconnected'
      if (webhookUrl) await postWebhook(webhookUrl, { event: 'disconnected', orgId })
      if (shouldReconnect) setTimeout(() => startSession(orgId, webhookUrl), 5000)
    }
  })
}

export function getStatus(orgId: string): Session | undefined {
  return sessions.get(orgId)
}

export function getQR(orgId: string): string | undefined {
  const s = sessions.get(orgId)
  return s?.status === 'qr' ? s.qr : undefined
}

export function stopSession(orgId: string): void {
  sockets.get(orgId)?.end(undefined)
  sockets.delete(orgId)
  sessions.delete(orgId)
}
