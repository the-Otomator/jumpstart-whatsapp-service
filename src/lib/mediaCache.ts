import fs from 'fs'
import path from 'path'
import { downloadMediaMessage, proto, type WAMessage } from '@whiskeysockets/baileys'
import { logger } from './logger'

/** WhatsApp media hard cap (bytes). Over this we skip download and set mediaTooLarge. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,200}$/

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
}

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker'

export type MediaMeta = {
  mime: string | null
  size: number | null
  filename: string | null
  tooLarge: boolean
  filePath: string | null
}

export function isSafePathSegment(value: string): boolean {
  if (!value || !SAFE_ID_RE.test(value)) return false
  // Explicitly reject traversal fragments (`.` is allowed in baileys ids / filenames).
  if (value === '.' || value === '..' || value.includes('..')) return false
  return true
}

export function sessionsRoot(): string {
  return path.join(process.cwd(), 'sessions')
}

export function mediaDir(orgId: string): string {
  return path.join(sessionsRoot(), orgId, 'media')
}

/** Resolve a cached media file path (any extension) after validating ids. */
export function resolveMediaFile(orgId: string, messageId: string): string | null {
  if (!isSafePathSegment(orgId) || !isSafePathSegment(messageId)) return null
  const dir = mediaDir(orgId)
  if (!fs.existsSync(dir)) return null
  const prefix = `${messageId}.`
  try {
    const names = fs.readdirSync(dir)
    const match = names.find((n) => n === messageId || n.startsWith(prefix))
    if (!match) return null
    const full = path.join(dir, match)
    const resolved = path.resolve(full)
    const resolvedDir = path.resolve(dir)
    if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) return null
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null
    return resolved
  } catch {
    return null
  }
}

export function publicMediaUrl(orgId: string, messageId: string): string {
  const host = (process.env.WA_HOST ?? 'wa.otomator.pro').replace(/\/+$/, '')
  const base = /^https?:\/\//i.test(host) ? host : `https://${host}`
  return `${base}/api/media/${orgId}/${messageId}`
}

export function extractMediaMeta(
  message: proto.IMessage,
  mediaType: MediaType
): { mime: string | null; filename: string | null; declaredSize: number | null } {
  const img = message.imageMessage
  const vid = message.videoMessage
  const aud = message.audioMessage
  const doc = message.documentMessage
  const stk = message.stickerMessage

  let mime: string | null = null
  let filename: string | null = null
  let declaredSize: number | null = null

  switch (mediaType) {
    case 'image':
      mime = img?.mimetype ?? 'image/jpeg'
      declaredSize = typeof img?.fileLength === 'number' ? img.fileLength : Number(img?.fileLength ?? 0) || null
      break
    case 'video':
      mime = vid?.mimetype ?? 'video/mp4'
      declaredSize = typeof vid?.fileLength === 'number' ? vid.fileLength : Number(vid?.fileLength ?? 0) || null
      break
    case 'audio':
      mime = aud?.mimetype ?? 'audio/ogg'
      declaredSize = typeof aud?.fileLength === 'number' ? aud.fileLength : Number(aud?.fileLength ?? 0) || null
      break
    case 'document':
      mime = doc?.mimetype ?? 'application/octet-stream'
      filename = doc?.fileName ?? null
      declaredSize = typeof doc?.fileLength === 'number' ? doc.fileLength : Number(doc?.fileLength ?? 0) || null
      break
    case 'sticker':
      mime = stk?.mimetype ?? 'image/webp'
      declaredSize = typeof stk?.fileLength === 'number' ? stk.fileLength : Number(stk?.fileLength ?? 0) || null
      break
  }

  if (!filename) {
    const ext = (mime && MIME_EXT[mime]) || extFromMediaType(mediaType)
    filename = `${mediaType}.${ext}`
  }

  return { mime, filename, declaredSize }
}

function extFromMediaType(mediaType: MediaType): string {
  switch (mediaType) {
    case 'image':
      return 'jpg'
    case 'video':
      return 'mp4'
    case 'audio':
      return 'ogg'
    case 'sticker':
      return 'webp'
    case 'document':
    default:
      return 'bin'
  }
}

