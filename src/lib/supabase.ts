import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — org validation disabled')
}

export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

/**
 * Check if an orgId has an active subscription for the whatsapp-service product.
 * Returns the subscription if valid, null if not found or inactive.
 * If Supabase is not configured, returns a mock "valid" result (dev mode).
 */
export async function validateOrg(orgId: string): Promise<{
  valid: boolean
  plan?: string
  userEmail?: string
  organizationName?: string
}> {
  // Dev mode — if no Supabase configured, allow all
  if (!supabase) {
    logger.debug({ orgId }, 'Supabase not configured — skipping org validation')
    return { valid: true }
  }

  try {
    // Resolve session_key -> org_id for multi-device sessions (e.g. "uuid-8char" suffix)
    const { data: deviceRow } = await supabase
      .from('whatsapp_devices')
      .select('org_id')
      .eq('session_key', orgId)
      .maybeSingle()
    if (deviceRow?.org_id) {
      logger.debug({ sessionKey: orgId, orgId: deviceRow.org_id }, 'Resolved session_key to org_id')
      orgId = deviceRow.org_id
    }

    const { data: central, error: centralErr } = await supabase
      .from('central_subscriptions')
      .select('org_id, plan, status, user_email, organization_name, product_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    if (central && !centralErr) {
      const { data: product } = await supabase
        .from('products')
        .select('slug')
        .eq('id', central.product_id)
        .maybeSingle()

      if (product?.slug === 'whatsapp-service') {
        return {
          valid: true,
          plan: central.plan,
          userEmail: central.user_email,
          organizationName: central.organization_name,
        }
      }
    }

    // Jumpstart system license: WhatsApp device slots on the plan + purchased extras in metadata
    const { data: oss } = await supabase
      .from('org_system_subscriptions')
      .select('plan_code, metadata')
      .eq('organization_id', orgId)
      .eq('system_code', 'jumpstart')
      .eq('status', 'active')
      .maybeSingle()

    if (oss) {
      const { data: planRow } = await supabase
        .from('system_license_plans')
        .select('features')
        .eq('system_code', 'jumpstart')
        .eq('code', oss.plan_code)
        .maybeSingle()

      const features = (planRow?.features ?? {}) as Record<string, unknown>
      const metadata = (oss.metadata ?? {}) as Record<string, unknown>
      const included = Math.max(0, Math.floor(Number(features.whatsapp_devices_included ?? 0)))
      const extraPurchased = Math.max(0, Math.floor(Number(metadata.whatsapp_extra_devices ?? 0)))
      const deviceCap = included + extraPurchased

      if (deviceCap >= 1) {
        logger.info({ orgId, included, extraPurchased, deviceCap }, 'WhatsApp allowed via Jumpstart license')
        return {
          valid: true,
          plan: `jumpstart/${String(oss.plan_code)}`,
        }
      }

      logger.info({ orgId, included, extraPurchased }, 'Jumpstart license has no WhatsApp device slots')
    }

    // Check 4: Partner org slot (WorkMatch and future partners)
    const { data: slot } = await supabase
      .from('partner_org_slots')
      .select('org_id, partner_name, status')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    if (slot) {
      logger.info({ orgId, partner: slot.partner_name }, 'WhatsApp allowed via partner license')
      return { valid: true, plan: `partner/${slot.partner_name}` }
    }

    logger.info({ orgId }, 'No WhatsApp entitlement found for org')
    return { valid: false }
  } catch (err) {
    logger.error({ orgId, err }, 'Error validating org against Supabase')
    // Fail open in case of DB error — don't block the service
    return { valid: true }
  }
}

type DeviceConnectionStatus = 'connected' | 'disconnected' | 'qr'

/**
 * Write the live connection status of a session back to the Hub `whatsapp_devices`
 * row, matched on `session_key` (single-device sessions use session_key = org_id;
 * multi-device sessions use an "org_id-8char" key — both are stored as session_key).
 *
 * This is the source of truth every DB-reading surface relies on (otomator-admin,
 * get_org_devices RPC, and the app's send-path probe which keys on
 * status === 'connected'). Writing `connected` here is what makes the first
 * connected device the de-facto default sender with no manual step.
 *
 * Never throws — failures are logged and swallowed so the socket handler is safe.
 */
export async function updateDeviceStatus(
  sessionKey: string,
  status: DeviceConnectionStatus,
  phoneNumber?: string | null
): Promise<void> {
  if (!supabase) {
    logger.debug({ sessionKey, status }, 'Supabase not configured — skipping device status write-back')
    return
  }

  try {
    const now = new Date().toISOString()
    const patch: Record<string, unknown> = {
      status,
      updated_at: now,
    }

    if (status === 'connected') {
      patch.last_connected_at = now
      // Only set phone_number when we actually have one — never overwrite with null.
      if (phoneNumber) patch.phone_number = phoneNumber
    }
    // On disconnect: keep phone_number as-is (do not null it).

    const { error } = await supabase
      .from('whatsapp_devices')
      .update(patch)
      .eq('session_key', sessionKey)

    if (error) {
      logger.warn({ sessionKey, status, err: error.message }, 'Failed to write device status to DB')
      return
    }

    logger.debug({ sessionKey, status, phoneNumber: phoneNumber ?? undefined }, 'Device status written to DB')
  } catch (err) {
    logger.warn({ sessionKey, status, err }, 'Error writing device status to DB')
  }
}
