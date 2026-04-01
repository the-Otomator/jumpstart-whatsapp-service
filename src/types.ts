export interface Session {
  orgId: string
  status: 'connecting' | 'qr' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
  webhookUrl?: string
}

export interface SendMessageRequest {
  orgId: string
  to: string        // phone number with country code, e.g. "972501234567"
  message: string
  mediaUrl?: string
}
