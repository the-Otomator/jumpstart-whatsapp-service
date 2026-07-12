import { getProviderForOrg } from '../providers'
import type { SendMessageRequest } from '../types'

/** Low-level send — bypasses throttle pool (used by pool worker only). */
export async function sendWhatsAppMessageDirect(req: SendMessageRequest): Promise<string> {
  const provider = getProviderForOrg(req.orgId)
  if (!provider) throw new Error(`Session ${req.orgId} not connected`)

  const status = provider.getStatus(req.orgId)
  if (!status || status.status !== 'connected') {
    throw new Error(`Session ${req.orgId} not connected`)
  }

  const result = await provider.sendMessage(req)
  return result.messageId
}
