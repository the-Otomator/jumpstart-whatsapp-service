import { jumpstartSupabase as db } from './jumpstartSupabase'
import { listActiveSessions, getBaileysSocket, getStatus } from '../sessionManager'
import { postWebhook } from './webhookDispatcher'
import { requestHistoryPage, historyMessage } from './historyPull'
import { logger } from './logger'
import { getHaRuntime } from '../ha/coordinator'

let timer: ReturnType<typeof setInterval> | undefined
let running = false

/** No socket is opened or reconnected here. Missing migration/key/switch is fail-closed. */
export async function historyPullTick(): Promise<void> {
  const client = db
  if (running || !client || (getHaRuntime() && !getHaRuntime()!.canServe())) return
  running = true
  try {
    for (const session of listActiveSessions()) {
      if (session.status !== 'connected' || session.provider !== 'baileys' || !session.webhookUrl) continue
      const sock = getBaileysSocket(session.orgId)
      if (!sock) continue
      const { data: job, error } = await client.rpc('wa_history_pull_claim', { p_session_key: session.orgId })
      if (error || !job) continue
      try {
        // Claim rechecks tenant, logging, switch, device, anchor and lease in one transaction.
        const rows = await requestHistoryPage({
          session: session.orgId, enabled: true,
          connected: getStatus(session.orgId)?.status === 'connected',
          anchor: job.anchor, timestampMs: job.anchor_timestamp_ms,
          fetch: (count, key, timestamp) => sock.fetchMessageHistory(count, key, timestamp),
          authorize: async () => {
            if (getBaileysSocket(session.orgId) !== sock || getStatus(session.orgId)?.status !== 'connected'
              || (getHaRuntime() && !getHaRuntime()!.canServe())) return false
            const checked = await client.rpc('wa_history_pull_authorize', { p_conversation: job.conversation_id, p_lease: job.lease_token })
            return !checked.error && checked.data === true
          },
        })
        const messages = rows.map(historyMessage).filter(Boolean)
        await postWebhook(session.webhookUrl, {
          event: 'history.pull.page', orgId: session.orgId,
          isBackfill: true, history: true, skipDownstream: true,
          jobId: job.conversation_id, lease: job.lease_token, messages,
        })
        // The authenticated webhook atomically persists + checkpoints the page.
        // Failed delivery leaves the lease to expire, then retries the same anchor.
      } catch (error) {
        const code = error instanceof Error && error.message === 'HISTORY_PHONE_OFFLINE' ? 'phone_offline' : 'request_failed'
        await client.rpc('wa_history_pull_fail', { p_conversation_id: job.conversation_id, p_lease: job.lease_token, p_code: code })
      }
    }
  } catch {
    logger.warn('History pull pass unavailable; no new requests started')
  } finally { running = false }
}

export function startHistoryPullWorker(): void {
  if (!timer) { timer = setInterval(() => { void historyPullTick() }, 10_000); timer.unref() }
}
export function stopHistoryPullWorker(): void { if (timer) clearInterval(timer); timer = undefined }
