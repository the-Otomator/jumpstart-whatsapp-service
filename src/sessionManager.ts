import type { Session } from './types'
import {
  getProvider,
  getProviderForOrg,
  getAllProviders,
  type ProviderType,
} from './providers'

export async function startSession(
  orgId: string,
  webhookUrl?: string,
  providerType: ProviderType = 'baileys'
): Promise<void> {
  const provider = getProvider(providerType)
  await provider.start(orgId, webhookUrl)
}

export function getStatus(orgId: string): Session | undefined {
  const provider = getProviderForOrg(orgId)
  return provider?.getStatus(orgId)
}

export function getQR(orgId: string): string | undefined {
  const provider = getProviderForOrg(orgId)
  return provider?.getQR(orgId)
}

export function stopSession(
  orgId: string,
  options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }
): void {
  const provider = getProviderForOrg(orgId) ?? getProvider('baileys')
  provider.stop(orgId, options)
}

export async function migrateSession(
  fromOrgId: string,
  toOrgId: string,
  webhookUrl?: string
): Promise<void> {
  const provider = getProviderForOrg(fromOrgId) ?? getProvider('baileys')
  if (!provider.migrateSession) throw new Error('Provider does not support migration')
  await provider.migrateSession(fromOrgId, toOrgId, webhookUrl)
}

export function listActiveSessions(): Session[] {
  return getAllProviders().flatMap((p) => p.listActiveSessions())
}

export async function restoreSessions(): Promise<void> {
  for (const provider of getAllProviders()) {
    await provider.restoreSessions()
  }
}
