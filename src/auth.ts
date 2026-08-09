import { Request, Response, NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { logger } from './lib/logger'

function credentialMatches(token: string, credential: string): boolean {
  const tokenDigest = createHash('sha256').update(token, 'utf8').digest()
  const credentialDigest = createHash('sha256').update(credential, 'utf8').digest()
  return timingSafeEqual(tokenDigest, credentialDigest)
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ path: req.path, ip: req.ip }, 'Request without auth header')
    res.status(401).json({ error: 'Missing Authorization header', code: 'AUTH_MISSING' })
    return
  }

  const token = authHeader.slice(7)
  const currentCredential = process.env.API_SECRET ?? ''
  const nextCredential = process.env.API_SECRET_NEXT ?? ''

  // Evaluate both fixed-length digest comparisons on every request. Configuration
  // checks are applied only after both comparisons so neither match short-circuits.
  const matchesCurrent = credentialMatches(token, currentCredential)
  const matchesNext = credentialMatches(token, nextCredential)
  const currentConfigured = currentCredential.length > 0
  const nextConfigured = nextCredential.length > 0
  const authenticated = currentConfigured && (
    matchesCurrent || (nextConfigured && matchesNext)
  )

  if (!authenticated) {
    logger.warn({ path: req.path, ip: req.ip }, 'Invalid auth token')
    res.status(401).json({ error: 'Invalid token', code: 'AUTH_INVALID' })
    return
  }

  logger.info(
    { path: req.path, ip: req.ip, usedNext: nextConfigured && matchesNext && !matchesCurrent },
    'Request authenticated'
  )
  next()
}
