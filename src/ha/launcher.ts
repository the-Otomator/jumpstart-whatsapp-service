import { fork, ChildProcess } from 'child_process'
import path from 'path'
import { monotonic, SELF_FENCE_MS } from './supervisorClock'
export function supervise(entry: string, args: string[] = [], timeoutMs = SELF_FENCE_MS, env: NodeJS.ProcessEnv = process.env): ChildProcess {
  if (timeoutMs <= 0 || timeoutMs > SELF_FENCE_MS) throw new Error('HA_WATCHDOG_DEADLINE_INVALID')
  const child = fork(entry, args, { env: { ...env, WA_HA_SUPERVISED: '1' }, stdio: ['inherit','inherit','inherit','ipc'] })
  let deadline = monotonic() + timeoutMs
  child.on('message', (message: unknown) => {
    const value = message as { type?: string; deadline?: number }
    if (value.type === 'ha-heartbeat' && Number.isFinite(value.deadline)) deadline = Math.min(value.deadline!, monotonic() + timeoutMs)
  })
  const watchdog = setInterval(() => {
    if (monotonic() >= deadline) {
      console.error(JSON.stringify({ event: 'HA_WATCHDOG_KILL', pid: child.pid }))
      child.kill('SIGKILL')
    }
  }, 100)
  child.on('exit', () => { clearInterval(watchdog) })
  process.once('SIGTERM', () => child.kill('SIGTERM'))
  process.once('SIGINT', () => child.kill('SIGTERM'))
  return child
}
if (require.main === module) {
  if (process.env.WA_HA_ENABLED === 'true') { const child = supervise(path.join(__dirname, '..', 'index.js')); child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) }) }
  else require('../index')
}
