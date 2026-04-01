import { Request, Response, NextFunction } from 'express'
import { z, ZodSchema } from 'zod'

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      })
      return
    }
    req.body = result.data
    next()
  }
}

export const sendMessageSchema = z.object({
  orgId: z.string().min(1),
  to: z.string().min(7),
  message: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().optional(),
}).refine((d) => d.message || d.mediaUrl, {
  message: 'Either message or mediaUrl is required',
})

export const sendBulkSchema = z.array(sendMessageSchema).min(1).max(100)

export const startSessionSchema = z.object({
  webhookUrl: z.string().url().optional(),
})
