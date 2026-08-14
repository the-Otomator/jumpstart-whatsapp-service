import pino from 'pino'
import { logger } from './logger'

/**
 * Crash capture — makes an unexpected process exit attributable.
 *
 * Before this module the process registered only SIGTERM/SIGINT (see `shutdown.ts`).
 * On Node >= 15 an uncaught exception or unhandled rejection is printed by Node to
 * *stderr* and the process exits 1 without ever passing through pino — which is the
 * silent `exit 1` observed in production on 2026-08-14T07:24:19Z.
 *
 * Crash semantics are preserved on purpose: we log, flush, and still exit non-zero so
 * Docker's `unless-stopped` restarts exactly as it does today. Nothing is swallowed.
 */

export type CrashContextProvider = () => Record<string, unknown>

export interface CrashCaptureOptions {
  /** Extra context captured at crash time (e.g. live sessions). May throw; it is guarded. */
  getContext?: CrashContextProvider
  /** Injected by tests. Defaults to `process.exit`. */
  exit?: (code: number) => void
  /** Injected by tests. Defaults to the shared pino logger. */
  log?: pino.Logger
}

let installed = false
let fatalDepth = 0

/**
 * Flush the pino destination synchronously.
 *
 * In production `logger.ts` builds pino with no transport, which resolves to a SonicBoom
 * destination with `sync: false` (verified against pino 10.3.1). pino wraps it in
 * `buildSafeSonicBoom`, which registers its own `on-exit-leak-free` flush — but that
 * listener is registered when the logger module is first loaded, i.e. *before* the
 * handlers below. Node runs `exit` listeners in registration order, so pino would flush
 * and only then would our handler write. Flushing explicitly is what makes a fatal log
 * survive the exit rather than sit in the buffer.
 *
 * Returns the mechanism used so tests can assert this is not silently a no-op.
 */
export function flushLogsSync(log: pino.Logger = logger): 'flushSync' | 'flush' | 'none' {
  const stream = (log as unknown as Record<symbol, unknown>)[pino.symbols.streamSym] as
    | { flushSync?: () => void }
    | undefined

  if (stream && typeof stream.flushSync === 'function') {
    try {
      stream.flushSync()
      return 'flushSync'
    } catch {
      // Fall through to the async flush below.
    }
  }

  if (typeof log.flush === 'function') {
    try {
      log.flush()
      return 'flush'
    } catch {
      // Nothing left to try.
    }
  }

  return 'none'
}

function describe(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    // `cause` is ES2022; tsconfig targets ES2020 lib, so read it off the object.
    const cause = (value as unknown as { cause?: unknown }).cause
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(cause !== undefined ? { cause: String(cause) } : {}),
    }
  }
  try {
    return { name: typeof value, message: JSON.stringify(value) ?? String(value) }
  } catch {
    return { name: typeof value, message: String(value) }
  }
}

/**
 * Install `uncaughtException` / `unhandledRejection` / `exit` handlers.
 * Idempotent — returns false if already installed.
 */
export function installCrashCapture(opts: CrashCaptureOptions = {}): boolean {
  if (installed) return false
  installed = true

  const log = opts.log ?? logger
  const exit = opts.exit ?? ((code: number) => process.exit(code))

  const context = (): Record<string, unknown> => {
    if (!opts.getContext) return {}
    try {
      return opts.getContext()
    } catch (err) {
      return { contextError: (err as Error)?.message ?? String(err) }
    }
  }

  const logFatal = (kind: string, value: unknown, extra: Record<string, unknown> = {}): void => {
    // Guard against a crash inside the crash handler looping forever.
    if (fatalDepth > 1) return
    fatalDepth += 1
    try {
      log.fatal(
        { kind, err: describe(value), ...extra, ...context() },
        `Fatal ${kind} — process will exit`
      )
    } catch (err) {
      // Last resort: pino itself is broken, write raw to stderr.
      try {
        process.stderr.write(
          `crashCapture: logger failed (${String(err)}) while reporting ${kind}: ${String(value)}\n`
        )
      } catch {
        // Nothing further is possible.
      }
    } finally {
      flushLogsSync(log)
      fatalDepth -= 1
    }
  }

  process.on('uncaughtException', (err, origin) => {
    logFatal('uncaughtException', err, { origin })
    exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    logFatal('unhandledRejection', reason)
    exit(1)
  })

  process.on('exit', (code) => {
    const line = { code, uptimeSec: Math.round(process.uptime()) }
    if (code === 0) {
      log.info(line, 'Process exit')
    } else {
      log.error(line, 'Process exit')
    }
    // pino's own exit flush already ran (registered earlier); flush the line above too.
    flushLogsSync(log)
  })

  return true
}

export function isCrashCaptureInstalled(): boolean {
  return installed
}

export function resetCrashCaptureForTests(): void {
  installed = false
  fatalDepth = 0
}
