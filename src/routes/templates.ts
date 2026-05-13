import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { MetaCredentials } from '../types'
import * as metaClient from '../lib/metaClient'
import * as templateCache from '../lib/templateCache'
import { validateBody } from '../middleware/validate'
import { logger } from '../lib/logger'

const router = Router()

// ── Zod schemas ────────────────────────────────────────────────

const metaCredsSchema = z.object({
  accessToken: z.string().min(1),
  wabaId: z.string().min(1),
})

const templateComponentSchema = z.object({
  type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
  format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']).optional(),
  text: z.string().optional(),
  buttons: z.array(z.object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
    text: z.string().min(1),
    url: z.string().url().optional(),
    phone_number: z.string().optional(),
  })).optional(),
})

const createTemplateSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/, 'Template name: lowercase alphanumeric + underscores only'),
  language: z.string().min(2).max(10),
  category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
  components: z.array(templateComponentSchema).min(1),
  meta: metaCredsSchema,
})

const syncSchema = z.object({
  orgId: z.string().min(1),
  meta: metaCredsSchema,
})

const deleteSchema = z.object({
  meta: metaCredsSchema,
})

/**
 * Extract MetaCredentials from GET request headers.
 * GET routes can't have a body, so creds come via custom headers.
 */
function extractMetaCredsFromHeaders(req: Request): MetaCredentials | null {
  const accessToken = req.headers['x-meta-access-token'] as string | undefined
  const wabaId = req.headers['x-meta-waba-id'] as string | undefined
  if (!accessToken || !wabaId) return null
  return { accessToken, wabaId }
}

// ── Routes ─────────────────────────────────────────────────────

/**
 * POST /api/templates — Create + submit a template to Meta
 */
router.post('/', validateBody(createTemplateSchema), async (req: Request, res: Response) => {
  const { orgId, name, language, category, components, meta } = req.body
  try {
    const result = await metaClient.createTemplate(meta, { name, language, category, components })
    templateCache.invalidate(orgId)
    res.status(201).json({ success: true, template: { name, status: result.status, metaId: result.id } })
  } catch (err: any) {
    logger.error({ orgId, name, err: err.message }, 'Template creation failed')
    res.status(err.status ?? 502).json({ error: err.message, code: 'META_API_ERROR' })
  }
})

/**
 * GET /api/templates?orgId=... — List templates (cached, 5-min TTL)
 * Meta creds via x-meta-access-token / x-meta-waba-id headers.
 */
router.get('/', async (req: Request, res: Response) => {
  const orgId = req.query.orgId as string | undefined
  if (!orgId) {
    res.status(400).json({ error: 'orgId query parameter is required', code: 'VALIDATION_ERROR' })
    return
  }

  const creds = extractMetaCredsFromHeaders(req)
  if (!creds) {
    res.status(400).json({ error: 'x-meta-access-token and x-meta-waba-id headers are required', code: 'VALIDATION_ERROR' })
    return
  }

  const cached = templateCache.getCached(orgId)
  if (cached) {
    res.json({ success: true, templates: cached, cached: true })
    return
  }

  try {
    const templates = await metaClient.listTemplates(creds)
    templateCache.setCache(orgId, templates)
    res.json({ success: true, templates, cached: false })
  } catch (err: any) {
    logger.error({ orgId, err: err.message }, 'Template list failed')
    res.status(err.status ?? 502).json({ error: err.message, code: 'META_API_ERROR' })
  }
})

/**
 * GET /api/templates/:name?orgId=... — Single template detail
 * Meta creds via headers (same as list).
 */
router.get('/:name', async (req: Request, res: Response) => {
  const { name } = req.params
  const orgId = req.query.orgId as string | undefined
  if (!orgId) {
    res.status(400).json({ error: 'orgId query parameter is required', code: 'VALIDATION_ERROR' })
    return
  }

  const creds = extractMetaCredsFromHeaders(req)
  if (!creds) {
    res.status(400).json({ error: 'x-meta-access-token and x-meta-waba-id headers are required', code: 'VALIDATION_ERROR' })
    return
  }

  try {
    const template = await metaClient.getTemplate(creds, name)
    if (!template) {
      res.status(404).json({ error: `Template "${name}" not found`, code: 'NOT_FOUND' })
      return
    }
    res.json({ success: true, template })
  } catch (err: any) {
    logger.error({ orgId, name, err: err.message }, 'Template get failed')
    res.status(err.status ?? 502).json({ error: err.message, code: 'META_API_ERROR' })
  }
})

/**
 * POST /api/templates/sync — Force re-pull from Meta, replace cache
 */
router.post('/sync', validateBody(syncSchema), async (req: Request, res: Response) => {
  const { orgId, meta } = req.body
  try {
    const templates = await metaClient.listTemplates(meta)
    templateCache.setCache(orgId, templates)
    res.json({ success: true, templates, cached: false })
  } catch (err: any) {
    logger.error({ orgId, err: err.message }, 'Template sync failed')
    res.status(err.status ?? 502).json({ error: err.message, code: 'META_API_ERROR' })
  }
})

/**
 * DELETE /api/templates/:name?orgId=... — Delete template from Meta + invalidate cache
 * Meta creds in request body.
 */
router.delete('/:name', validateBody(deleteSchema), async (req: Request, res: Response) => {
  const { name } = req.params
  const orgId = req.query.orgId as string | undefined
  if (!orgId) {
    res.status(400).json({ error: 'orgId query parameter is required', code: 'VALIDATION_ERROR' })
    return
  }

  const { meta } = req.body
  try {
    await metaClient.deleteTemplate(meta, name)
    templateCache.invalidate(orgId)
    res.json({ success: true, deleted: name })
  } catch (err: any) {
    logger.error({ orgId, name, err: err.message }, 'Template delete failed')
    res.status(err.status ?? 502).json({ error: err.message, code: 'META_API_ERROR' })
  }
})

export default router
