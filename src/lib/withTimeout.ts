/** Default Baileys/pool send ACK wait. Override via WA_SEND_TIMEOUT_MS. */
function boundedTimeout(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  return value && Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback
}

export const WA_SEND_TIMEOUT_MS = boundedTimeout(process.env.WA_SEND_TIMEOUT_MS, 15_000, 20_000)

/**
 * Ceiling for enqueueAndWait: queue wait budget + send timeout + small margin.
 * Override via WA_ENQUEUE_CEILING_MS.
 */
export const WA_ENQUEUE_CEILING_MS = boundedTimeout(process.env.WA_ENQUEUE_CEILING_MS, 18_000, 19_000)

/**
 * Race `promise` against a timer. Rejects with `new Error(label)` on expiry.
 * Always clears the timer when either side settles.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}
