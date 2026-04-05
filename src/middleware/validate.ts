import { z } from 'zod'
import { Request, Response, NextFunction } from 'express'

// ── Reusable field schemas ──────────────────────────────────────

/** orgId: alphanumeric + underscores/hyphens, 1-64 chars */
export const orgIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Invalid orgId format')

/** Phone number: digits only, 10-15 chars (international without +) */
export const phoneSchema = z.string().regex(/^\d{10,15}$/, 'Phone must be 10-15 digits, no + prefix')

/** Webhook URL: must be valid https URL */
export const webhookUrlSchema = z.string().url('Must be a valid URL').startsWith('https', 'Webhook URL must use HTTPS').optional()

// ── Request body schemas ────────────────────────────────────────

export const startSessionSchema = z.object({
  webhookUrl: webhookUrlSchema,
  autoRestore: z.boolean().optional().default(true),
})

export const migrateSessionSchema = z.object({
  targetOrgId: orgIdSchema,
  webhookUrl: webhookUrlSchema,
})

export const sendMessageSchema = z.object({
  orgId: orgIdSchema,
  to: phoneSchema,
  type: z.enum(['text', 'image', 'video', 'audio', 'document', 'location', 'contact']).optional().default('text'),
  message: z.string().max(4096, 'Message too long (max 4096 chars)').optional(),
  mediaUrl: z.string().url('Must be a valid URL').optional(),
  mediaBase64: z.string().optional(),
  mimetype: z.string().optional(),
  filename: z.string().max(256).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  contactName: z.string().max(256).optional(),
  contactPhone: phoneSchema.optional(),
}).refine(
  (data) => {
    if (data.type === 'text') return !!data.message
    if (data.type === 'image' || data.type === 'video' || data.type === 'audio' || data.type === 'document') {
      return !!(data.mediaUrl || data.mediaBase64)
    }
    if (data.type === 'location') return data.latitude != null && data.longitude != null
    if (data.type === 'contact') return !!(data.contactName && data.contactPhone)
    return true
  },
  { message: 'Missing required fields for this message type' }
)

export const sendBulkSchema = z.array(sendMessageSchema).min(1).max(100)

/** Body for `POST /api/sessions/:orgId/send` (orgId from path). */
export const sessionPathSendBodySchema = z.object({
  to: phoneSchema,
  message: z.string().min(1).max(4096, 'Message too long (max 4096 chars)'),
})

export const checkContactsSchema = z.object({
  orgId: orgIdSchema,
  phones: z.array(phoneSchema).min(1).max(100),
})

// ── Validation middleware factory ───────────────────────────────

export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors,
      })
      return
    }
    req.body = result.data
    next()
  }
}

export function validateParams(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params)
    if (!result.success) {
      const errors = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      res.status(400).json({
        error: 'Invalid path parameters',
        code: 'VALIDATION_ERROR',
        details: errors,
      })
      return
    }
    next()
  }
}

/** Params schema for routes with :orgId */
export const orgIdParamsSchema = z.object({ orgId: orgIdSchema })
