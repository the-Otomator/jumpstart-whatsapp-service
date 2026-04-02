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
    const { data, error } = await supabase
      .from('central_subscriptions')
      .select('org_id, plan, status, user_email, organization_name, product_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .single()

    if (error || !data) {
      logger.info({ orgId }, 'No active subscription found for org')
      return { valid: false }
    }

    // Verify it's for the whatsapp-service product
    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', data.product_id)
      .single()

    if (product?.slug !== 'whatsapp-service') {
      logger.info({ orgId, productSlug: product?.slug }, 'Subscription is not for whatsapp-service')
      return { valid: false }
    }

    return {
      valid: true,
      plan: data.plan,
      userEmail: data.user_email,
      organizationName: data.organization_name,
    }
  } catch (err) {
    logger.error({ orgId, err }, 'Error validating org against Supabase')
    // Fail open in case of DB error — don't block the service
    return { valid: true }
  }
}
