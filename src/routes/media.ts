import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { isSafePathSegment, resolveMediaFile } from '../lib/mediaCache'
import { logger } from '../lib/logger'

const router = Router()

/**
 * GET /api/media/:orgId/:messageId
 * Authenticated (Bearer API_SECRET). Streams a cached inbound media file.
 */
router.get('/:orgId/:messageId', (req: Request, res: Response) => {
  const { orgId, messageId } = req.params

  if (!isSafePathSegment(orgId) || !isSafePathSegment(messageId)) {
    res.status(400).json({ error: 'Invalid path parameters', code: 'INVALID_PATH' })
    return
  }

  const filePath = resolveMediaFile(orgId, messageId)
  if (!filePath) {
    res.status(404).json({ error: 'Media not found', code: 'MEDIA_NOT_FOUND' })
    return
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.status(404).json({ error: 'Media not found', code: 'MEDIA_NOT_FOUND' })
    return
  }

  const ext = path.extname(filePath).slice(1).toLowerCase()
  const contentType = contentTypeFromExt(ext)
  const filename = path.basename(filePath)

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', String(stat.size))
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`)

  const stream = fs.createReadStream(filePath)
  stream.on('error', (err) => {
    logger.warn({ orgId, messageId, err: err.message }, 'Media stream error')
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed', code: 'STREAM_ERROR' })
    } else {
      res.end()
    }
  })
  stream.pipe(res)
})

function contentTypeFromExt(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp4':
      return 'video/mp4'
    case '3gp':
      return 'video/3gpp'
    case 'ogg':
      return 'audio/ogg'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

export default router
