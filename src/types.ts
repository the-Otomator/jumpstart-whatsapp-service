import type { ProviderType } from './providers/types'

export interface Session {
  orgId: string
  provider: ProviderType
  status: 'connecting' | 'qr' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
  webhookUrl?: string
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contact'
  | 'template'

export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  parameters: TemplateParameter[]
}

export interface TemplateParameter {
  type: 'text' | 'image' | 'document' | 'video'
  text?: string
  image?: { link: string }
  document?: { link: string }
  video?: { link: string }
}

export interface SendMessageRequest {
  orgId: string
  to: string // phone number with country code, e.g. "972501234567"
  type: MessageType
  message?: string // text content or caption for media
  mediaUrl?: string // URL to download media from
  mediaBase64?: string // direct base64-encoded media
  mimetype?: string // e.g. "application/pdf"
  filename?: string // for documents
  latitude?: number // for location
  longitude?: number
  contactName?: string // for contact card
  contactPhone?: string
  // Template fields (Meta Cloud only)
  template?: {
    name: string
    language: string
    components?: TemplateComponent[]
  }
}

export interface ApiError {
  error: string
  code: string
  details?: unknown
}
