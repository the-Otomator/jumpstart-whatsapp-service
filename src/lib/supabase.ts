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

    logger.info({ orgId }, 'No WhatsApp entitlement found for org')
    return { valid: false }
  } catch (err) {
    logger.error({ orgId, err }, 'Error validating org against Supabase')
    // Fail open in case of DB error — don't block the service
    return { valid: true }
  }
}
