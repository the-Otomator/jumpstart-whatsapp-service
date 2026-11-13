import type { WaChannel } from '../types'
import type { WhatsAppProvider, ProviderType } from './types'
import { BaileysProvider } from './baileys/baileysProvider'
import { MetaCloudProvider } from './meta-cloud/metaCloudProvider'

const metaCloudProvider = new MetaCloudProvider()

const providers: Record<ProviderType, WhatsAppProvider> = {
  baileys: new BaileysProvider(),
  'meta-cloud': metaCloudProvider,
}

const channelToProvider: Record<WaChannel, ProviderType> = {
  phone: 'baileys',
  official: 'meta-cloud',
}

export function getProvider(type: ProviderType = 'baileys'): WhatsAppProvider {
  const provider = providers[type]
  if (!provider) throw new Error(`Unknown provider: ${type}`)
  return provider
}

export function getProviderForChannel(channel: WaChannel): WhatsAppProvider {
  return getProvider(channelToProvider[channel])
}

/**
 * Provider that owns a specific org channel.
 * When channel is omitted: prefer phone (baileys) if present, else official — preserves
 * single-channel behaviour for callers that have not been updated.
 */
export function getProviderForOrg(orgId: string, channel?: WaChannel): WhatsAppProvider | undefined {
  if (channel) {
    const provider = getProviderForChannel(channel)
    return provider.getStatus(orgId, channel) ? provider : undefined
  }

  const phone = providers.baileys
  if (phone.getStatus(orgId, 'phone')) return phone

  const official = providers['meta-cloud']
  if (official.getStatus(orgId, 'official')) return official

  return undefined
}

export function getProviderForOrgChannel(orgId: string, channel: WaChannel): WhatsAppProvider | undefined {
  return getProviderForOrg(orgId, channel)
}

export function listOrgChannelSessions(orgId: string) {
  return getAllProviders()
    .map((p) => p.getStatus(orgId, p.channel))
    .filter((s): s is NonNullable<typeof s> => !!s)
}

export function getAllProviders(): WhatsAppProvider[] {
  return Object.values(providers)
}

/** Get the MetaCloudProvider instance (needed for webhook route) */
export function getMetaCloudProvider(): MetaCloudProvider {
  return metaCloudProvider
}

export type { WhatsAppProvider, ProviderType, SendResult } from './types'
