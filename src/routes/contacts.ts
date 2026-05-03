import { Router, Request, Response } from 'express'
import { getBaileysSocket, getStatus } from '../sessionManager'
import {
  validateParams,
  validateQuery,
  contactPhoneParamsSchema,
  contactOrgIdQuerySchema,
} from '../middleware/validate'
import { normalizePhone } from '../lib/phone'
import { orgLogger } from '../lib/logger'
import type {
  ContactBusinessProfile,
  ContactExistsResponse,
  ContactProfileResponse,
} from '../types'

const router = Router()

// ── Per-(orgId, phone) profile cache ────────────────────────────
//
// Profiles change rarely; Baileys' fetches are cheap but rate-limited by
// WhatsApp. 6h TTL matches the contact-card enrichment cadence in jumpstart's
// CRM and prevents repeated lookups when a card is opened multiple times.
const PROFILE_TTL_MS = 6 * 60 * 60 * 1_000
const profileCache = new Map<string, { expiresAt: number; data: ContactProfileResponse }>()

function cacheKey(orgId: string, phone: string): string {
  return `${orgId}|${phone}`
}

function getCached(orgId: string, phone: string): ContactProfileResponse | undefined {
  const entry = profileCache.get(cacheKey(orgId, phone))
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    profileCache.delete(cacheKey(orgId, phone))
    return undefined
  }
  return entry.data
}

function setCached(orgId: string, phone: string, data: ContactProfileResponse): void {
  profileCache.set(cacheKey(orgId, phone), {
    expiresAt: Date.now() + PROFILE_TTL_MS,
    data,
  })
}

/** Resolve and validate a Baileys socket, returning 404/503 if not ready. */
function requireSocket(orgId: string, res: Response) {
  const session = getStatus(orgId)
  if (!session || session.status !== 'connected') {
    res.status(404).json({ error: `Session ${orgId} not connected`, code: 'SESSION_NOT_CONNECTED' })
    return null
  }
  const sock = getBaileysSocket(orgId)
  if (!sock) {
    res.status(503).json({ error: `Baileys socket unavailable for ${orgId}`, code: 'SOCKET_UNAVAILABLE' })
    return null
  }
  return sock
}

/** Map Baileys' WABusinessProfile to our snake_case wire shape. */
function mapBusinessProfile(raw: any): ContactBusinessProfile {
  const websites: string[] = Array.isArray(raw?.website)
    ? raw.website.filter((w: unknown): w is string => typeof w === 'string')
    : []

  // business_hours has `config` on some payloads and `business_config` on others
  const hoursTz: string | undefined = raw?.business_hours?.timezone
  const hoursCfg: any[] | undefined = raw?.business_hours?.config ?? raw?.business_hours?.business_config
  const business_hours = hoursTz || hoursCfg
    ? {
        timezone: hoursTz,
        schedule: Array.isArray(hoursCfg)
          ? hoursCfg.map((h: any) => ({
              day_of_week: String(h?.day_of_week ?? ''),
              mode: String(h?.mode ?? ''),
              open_time: typeof h?.open_time === 'number' ? h.open_time : undefined,
              close_time: typeof h?.close_time === 'number' ? h.close_time : undefined,
            }))
          : undefined,
      }
    : null

  return {
    description: raw?.description ?? null,
    category: raw?.category ?? null,
    email: raw?.email ?? null,
    websites,
    address: raw?.address ?? null,
    business_hours,
  }
}

// ── GET /api/contacts/:phone/exists?orgId=... ───────────────────
router.get(
  '/:phone/exists',
  validateParams(contactPhoneParamsSchema),
  validateQuery(contactOrgIdQuerySchema),
  async (req: Request, res: Response) => {
    const { phone } = req.params
    const orgId = String(req.query.orgId)
    const log = orgLogger(orgId)

    let normalized: string
    try {
      normalized = normalizePhone(phone)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message, code: 'INVALID_PHONE' })
      return
    }

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jid = `${normalized}@s.whatsapp.net`
      const result = await sock.onWhatsApp(jid)
      const exists = Boolean(result?.[0]?.exists)

      const response: ContactExistsResponse = {
        success: true,
        phone: normalized,
        exists_on_whatsapp: exists,
        jid: exists ? String(result?.[0]?.jid ?? jid) : undefined,
      }
      res.json(response)
    } catch (err) {
      log.error({ phone: normalized, err: (err as Error).message }, 'Contact exists check failed')
      res.status(500).json({ error: (err as Error).message, code: 'CONTACT_EXISTS_FAILED' })
    }
  }
)

// ── GET /api/contacts/:phone/profile?orgId=... ──────────────────
router.get(
  '/:phone/profile',
  validateParams(contactPhoneParamsSchema),
  validateQuery(contactOrgIdQuerySchema),
  async (req: Request, res: Response) => {
    const { phone } = req.params
    const orgId = String(req.query.orgId)
    const log = orgLogger(orgId)

    let normalized: string
    try {
      normalized = normalizePhone(phone)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message, code: 'INVALID_PHONE' })
      return
    }

    const cached = getCached(orgId, normalized)
    if (cached) {
      res.setHeader('X-Cache', 'HIT')
      res.json(cached)
      return
    }

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jid = `${normalized}@s.whatsapp.net`

      // 1. Existence check first — short-circuit if the number isn't on WA.
      const onWaResult = await sock.onWhatsApp(jid)
      const existsRaw = onWaResult?.[0]?.exists
      const exists = Boolean(existsRaw)

      if (!exists) {
        const response: ContactProfileResponse = {
          success: true,
          phone: normalized,
          exists_on_whatsapp: false,
        }
        setCached(orgId, normalized, response)
        res.setHeader('X-Cache', 'MISS')
        res.json(response)
        return
      }

      // 2. Pull picture / about / business profile in parallel — each is
      //    independently optional and a failure on one shouldn't kill the rest.
      const [pictureUrl, statusList, businessProfile] = await Promise.all([
        sock.profilePictureUrl(jid, 'image').catch((err: any) => {
          // Baileys throws Boom 404 when the user hides their picture or has none
          const status = err?.output?.statusCode ?? err?.data?.statusCode
          if (status !== 404 && status !== 401) {
            log.debug({ phone: normalized, err: err?.message }, 'profilePictureUrl failed (non-404)')
          }
          return undefined
        }),
        sock.fetchStatus(jid).catch((err: any) => {
          log.debug({ phone: normalized, err: err?.message }, 'fetchStatus failed')
          return undefined
        }),
        sock.getBusinessProfile(jid).catch((err: any) => {
          log.debug({ phone: normalized, err: err?.message }, 'getBusinessProfile failed')
          return undefined
        }),
      ])

      // statusList is USyncQueryResultList[] — entry has { id, status: { status, setAt } }
      const statusEntry: any = Array.isArray(statusList) ? statusList[0] : undefined
      const aboutText: string | null = statusEntry?.status?.status ?? null

      const response: ContactProfileResponse = {
        success: true,
        phone: normalized,
        exists_on_whatsapp: true,
        profile_picture_url: pictureUrl ?? null,
        about: aboutText,
      }

      if (businessProfile) {
        response.business_profile = mapBusinessProfile(businessProfile)
      }

      setCached(orgId, normalized, response)
      res.setHeader('X-Cache', 'MISS')
      res.json(response)
    } catch (err) {
      log.error({ phone: normalized, err: (err as Error).message }, 'Contact profile fetch failed')
      res.status(500).json({ error: (err as Error).message, code: 'CONTACT_PROFILE_FAILED' })
    }
  }
)

export default router