function extFromFilenameOrMime(filename: string | null, mime: string | null, mediaType: MediaType): string {
  if (filename && filename.includes('.')) {
    const ext = filename.split('.').pop()
    if (ext && /^[A-Za-z0-9]{1,10}$/.test(ext)) return ext
  }
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime]
  return extFromMediaType(mediaType)
}

/**
 * Download inbound media at receive time and cache under sessions/<orgId>/media/.
 * Failures never throw — caller always continues with text/metadata.
 */
export async function cacheInboundMedia(opts: {
  orgId: string
  messageId: string
  mediaType: MediaType
  waMessage: WAMessage
}): Promise<MediaMeta> {
  const { orgId, messageId, mediaType, waMessage } = opts
  const empty: MediaMeta = { mime: null, size: null, filename: null, tooLarge: false, filePath: null }

  if (!isSafePathSegment(orgId) || !isSafePathSegment(messageId)) {
    logger.warn({ orgId, messageId }, 'Media cache skipped — unsafe path segment')
    return empty
  }

  const messageNode = waMessage.message
  if (!messageNode) return empty

  const { mime, filename, declaredSize } = extractMediaMeta(messageNode, mediaType)

  if (declaredSize != null && declaredSize > MEDIA_MAX_BYTES) {
    return {
      mime,
      size: declaredSize,
      filename,
      tooLarge: true,
      filePath: null,
    }
  }

  try {
    const buffer = (await downloadMediaMessage(
      waMessage,
      'buffer',
      {},
      {
        logger: logger as never,
        reuploadRequest: async (msg) => msg,
      }
    )) as Buffer

    if (!buffer || buffer.length === 0) {
      logger.warn({ orgId, messageId }, 'Media download returned empty buffer')
      return { mime, size: null, filename, tooLarge: false, filePath: null }
    }

    if (buffer.length > MEDIA_MAX_BYTES) {
      return {
        mime,
        size: buffer.length,
        filename,
        tooLarge: true,
        filePath: null,
      }
    }

    const ext = extFromFilenameOrMime(filename, mime, mediaType)
    const dir = mediaDir(orgId)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${messageId}.${ext}`)
    fs.writeFileSync(filePath, buffer)

    return {
      mime,
      size: buffer.length,
      filename,
      tooLarge: false,
      filePath,
    }
  } catch (err) {
    logger.warn(
      { orgId, messageId, err: (err as Error).message },
      'Media download/cache failed — webhook continues without file'
    )
    return { mime, size: declaredSize, filename, tooLarge: false, filePath: null }
  }
}

export function mediaTtlDays(): number {
  const n = Number(process.env.WA_MEDIA_TTL_DAYS ?? 7)
  return Number.isFinite(n) && n > 0 ? n : 7
}

/** Delete cached media files older than TTL. Returns count deleted. */
export function pruneStaleMedia(ttlDays = mediaTtlDays()): number {
  const root = sessionsRoot()
  if (!fs.existsSync(root)) return 0

  const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000
  let deleted = 0

  let orgDirs: string[]
  try {
    orgDirs = fs.readdirSync(root)
  } catch {
    return 0
  }

  for (const orgId of orgDirs) {
    if (!isSafePathSegment(orgId)) continue
    const dir = mediaDir(orgId)
    if (!fs.existsSync(dir)) continue
    let files: string[]
    try {
      files = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of files) {
      const full = path.join(dir, name)
      try {
        const st = fs.statSync(full)
        if (!st.isFile()) continue
        if (st.mtimeMs < cutoffMs) {
          fs.unlinkSync(full)
          deleted += 1
        }
      } catch {
        // best-effort
      }
    }
  }

  if (deleted > 0) {
    logger.info({ deleted, ttlDays }, 'Pruned stale media cache files')
  }
  return deleted
}

let pruneTimer: ReturnType<typeof setInterval> | null = null

/** Startup sweep + periodic prune (reuse interval pattern; no scheduler dependency). */
export function startMediaPruneScheduler(): void {
  if (pruneTimer) return
  try {
    pruneStaleMedia()
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Startup media prune failed')
  }
  // Every 6 hours
  pruneTimer = setInterval(() => {
    try {
      pruneStaleMedia()
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Periodic media prune failed')
    }
  }, 6 * 60 * 60 * 1000)
  // Do not keep process alive solely for prune
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref()
}

export function stopMediaPruneScheduler(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
}
