import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { authMiddleware } from './auth'
import sessionRoutes from './routes/sessions'
import messageRoutes from './routes/messages'
import { sessions } from './sessionManager'

const app = express()
const PORT = process.env.PORT ?? 3001

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

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on port ${PORT}`)
})
