import type { SendMessageRequest } from '../types'

export const OFFICIAL_OTP_SESSION = 'meta-1f63d665b06549c7ad0492427cfb7265'
export const OTP_SEND_BUDGET_MS = 2500

export function isOfficialOtp(req: SendMessageRequest): boolean {
  return req.orgId === OFFICIAL_OTP_SESSION && req.type === 'template' &&
    ['otp_login_he', 'otp_login_en'].includes(req.template?.name ?? '')
}
