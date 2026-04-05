import type { WhatsAppProvider, ProviderType } from './types'
import { BaileysProvider } from './baileys/baileysProvider'

const providers = {
  baileys: new BaileysProvider(),
} as unknown as Record<ProviderType, WhatsAppProvider>

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

export type { WhatsAppProvider, ProviderType, SendResult } from './types'
