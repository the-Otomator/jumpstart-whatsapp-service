import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { jumpstartSupabase } from './jumpstartSupabase'
import { logger } from './logger'
import { recordOrgValidationFailure } from './validationAlert'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — org validation unavailable')
}

export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

export interface WhatsappDeviceLookup {
  orgId: string | null
  webhookUrl: string | null
  webhookSecret: string | null
}

export type OrgValidationResult = {
  valid: boolean
  plan?: string
  userEmail?: string
  organizationName?: string
  deviceWebhookUrl: string | null
  deviceWebhookSecret: string | null
  unavailable?: boolean
}

/** Minimal client surface used by validateOrg (testable without a live client). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OrgValidationClient = { from: (table: string) => any }

/** One registry read shared by entitlement validation and webhook resolution. */
export async function lookupWhatsappDevice(
  sessionKey: string,
  hub: SupabaseClient | null = supabase
): Promise<WhatsappDeviceLookup> {
  if (!hub) throw new Error('SUPABASE_NOT_CONFIGURED')

  const { data, error } = await hub
    .from('whatsapp_devices')
    .select('org_id, webhook_url, webhook_secret')
    .eq('session_key', sessionKey)
    .maybeSingle()

  if (error) {
    logger.warn({ sessionKey, err: error.message }, 'Failed to read WhatsApp device registry')
    throw new Error(`DEVICE_LOOKUP_FAILED: ${error.message}`)
  }

  return {
    orgId: typeof data?.org_id === 'string' ? data.org_id : null,
    webhookUrl: typeof data?.webhook_url === 'string' ? data.webhook_url : null,
    webhookSecret: typeof data?.webhook_secret === 'string' ? data.webhook_secret : null,
  }
}

export async function getDeviceWebhookUrl(sessionKey: string): Promise<string | null> {
  return (await lookupWhatsappDevice(sessionKey)).webhookUrl
}

/**
 * Check if an orgId has an active subscription for the whatsapp-service product.
 * Returns the subscription if valid, null if not found or inactive.
 * Hub client: central_subscriptions / products / partner_org_slots / whatsapp_devices.
 * JumpStart client: org_system_subscriptions / system_license_plans.
 */
