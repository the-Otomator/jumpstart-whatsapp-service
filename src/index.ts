import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import pinoHttp from 'pino-http'
import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { authMiddleware } from './auth'
import sessionRoutes from './routes/sessions'
import messageRoutes from './routes/messages'
import globalmaxRouter from './routes/globalmax'
import groupRoutes from './routes/groups'
import connectRoutes from './routes/connect'
import metaWebhookRoutes from './routes/meta-webhook'
import { listActiveSessions, restoreSessions } from './sessionManager'
import { logger } from './lib/logger'
import { requestIdMiddleware } from './middleware/requestId'
import { setupGracefulShutdown } from './lib/shutdown'

const execAsync = promisify(exec)

// In-memory error log (last 100 errors, used by /health)
interface ErrorEntry { time: number; msg: string }
const recentErrorLog: ErrorEntry[] = []
export function trackError(msg: string): void {
  recentErrorLog.push({ time: Date.now(), msg })
  if (recentErrorLog.length > 100) recentErrorLog.shift()
}

// Disk stats (Linux df)
interface DiskStats { totalGB: number; usedGB: number; freeGB: number; percentUsed: number }
async function getDiskStats(): Promise<DiskStats | null> {
  try {
    const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2, $3, $4}'")
    const [total, used, free] = stdout.trim().split(' ').map(Number)
    if (!total) return null
    return {
      totalGB: Math.round(total / 1e9 * 10) / 10,
      usedGB: Math.round(used / 1e9 * 10) / 10,
      freeGB: Math.round(free / 1e9 * 10) / 10,
      percentUsed: Math.round((used / total) * 100),
    }
  } catch {
    return null
  }
}

// Validate required environment
if (!process.env.API_SECRET) {
  logger.fatal('API_SECRET environment variable is required')
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT ?? 3001

// CORS + iframe embed (same list: fetch /status + <iframe src=/connect/...>)
//
// Wildcard subdomain patterns - these always apply regardless of ALLOWED_ORIGINS.
// Each regex is tested against the full Origin header value.
const builtInPatterns: RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.workmatch\.space$/,   // *.workmatch.space
  /^https:\/\/[a-z0-9-]+\.otomator\.co\.il$/,    // *.otomator.co.il
  /^https?:\/\/localhost(:\d+)?$/,                // localhost (any port, http or https)
]

// Explicit origins from env (exact matches, for non-wildcard domains)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const allowedOriginSet = new Set(allowedOrigins)

// Check whether a given origin is allowed (patterns OR explicit list)
function isOriginAllowed(origin: string): boolean {
  if (allowedOriginSet.has(origin)) return true
  return builtInPatterns.some((re) => re.test(origin))
}

// frame-ancestors needs explicit entries - keep env origins + wildcard CSP tokens
const frameAncestors: string[] = [
  "'self'",
  '*.workmatch.space',
  '*.otomator.co.il',
  ...allowedOrigins,
]

if (allowedOrigins.length === 0) {
  logger.info(
    'ALLOWED_ORIGINS is empty - using built-in wildcard patterns only (*.workmatch.space, *.otomator.co.il, localhost).'
  )
} else {
  logger.info(
    { allowedOriginCount: allowedOrigins.length },
    'CORS + frame-ancestors enabled for configured + built-in origins'
  )
}

// Security
app.use(
  helmet({
    // Default same-origin blocks cross-origin fetch of /status from Jumpstart even when CORS allows.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // connect page
        imgSrc: ["'self'", "data:"], // QR base64
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors, // without ALLOWED_ORIGINS only 'self' -> iframe embed fails
      },
    },
  })
)
app.use(express.json({ limit: '5mb' })) // allow media base64, but cap it
app.use(requestIdMiddleware)

app.use(
  cors({
    origin(requestOrigin, callback) {
      // Allow requests with no Origin header (e.g. server-to-server, curl)
      if (!requestOrigin) return callback(null, true)
      if (isOriginAllowed(requestOrigin)) return callback(null, requestOrigin)
      callback(null, false)
    },
  })
)

// Request logging
app.use(
  pinoHttp({
    logger: logger as any,
    autoLogging: {
      ignore: (req) => (req.url ?? '').startsWith('/health'),
    },
    customProps: (req) => ({ requestId: (req as express.Request).requestId }),
  })
)

// Rate limiting (per IP, 100 requests/minute)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
})

// Health check (no auth)
app.get('/health', async (_req, res) => {
  const sessionList = listActiveSessions()
  const loadAvg = os.loadavg()
  const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024)
  const freeMemoryMB = Math.round(os.freemem() / 1024 / 1024)
  const disk = await getDiskStats()
  const hourAgo = Date.now() - 60 * 60 * 1_000
  const recentErrors = recentErrorLog.filter((e) => e.time > hourAgo).length

  res.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    hostname: os.hostname(),
    sessions: sessionList.length,
    connected: sessionList.filter((s) => s.status === 'connected').length,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    totalMemoryMB,
    freeMemoryMB,
    loadAvg: {
      '1min': Math.round(loadAvg[0] * 100) / 100,
      '5min': Math.round(loadAvg[1] * 100) / 100,
      '15min': Math.round(loadAvg[2] * 100) / 100,
    },
    disk,
    recentErrors,
  })
})

// Connect page (no auth - onboarding flow)
app.use('/connect', connectRoutes)

// Meta Cloud API webhook (no auth - called by Meta directly)
app.use('/meta-webhook', metaWebhookRoutes)

// API routes (auth + rate limit)
app.use('/api', apiLimiter, authMiddleware)
app.use('/api/sessions', sessionRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/globalmax', authMiddleware, globalmaxRouter)
app.use('/api/groups', groupRoutes)

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error')
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  })
})

// Start server
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'WhatsApp service started')

  // Auto-restore previously connected sessions
  try {
    await restoreSessions()
  } catch (err) {
    logger.error({ err }, 'Error during session restore')
  }
})

// Graceful shutdown
setupGracefulShutdown(server)
