import { jumpstartSupabase } from './jumpstartSupabase'
import { orgLogger } from './logger'

type PaymentPolicyClient = Pick<NonNullable<typeof jumpstartSupabase>, 'from' | 'rpc'>

export class PaymentRestrictedError extends Error {
  constructor() {
    super('PAYMENT_RESTRICTED')
  }
}

/** Resolve the device owner before reading JumpStart's current billing decision. */
export async function isPaymentRestricted(
  sessionKey: string,
  client: PaymentPolicyClient | null = jumpstartSupabase,
): Promise<boolean> {
  const signal = AbortSignal.timeout(1500)
  try {
    if (!client) throw new Error('client_unavailable')
    const devices = await client.from('wa_devices').select('organization_id, org_id')
      .eq('session_key', sessionKey).limit(2).abortSignal(signal)
    if (devices.error || !Array.isArray(devices.data) || devices.data.length > 1) {
      throw new Error('device_lookup_failed')
    }
    // The service also handles sessions for products outside JumpStart.
    if (devices.data.length === 0) return false
    const orgId = devices.data[0].organization_id ?? devices.data[0].org_id
    if (typeof orgId !== 'string' || !orgId) throw new Error('device_owner_missing')

    const decision = await client.rpc('payment_restricted_outbound_blocked', { p_org_id: orgId })
      .abortSignal(signal)
    // The database migration and service rollout are separate release steps.
    if (decision.error?.code === 'PGRST202' || decision.error?.code === '42883') return false
    if (decision.error || typeof decision.data !== 'boolean') throw new Error('decision_unavailable')
    return decision.data
  } catch (error) {
    orgLogger(sessionKey).warn(
      { reason: error instanceof Error ? error.message : 'unknown_error' },
      'Payment enforcement check unavailable; allowing the send',
    )
    return false
  }
}

export async function assertPaymentAllowsSend(sessionKey: string): Promise<void> {
  if (await isPaymentRestricted(sessionKey)) throw new PaymentRestrictedError()
}
