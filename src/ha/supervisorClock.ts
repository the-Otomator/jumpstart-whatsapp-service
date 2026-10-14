// Deliberately independent of the DB/coordinator/provider modules in the watchdog.
export const SELF_FENCE_MS = 15000
export function monotonic(): number { return Number(process.hrtime.bigint() / 1000000n) }
