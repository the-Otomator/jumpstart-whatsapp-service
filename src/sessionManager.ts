import type { Session } from './types'
import {
  getProvider,
  getProviderForOrg,
  getAllProviders,
  type ProviderType,
} from './providers'
import { BaileysProvider } from './providers/baileys/baileysProvider'
import { MetaCloudProvider } from './providers/meta-cloud/metaCloudProvider'
import makeWASocket from '@whiskeysockets/baileys'
import { requireWebhookUrl, WebhookUrlRequiredError } from './lib/webhookUrl'

export async function startSession(
  orgId: string,
  webhookUrl?: string,
  providerType: ProviderType = 'baileys',
  metaConfig?: { accessToken?: string; phoneNumberId?: string; wabaId?: string }
): Promise<void> {
  // Reject before any provider/socket work when webhook target is missing or invalid.
  requireWebhookUrl(webhookUrl)

  const provider = getProvider(providerType)
  // For meta-cloud, the start() method accepts config as 3rd argument
  if (providerType === 'meta-cloud') {
    await (provider as MetaCloudProvider).start(orgId, webhookUrl, metaConfig)
  } else {
    await provider.start(orgId, webhookUrl)
  }
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

/** Get the raw Baileys socket for an org (undefined if not a Baileys session or not connected). */
export function getBaileysSocket(orgId: string): ReturnType<typeof makeWASocket> | undefined {
  const provider = getProvider('baileys') as BaileysProvider
  return provider.getSocket(orgId)
}

/**
 * Update webhookUrl on a live session without reconnecting.
 * Works for Baileys and Meta Cloud sessions currently in memory.
 */
export function updateSessionWebhook(
  orgId: string,
  webhookUrl: string
): { previous: string | undefined; next: string } {
  const resolved = requireWebhookUrl(webhookUrl)
  const provider = getProviderForOrg(orgId)
  if (!provider) {
    throw new Error(`Session ${orgId} not found`)
  }

  if (provider.type === 'baileys') {
    return (provider as BaileysProvider).updateWebhookUrl(orgId, resolved)
  }
  if (provider.type === 'meta-cloud') {
    return (provider as MetaCloudProvider).updateWebhookUrl(orgId, resolved)
  }
  throw new Error(`Provider ${provider.type} does not support webhook update`)
}

export async function restoreSessions(): Promise<void> {
  for (const provider of getAllProviders()) {
    await provider.restoreSessions()
  }
}

export { WebhookUrlRequiredError }
