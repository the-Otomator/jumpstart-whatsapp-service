import type { ProviderType } from '../providers/types'
import type { MessageLane, SendMessageRequest, Session, WaChannel } from '../types'

export const WA_CHANNELS: readonly WaChannel[] = ['phone', 'official'] as const

export function channelFromProvider(provider: ProviderType): WaChannel {
  return provider === 'meta-cloud' ? 'official' : 'phone'
}

export function providerFromChannel(channel: WaChannel): ProviderType {
  return channel === 'official' ? 'meta-cloud' : 'baileys'
}

export function parseWaChannel(value: unknown): WaChannel | undefined {
  if (value === 'phone' || value === 'official') return value
  return undefined
}

export function assertOfficialSendAllowed(
  req: Pick<SendMessageRequest, 'type' | 'template'>,
  channel: WaChannel
): void {
  if (channel !== 'official') return
  if (req.type !== 'template' || !req.template?.name) {
    throw new Error('Official channel requires an approved template message')
  }
}

/**
 * Pure routing decision given which channels are currently connected.
 */
export function pickSendChannel(
  req: Pick<SendMessageRequest, 'lane' | 'channel'>,
  connected: { phone?: boolean; official?: boolean }
): WaChannel {
  if (req.channel) return req.channel
  const lane: MessageLane = req.lane ?? 'operational'
  if (lane === 'marketing' && connected.official) return 'official'
  if (connected.phone) return 'phone'
  if (connected.official) return 'official'
  return 'phone'
}

export function sessionPublicView(session: Session): Record<string, unknown> {
  return {
    status: session.status,
    qr: session.qr ?? null,
    phoneNumber: session.phoneNumber ?? null,
    provider: session.provider,
    channel: session.channel ?? channelFromProvider(session.provider),
    lastError: session.lastError ?? null,
  }
}

/** Build status payload from already-resolved channel sessions. */
export function buildStatusPayloadFromSessions(sessions: Session[]): {
  status: string
  qr: string | null
  phoneNumber: string | null
  provider?: ProviderType
  channel?: WaChannel
  channels: Partial<Record<WaChannel, ReturnType<typeof sessionPublicView>>>
  not_found?: boolean
} {
  const channels: Partial<Record<WaChannel, ReturnType<typeof sessionPublicView>>> = {}
  for (const s of sessions) {
    const ch = s.channel ?? channelFromProvider(s.provider)
    channels[ch] = sessionPublicView(s)
  }

  const entries = Object.entries(channels) as Array<[WaChannel, ReturnType<typeof sessionPublicView>]>
  if (entries.length === 0) {
    return {
      status: 'not_found',
      qr: null,
      phoneNumber: null,
      channels: {},
      not_found: true,
    }
  }

  if (entries.length === 1) {
    const [channel, view] = entries[0]
    return {
      status: String(view.status),
      qr: (view.qr as string | null) ?? null,
      phoneNumber: (view.phoneNumber as string | null) ?? null,
      provider: view.provider as ProviderType,
      channel,
      channels,
    }
  }

  const primary = channels.phone ?? channels.official!
  return {
    status: String(primary.status),
    qr: (primary.qr as string | null) ?? null,
    phoneNumber: (primary.phoneNumber as string | null) ?? null,
    provider: primary.provider as ProviderType,
    channel: (primary.channel as WaChannel) ?? 'phone',
    channels,
  }
}
