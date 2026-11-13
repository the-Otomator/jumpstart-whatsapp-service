import { getHaRuntime } from './ha/coordinator'
import type { Session, WaChannel } from './types'
import {
  getProvider,
  getProviderForOrg,
  getAllProviders,
  listOrgChannelSessions,
  type ProviderType,
} from './providers'
import { BaileysProvider } from './providers/baileys/baileysProvider'
import { MetaCloudProvider } from './providers/meta-cloud/metaCloudProvider'
import makeWASocket from '@whiskeysockets/baileys'
import { requireWebhookUrl, WebhookUrlRequiredError } from './lib/webhookUrl'
import { getSenderPool } from './pool'
import { channelFromProvider, parseWaChannel, providerFromChannel } from './lib/waChannel'

export async function startSession(
  orgId: string,
  webhookUrl?: string,
  providerType: ProviderType = 'baileys',
  metaConfig?: { accessToken?: string; phoneNumberId?: string; wabaId?: string },
  channel?: WaChannel
): Promise<void> {
  // Reject before any provider/socket work when webhook target is missing or invalid.
  requireWebhookUrl(webhookUrl)

  const resolvedChannel = channel ?? channelFromProvider(providerType)
  const expectedProvider = providerFromChannel(resolvedChannel)
  if (expectedProvider !== providerType) {
    throw new Error(`channel=${resolvedChannel} requires provider=${expectedProvider}`)
  }

  const provider = getProvider(providerType)
  // For meta-cloud, the start() method accepts config as 3rd argument
  if (providerType === 'meta-cloud') {
    await (provider as MetaCloudProvider).start(orgId, webhookUrl, metaConfig)
  } else {
    await provider.start(orgId, webhookUrl)
  }
}

export function getStatus(orgId: string, channel?: WaChannel): Session | undefined {
  if (channel) {
    return getProviderForOrg(orgId, channel)?.getStatus(orgId, channel)
  }
  return getProviderForOrg(orgId)?.getStatus(orgId)
}

export async function recoverDisconnectedSessions(): Promise<void> {
  await (getProvider('baileys') as BaileysProvider).recoverDisconnectedSessions()
}

export function getQR(orgId: string, channel?: WaChannel): string | undefined {
  const ch = channel ?? 'phone'
  const provider = getProviderForOrg(orgId, ch)
  return provider?.getQR(orgId, ch)
}

async function stopOneChannel(
  orgId: string,
  channel: WaChannel,
  options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean }
): Promise<void> {
  const provider = getProviderForOrg(orgId, channel) ?? getProvider(providerFromChannel(channel))
  const ha = getHaRuntime()
  if (ha && provider.type === 'baileys') {
    await ha.transition(orgId, async () => {
      await ha.acquireSession(orgId)
      if (!options?.keepAuthFiles) {
        const meta = (await ha.catalog(false)).find(entry => entry.key === orgId)?.meta || { webhookUrl: '' }
        await ha.saveMeta(orgId, meta, false, options?.purgeAuthDir === true)
      }
      await (provider as BaileysProvider).closeHaSocket(orgId)
      provider.stop(orgId, options)
    })
  } else {
    provider.stop(orgId, options)
  }
}

export async function stopSession(
  orgId: string,
  options?: { keepAuthFiles?: boolean; purgeAuthDir?: boolean; channel?: WaChannel }
): Promise<void> {
  if (options?.channel) {
    await stopOneChannel(orgId, options.channel, options)
    return
  }

  const live = listOrgChannelSessions(orgId)
  if (live.length === 0) {
    await stopOneChannel(orgId, 'phone', options)
    return
  }
  for (const session of live) {
    const ch = session.channel ?? channelFromProvider(session.provider)
    await stopOneChannel(orgId, ch, options)
  }
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
export async function updateSessionWebhook(
  orgId: string,
  webhookUrl: string,
  channel?: WaChannel
): Promise<{ previous: string | undefined; next: string }> {
  const resolved = requireWebhookUrl(webhookUrl)
  const provider = channel
    ? getProviderForOrg(orgId, channel)
    : getProviderForOrg(orgId)
  if (!provider) {
    throw new Error(`Session ${orgId} not found`)
  }

  if (provider.type === 'baileys') {
    const ha = getHaRuntime()
    if (ha) {
      const meta = (await ha.catalog(false)).find(entry => entry.key === orgId)?.meta || {}
      await ha.saveMeta(orgId, { ...meta, webhookUrl: resolved })
    }
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
    if (provider.type === 'meta-cloud') {
      for (const session of provider.listActiveSessions()) {
        if (session.status === 'connected') getSenderPool(session.orgId).resumeRestoredWork()
      }
    }
  }
}

export { WebhookUrlRequiredError, parseWaChannel }
