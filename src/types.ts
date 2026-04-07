import type { ProviderType } from './providers/types'

export interface Session {
  orgId: string
  provider: ProviderType
  status: 'connecting' | 'qr' | 'connected' | 'disconnected'
  qr?: string
  phoneNumber?: string
  webhookUrl?: string
  partnerName?: string
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
  to: string
  type: MessageType
  message?: string
  mediaUrl?: string
  mediaBase64?: string
  mimetype?: string
  filename?: string
  latitude?: number
  longitude?: number
  contactName?: string
  contactPhone?: string
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
