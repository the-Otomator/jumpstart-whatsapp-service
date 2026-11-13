import type { Request, Response, NextFunction } from 'express'

/** Hub Edge marks sends it already gated with x-jumpstart-outbox-checked. */
export const OUTBOX_CHECKED_HEADER = 'x-jumpstart-outbox-checked'

export type OutboxGateMode = 'off' | 'observe' | 'required'

export function readOutboxGateMode(env: NodeJS.ProcessEnv = process.env): OutboxGateMode {
  const raw = (env.OUTBOX_SEND_GATE_MODE ?? 'observe').trim().toLowerCase()
  if (raw === 'off' || raw === 'required' || raw === 'observe') return raw
  return 'observe'
}

export function outboxCheckedPurpose(req: Request): string | null {
  const value = req.header(OUTBOX_CHECKED_HEADER)
  return value?.trim() || null
}

/** Defense in depth under Hub's waDeviceSendPolicy. Default observe never blocks. */
export function assertOutboxSendGate(req: Request, res: Response, next: NextFunction): void {
  const mode = readOutboxGateMode()
  if (mode === 'off') {
    next()
    return
  }
  const purpose = outboxCheckedPurpose(req)
  if (purpose) {
    next()
    return
  }
  if (mode === 'observe') {
    console.warn('outbox_send_gate_missing_header', { path: req.path, method: req.method })
    next()
    return
  }
  res.status(503).json({
    error: 'outbox_send_gate_required',
    code: 'OUTBOX_SEND_GATE_REQUIRED',
  })
}
