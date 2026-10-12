/** Serial watchdog; a slow pass never overlaps the next interval. */
export const SESSION_RECOVERY_INTERVAL_MS = 15 * 60 * 1000

export function createSessionRecoveryScheduler(recover: () => Promise<void>, onError: (error: unknown) => void) {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false
  return {
    async tick(): Promise<void> {
      if (running) return
      running = true
      try { await recover() } catch (error) { onError(error) } finally { running = false }
    },
    start(): void {
      if (timer) return
      timer = setInterval(() => { void this.tick() }, SESSION_RECOVERY_INTERVAL_MS)
      timer.unref()
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
