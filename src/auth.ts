import { Request, Response, NextFunction } from 'express'
import { logger } from './lib/logger'

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.path, ip: req.ip }, 'Request without auth header')
    res.status(401).json({ error: 'Missing Authorization header', code: 'AUTH_MISSING' })
    return
  }

  const token = authHeader.slice(7)
  if (token !== process.env.API_SECRET) {
    logger.warn({ path: req.path, ip: req.ip }, 'Invalid auth token')
    res.status(401).json({ error: 'Invalid token', code: 'AUTH_INVALID' })
    return
  }

  next()
}
