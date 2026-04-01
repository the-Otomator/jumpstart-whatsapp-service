export interface Session {
  orgId: string
  status: 'connecting' | 'qr' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
  webhookUrl?: string
}

export interface SendMessageRequest {
  orgId: string
  to: string
  message?: string
  mediaUrl?: string
  caption?: string
}

export interface IncomingMessage {
  event: 'message'
  orgId: string
  from: string
  pushName?: string
  messageId: string
  timestamp: number
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other'
  text?: string
  mediaUrl?: string
  mimetype?: string
  caption?: string
}
