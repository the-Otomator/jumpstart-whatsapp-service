/**
 * Crash capture checks (no test runner required).
 * Run: npx ts-node --transpile-only src/lib/crashCapture.test.ts
 *
 * The interesting assertions can only be made in a real process, so the parent run
 * re-spawns this same file with a `child:*` argv and inspects the child's stdout and
 * exit status. Children run with NODE_ENV=production so they exercise the exact pino
 * configuration prod uses (SonicBoom, sync: false) — the one that loses buffered lines.
 */
import { spawnSync } from 'child_process'
import pino from 'pino'
import { installCrashCapture, flushLogsSync, resetCrashCaptureForTests } from './crashCapture'

type ChildResult = { status: number | null; stdout: string; stderr: string }

function runChild(mode: string): ChildResult {
  const res = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', __filename, mode],
    {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', TS_NODE_TRANSPILE_ONLY: '1' },
    }
  )
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function assert(cond: boolean, label: string, detail?: string): void {
  if (!cond) throw new Error(`${label}${detail ? `\n  ${detail}` : ''}`)
}

function findLog(stdout: string, predicate: (o: Record<string, any>) => boolean) {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const obj = JSON.parse(trimmed)
      if (predicate(obj)) return obj
    } catch {
      // Not a log line.
    }
  }
  return null
}

// ---------------------------------------------------------------- child modes

function child(mode: string): void {
  installCrashCapture({ getContext: () => ({ sessions: 2, connected: 1 }) })

  if (mode === 'child:uncaught') {
    // setTimeout so the throw is not caught by any surrounding try/catch.
    setTimeout(() => {
      throw new Error('boom-uncaught')
    }, 0)
    return
  }

  if (mode === 'child:rejection') {
    void Promise.reject(new Error('boom-rejection'))
    return
  }

  if (mode === 'child:nonerror-rejection') {
    void Promise.reject('boom-string-reason')
    return
  }

  if (mode === 'child:cleanexit') {
    process.exit(0)
  }

  throw new Error(`unknown child mode: ${mode}`)
}

// --------------------------------------------------------------- parent tests

function testUncaughtException(): void {
  const r = runChild('child:uncaught')
  assert(r.status === 1, 'uncaughtException: expected exit 1', `got ${r.status}`)

  const fatal = findLog(r.stdout, (o) => o.level === 'fatal' && o.kind === 'uncaughtException')
  assert(!!fatal, 'uncaughtException: no fatal log line found', r.stdout.slice(0, 800))
  assert(fatal.err?.message === 'boom-uncaught', 'uncaughtException: wrong message', JSON.stringify(fatal.err))
  assert(
    typeof fatal.err?.stack === 'string' && fatal.err.stack.includes('crashCapture.test.ts'),
    'uncaughtException: stack missing or not full',
    JSON.stringify(fatal.err?.stack)
  )
  assert(fatal.origin === 'uncaughtException', 'uncaughtException: origin not recorded')
  assert(fatal.sessions === 2 && fatal.connected === 1, 'uncaughtException: context not attached')

  // The exit line is written from our own 'exit' handler, which runs AFTER pino's own
  // on-exit flush. It only reaches stdout because the handler flushes synchronously —
  // this assertion is the flush verification, not an assumption about pino internals.
  const exitLine = findLog(r.stdout, (o) => o.msg === 'Process exit')
  assert(!!exitLine, 'uncaughtException: no "Process exit" line — flush before exit failed', r.stdout.slice(0, 800))
  assert(exitLine.code === 1, 'uncaughtException: exit line reports wrong code', String(exitLine.code))
  assert(exitLine.level === 'error', 'uncaughtException: non-zero exit should log at error')
}

function testUnhandledRejection(): void {
  const r = runChild('child:rejection')
  assert(r.status === 1, 'unhandledRejection: expected exit 1', `got ${r.status}`)

  const fatal = findLog(r.stdout, (o) => o.level === 'fatal' && o.kind === 'unhandledRejection')
  assert(!!fatal, 'unhandledRejection: no fatal log line found', r.stdout.slice(0, 800))
  assert(fatal.err?.message === 'boom-rejection', 'unhandledRejection: wrong message')
  assert(
    typeof fatal.err?.stack === 'string' && fatal.err.stack.length > 0,
    'unhandledRejection: stack missing'
  )

  const exitLine = findLog(r.stdout, (o) => o.msg === 'Process exit')
  assert(!!exitLine && exitLine.code === 1, 'unhandledRejection: exit line missing or wrong code')
}

function testNonErrorRejection(): void {
  const r = runChild('child:nonerror-rejection')
  assert(r.status === 1, 'non-Error rejection: expected exit 1', `got ${r.status}`)

  const fatal = findLog(r.stdout, (o) => o.level === 'fatal' && o.kind === 'unhandledRejection')
  assert(!!fatal, 'non-Error rejection: no fatal log line found')
  assert(
    String(fatal.err?.message).includes('boom-string-reason'),
    'non-Error rejection: reason not serialised',
    JSON.stringify(fatal.err)
  )
}

function testCleanExitStillAttributed(): void {
  const r = runChild('child:cleanexit')
  assert(r.status === 0, 'clean exit: expected exit 0', `got ${r.status}`)

  const exitLine = findLog(r.stdout, (o) => o.msg === 'Process exit')
  assert(!!exitLine, 'clean exit: no "Process exit" line', r.stdout.slice(0, 800))
  assert(exitLine.code === 0 && exitLine.level === 'info', 'clean exit: wrong code/level')
  assert(
    !findLog(r.stdout, (o) => o.level === 'fatal'),
    'clean exit: unexpected fatal line'
  )
}

function testFlushIsNotANoop(): void {
  // Same shape as prod: no transport, so pino resolves to SonicBoom sync:false.
  const stream = (pino({ level: 'info' }) as any)[pino.symbols.streamSym]
  assert(
    stream && typeof stream.flushSync === 'function',
    'flush: pino destination has no flushSync — flushLogsSync would degrade silently'
  )
  assert(stream.sync === false, 'flush: expected an async destination in this pino version')

  const mechanism = flushLogsSync(pino({ level: 'info' }))
  assert(mechanism === 'flushSync', 'flush: expected synchronous flush, got ' + mechanism)
}

function testInstallIsIdempotent(): void {
  resetCrashCaptureForTests()
  const before = process.listenerCount('uncaughtException')
  assert(installCrashCapture({ exit: () => {} }) === true, 'install: first call should install')
  const afterFirst = process.listenerCount('uncaughtException')
  assert(afterFirst > before, 'install: first call registered no uncaughtException listener')

  assert(installCrashCapture({ exit: () => {} }) === false, 'install: second call should be a no-op')
  assert(
    process.listenerCount('uncaughtException') === afterFirst,
    'install: second call registered a duplicate uncaughtException listener'
  )
}

function main(): void {
  const mode = process.argv[2]
  if (mode?.startsWith('child:')) {
    child(mode)
    return
  }

  testFlushIsNotANoop()
  testInstallIsIdempotent()
  testUncaughtException()
  testUnhandledRejection()
  testNonErrorRejection()
  testCleanExitStillAttributed()

  console.log('crashCapture.test.ts: all checks passed')
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
