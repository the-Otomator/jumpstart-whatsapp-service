import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

declare global {
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string) ?? crypto.randomUUID()
  next()
}
