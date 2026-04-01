import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authMiddleware } from './auth'
import sessionRoutes from './routes/sessions'
import messageRoutes from './routes/messages'
import { sessions, restoreSessions, stopAllSessions } from './sessionManager'
import { requestIdMiddleware } from './middleware/requestId'
import { logger } from './lib/logger'
import { setupGracefulShutdown } from './lib/shutdown'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(requestIdMiddleware)
app.use(express.json())
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
}))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, uptime: process.uptime() })
})

app.use('/api', authMiddleware)
app.use('/api/sessions', sessionRoutes)
app.use('/api/messages', messageRoutes)

const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'whatsapp-service listening')
  await restoreSessions()
})

setupGracefulShutdown(server, stopAllSessions)