export async function validateOrg(
  orgId: string,
  deps?: {
    hub?: OrgValidationClient | null
    jumpstart?: OrgValidationClient | null
  }
): Promise<OrgValidationResult> {
  const hub = (deps?.hub !== undefined ? deps.hub : supabase) as OrgValidationClient | null
  const jumpstart = (
    deps?.jumpstart !== undefined ? deps.jumpstart : jumpstartSupabase
  ) as OrgValidationClient | null

  // Entitlement checks are authorization boundaries and must fail closed.
  if (!hub) {
    logger.error({ orgId }, 'Supabase not configured — rejecting org validation')
    await recordOrgValidationFailure(orgId, 'SUPABASE_NOT_CONFIGURED')
    return { valid: false, unavailable: true, deviceWebhookUrl: null, deviceWebhookSecret: null }
  }

  try {
    // Resolve session_key -> org_id for multi-device sessions (e.g. "uuid-8char" suffix)
    const device = await lookupWhatsappDevice(orgId, hub as unknown as SupabaseClient)
    if (device.orgId) {
      logger.debug({ sessionKey: orgId, orgId: device.orgId }, 'Resolved session_key to org_id')
      orgId = device.orgId
    }

    const { data: central, error: centralErr } = await hub
      .from('central_subscriptions')
      .select('org_id, plan, status, user_email, organization_name, product_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    if (centralErr) throw new Error(`CENTRAL_SUBSCRIPTION_LOOKUP_FAILED: ${centralErr.message}`)

    const centralRow = central as {
      plan?: string
      user_email?: string
      organization_name?: string
      product_id?: string
    } | null

    if (centralRow) {
      const { data: product, error: productErr } = await hub
        .from('products')
        .select('slug')
        .eq('id', String(centralRow.product_id ?? ''))
        .maybeSingle()

      if (productErr) throw new Error(`PRODUCT_LOOKUP_FAILED: ${productErr.message}`)

      const productRow = product as { slug?: string } | null
      if (productRow?.slug === 'whatsapp-service') {
        return {
          valid: true,
          plan: centralRow.plan,
          userEmail: centralRow.user_email,
          organizationName: centralRow.organization_name,
          deviceWebhookUrl: device.webhookUrl,
          deviceWebhookSecret: device.webhookSecret,
        }
      }
    }

    // Jumpstart system license lives on dgxn — never query these tables on Hub (mzalz).
    if (!jumpstart) {
      logger.error(
        { orgId },
        'JumpStart Supabase not configured — skipping system license entitlement check'
      )
    } else {
      const { data: oss, error: ossErr } = await jumpstart
        .from('org_system_subscriptions')
        .select('plan_code, metadata')
        .eq('organization_id', orgId)
        .eq('system_code', 'jumpstart')
        .eq('status', 'active')
        .maybeSingle()

      if (ossErr) throw new Error(`SYSTEM_SUBSCRIPTION_LOOKUP_FAILED: ${ossErr.message}`)

      const ossRow = oss as { plan_code?: string; metadata?: unknown } | null
      if (ossRow) {
        const { data: planRow, error: planErr } = await jumpstart
          .from('system_license_plans')
          .select('features')
          .eq('system_code', 'jumpstart')
          .eq('code', String(ossRow.plan_code ?? ''))
          .maybeSingle()

        if (planErr) throw new Error(`LICENSE_PLAN_LOOKUP_FAILED: ${planErr.message}`)

        const planData = planRow as { features?: unknown } | null
        const features = (planData?.features ?? {}) as Record<string, unknown>
        const metadata = (ossRow.metadata ?? {}) as Record<string, unknown>
        const included = Math.max(0, Math.floor(Number(features.whatsapp_devices_included ?? 0)))
        const extraPurchased = Math.max(0, Math.floor(Number(metadata.whatsapp_extra_devices ?? 0)))
        const deviceCap = included + extraPurchased

        if (deviceCap >= 1) {
          logger.info({ orgId, included, extraPurchased, deviceCap }, 'WhatsApp allowed via Jumpstart license')
          return {
            valid: true,
            plan: `jumpstart/${String(ossRow.plan_code)}`,
            deviceWebhookUrl: device.webhookUrl,
            deviceWebhookSecret: device.webhookSecret,
          }
        }

        logger.info({ orgId, included, extraPurchased }, 'Jumpstart license has no WhatsApp device slots')
      }
    }

    // Check 4: Partner org slot (WorkMatch and future partners)
    const { data: slot, error: slotErr } = await hub
      .from('partner_org_slots')
      .select('org_id, partner_name, status')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle()

    if (slotErr) throw new Error(`PARTNER_SLOT_LOOKUP_FAILED: ${slotErr.message}`)

    const slotRow = slot as { partner_name?: string } | null
    if (slotRow) {
      logger.info({ orgId, partner: slotRow.partner_name }, 'WhatsApp allowed via partner license')
      return {
        valid: true,
        plan: `partner/${slotRow.partner_name}`,
        deviceWebhookUrl: device.webhookUrl,
        deviceWebhookSecret: device.webhookSecret,
      }
    }

    logger.info({ orgId }, 'No WhatsApp entitlement found for org')
    return {
      valid: false,
      deviceWebhookUrl: device.webhookUrl,
      deviceWebhookSecret: device.webhookSecret,
    }
  } catch (err) {
    logger.error({ orgId, err }, 'Error validating org against Supabase')
    await recordOrgValidationFailure(orgId, err)
    return { valid: false, unavailable: true, deviceWebhookUrl: null, deviceWebhookSecret: null }
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
