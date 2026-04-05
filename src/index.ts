import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import pinoHttp from 'pino-http'
import { authMiddleware } from './auth'
import sessionRoutes from './routes/sessions'
import messageRoutes from './routes/messages'
import connectRoutes from './routes/connect'
import { listActiveSessions, restoreSessions } from './sessionManager'
import { logger } from './lib/logger'
import { requestIdMiddleware } from './middleware/requestId'
import { setupGracefulShutdown } from './lib/shutdown'

// ── Validate required environment ────────────────────────────────
if (!process.env.API_SECRET) {
  logger.fatal('API_SECRET environment variable is required')
  process.exit(1)
}

const app = express()
const PORT = process.env.PORT ?? 3001

// ── CORS + iframe embed (same list: fetch /status + <iframe src=/connect/...>) ──
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const frameAncestors =
  allowedOrigins.length > 0 ? (["'self'", ...allowedOrigins] as string[]) : (["'self'"] as string[])

if (allowedOrigins.length === 0) {
  logger.warn(
    'ALLOWED_ORIGINS is empty — browsers will block fetch() to /connect/.../status and iframes from Jumpstart. Set comma-separated origins in .env (e.g. http://localhost:5174,https://hub.example.com).'
  )
} else {
  logger.info(
    { allowedOriginCount: allowedOrigins.length },
    'CORS + frame-ancestors enabled for configured frontend origins'
  )
}

// ── Security ─────────────────────────────────────────────────────
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
        frameAncestors, // without ALLOWED_ORIGINS only 'self' → iframe embed fails
      },
    },
  })
)
app.use(express.json({ limit: '5mb' })) // allow media base64, but cap it
app.use(requestIdMiddleware)

app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }))

// ── Request logging ──────────────────────────────────────────────
app.use(
  pinoHttp({
    logger: logger as any,
    autoLogging: {
      ignore: (req) => (req.url ?? '').startsWith('/health'),
    },
    customProps: (req) => ({ requestId: (req as express.Request).requestId }),
  })
)

// ── Rate limiting (per IP, 100 requests/minute) ──────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
})

// ── Health check (no auth) ───────────────────────────────────────
app.get('/health', (_req, res) => {
  const sessionList = listActiveSessions()
  res.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    sessions: sessionList.length,
    connected: sessionList.filter((s) => s.status === 'connected').length,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  })
})

// ── Connect page (no auth — onboarding flow) ────────────────────
app.use('/connect', connectRoutes)

// ── API routes (auth + rate limit) ───────────────────────────────
app.use('/api', apiLimiter, authMiddleware)
app.use('/api/sessions', sessionRoutes)
app.use('/api/messages', messageRoutes)

// ── Global error handler ─────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error')
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  })
})

// ── Start server ─────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'WhatsApp service started')

  // Auto-restore previously connected sessions
  try {
    await restoreSessions()
  } catch (err) {
    logger.error({ err }, 'Error during session restore')
  }
})

// ── Graceful shutdown ────────────────────────────────────────────
setupGracefulShutdown(server)