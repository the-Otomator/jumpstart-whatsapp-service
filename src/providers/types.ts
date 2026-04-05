import type { Session, SendMessageRequest } from '../types'

export type ProviderType = 'baileys' | 'meta-cloud'

export interface SendResult {
  messageId: string
}

/**
 * Common interface every WhatsApp provider must implement.
 * Baileys is the first (and currently only) implementation.
 * Meta Cloud API will be the second (Phase 2).
 */
export interface WhatsAppProvider {
  readonly type: ProviderType

  /** Start a session (connect to WhatsApp). */
  start(orgId: string, webhookUrl?: string, partnerName?: string): Promise<void>

  /** Stop a session. */
  stop(orgId: string, options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }): void

  /** Get current session status. */
  getStatus(orgId: string): Session | undefined

  /** Get QR code (only relevant for Baileys). Returns undefined if not applicable. */
  getQR(orgId: string): string | undefined

  /** Send a message. */
  sendMessage(req: SendMessageRequest): Promise<SendResult>

  /** List all active sessions managed by this provider. */
  listActiveSessions(): Session[]

  /** Restore sessions from disk after service restart. */
  restoreSessions(): Promise<void>

  /** Migrate session from one org to another (Baileys-specific, optional). */
  migrateSession?(fromOrgId: string, toOrgId: string, webhookUrl?: string): Promise<void>
}
