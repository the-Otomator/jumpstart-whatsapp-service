import { Request, Response, NextFunction } from 'express'

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  const token = authHeader.slice(7)
  if (token !== process.env.API_SECRET) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  next()
}
