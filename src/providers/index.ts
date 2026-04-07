import type { WhatsAppProvider, ProviderType } from './types'
import { BaileysProvider } from './baileys/baileysProvider'
import { MetaCloudProvider } from './meta-cloud/metaCloudProvider'

const metaCloudProvider = new MetaCloudProvider()

const providers: Record<ProviderType, WhatsAppProvider> = {
  'baileys': new BaileysProvider(),
  'meta-cloud': metaCloudProvider,
}

export function getProvider(type: ProviderType = 'baileys'): WhatsAppProvider {
  const provider = providers[type]
  if (!provider) throw new Error(`Unknown provider: ${type}`)
  return provider
}

/** Get the provider that owns a specific org's session */
export function getProviderForOrg(orgId: string): WhatsAppProvider | undefined {
  for (const provider of Object.values(providers)) {
    if (provider.getStatus(orgId)) return provider
  }
  return undefined
}

export function getAllProviders(): WhatsAppProvider[] {
  return Object.values(providers)
}

/** Get the MetaCloudProvider instance (needed for webhook route) */
export function getMetaCloudProvider(): MetaCloudProvider {
  return metaCloudProvider
}

export type { WhatsAppProvider, ProviderType, SendResult } from './types'