import type { Session, SendMessageRequest, WaChannel } from '../types'

export type ProviderType = 'baileys' | 'meta-cloud'

export interface SendResult {
  messageId: string
}

/**
 * Common interface every WhatsApp provider must implement.
 * Sessions are keyed by orgId within each provider; channel is implied by provider
 * (baileys=phone, meta-cloud=official) so one org can hold both at once.
 */
export interface WhatsAppProvider {
  readonly type: ProviderType
  /** Fixed channel owned by this provider. */
  readonly channel: WaChannel

  /** Start a session (connect to WhatsApp). */
  start(orgId: string, webhookUrl?: string): Promise<void>

  /** Stop a session. */
  stop(orgId: string, options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }): void

  /** Get current session status. Optional channel must match this provider when passed. */
  getStatus(orgId: string, channel?: WaChannel): Session | undefined

  /** Get QR code (only relevant for Baileys). Returns undefined if not applicable. */
  getQR(orgId: string, channel?: WaChannel): string | undefined

  /** Send a message. */
  sendMessage(req: SendMessageRequest): Promise<SendResult>

  /**
   * Optional: mark session unhealthy and recover after a send ACK timeout
   * (half-open socket). Baileys implements this; Meta Cloud does not need it.
   */
  onSendTimeout?(orgId: string): void

  /** List all active sessions managed by this provider. */
  listActiveSessions(): Session[]

  /** Restore sessions from disk after service restart. */
  restoreSessions(): Promise<void>

  /** Migrate session from one org to another (Baileys-specific, optional). */
  migrateSession?(fromOrgId: string, toOrgId: string, webhookUrl?: string): Promise<void>
}
