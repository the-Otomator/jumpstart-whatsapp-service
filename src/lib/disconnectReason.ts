import { Boom } from '@hapi/boom'
import { DisconnectReason } from '@whiskeysockets/baileys'

/**
 * Turn Baileys `lastDisconnect` into a human-readable string.
 * Avoids the classic `"unknown (undefined)"` when statusCode is missing.
 */
export function formatDisconnectReason(lastDisconnect: unknown): string {
  const err = (lastDisconnect as { error?: unknown } | null | undefined)?.error
  if (err == null) return 'unknown (no error)'

  const boom = err as Boom
  const statusCode =
    typeof boom?.output?.statusCode === 'number' ? boom.output.statusCode : undefined

  let label: string | null = null
  if (statusCode != null) {
    // Reverse-lookup DisconnectReason enum → name (e.g. 401 → "loggedOut")
    const named = (DisconnectReason as unknown as Record<number, string>)[statusCode]
    if (typeof named === 'string' && named.length > 0) label = named
  }

  if (!label) {
    if (typeof boom?.message === 'string' && boom.message.length > 0) label = boom.message
    else if (err instanceof Error && err.message) label = err.message
    else label = 'unknown'
  }

  if (statusCode != null) return `${label} (${statusCode})`
  return label
}

/** Map in-memory session status to wa_devices vocabulary (connected | disconnected | qr). */
export function toWaDeviceStatus(
  status: string
): 'connected' | 'disconnected' | 'qr' {
  if (status === 'connected') return 'connected'
  if (status === 'qr') return 'qr'
  // connecting / disconnected / anything else → disconnected for DB truth
  return 'disconnected'
}
