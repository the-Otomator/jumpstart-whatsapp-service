import { getProviderForOrg, getProviderForOrgChannel } from '../providers'
import type { SendMessageRequest } from '../types'
import { assertOfficialSendAllowed, pickSendChannel } from './waChannel'

export function resolveSendChannel(req: Pick<SendMessageRequest, 'orgId' | 'lane' | 'channel'>) {
  const official = getProviderForOrgChannel(req.orgId, 'official')?.getStatus(req.orgId, 'official')
  const phone = getProviderForOrgChannel(req.orgId, 'phone')?.getStatus(req.orgId, 'phone')
  return pickSendChannel(req, {
    phone: !!phone,
    official: official?.status === 'connected',
  })
}

/** Low-level send — bypasses throttle pool (used by pool worker only). */
export async function sendWhatsAppMessageDirect(req: SendMessageRequest): Promise<string> {
  const channel = resolveSendChannel(req)
  assertOfficialSendAllowed(req, channel)

  const provider = getProviderForOrg(req.orgId, channel)
  if (!provider) throw new Error(`Session ${req.orgId} channel=${channel} not connected`)

  const status = provider.getStatus(req.orgId, channel)
  if (!status || status.status !== 'connected') {
    throw new Error(`Session ${req.orgId} channel=${channel} not connected`)
  }

  const result = await provider.sendMessage({ ...req, channel })
  return result.messageId
}
