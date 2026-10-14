import { randomUUID } from 'crypto'
import { AuthCipher, Envelope } from './crypto'
import { PgHaStore, Lease, Claim, NodeIdentity, monotonic, makePool } from './store'
import { NodeFencer, HetznerFencer } from './providers'
import { CapacityCollector } from './metrics'
import { logger } from '../lib/logger'
export const CLUSTER_LEASE = '@wa-ha-active'
export const SELF_FENCE_MS = 15000
export const RENEW_MS = 5000
export type HaEvent = (event: string, fields?: Record<string, unknown>) => void
export class HaCoordinator {
  readonly leases = new Map<string, Lease>()
  private readonly connected = new Set<string>()
  markConnected(key: string, connected: boolean): void { if (connected) this.connected.add(key); else this.connected.delete(key) }
  private readonly closers = new Map<string, () => void>()
  private readonly transitions = new Map<string, Promise<unknown>>()
  private readonly metrics = new CapacityCollector()
  private timer?: ReturnType<typeof setInterval>
  private deadlineTimer?: ReturnType<typeof setInterval>
  private ticking = false
  private fencing = false
  private restoring = false
  private restored = false
  private halted = false
  private lastSample = 0
  private renewLatency = 0
  private onRestore?: () => Promise<void>
  identity?: NodeIdentity
  constructor(readonly store: PgHaStore, readonly cipher: AuthCipher, private readonly fencer: NodeFencer | undefined,
    private readonly heartbeat: (deadline: number) => void, private readonly event: HaEvent,
    private readonly notify?: (event: { code: string; nodeId?: string; target: string }) => Promise<void>) {}
  async start(restore: () => Promise<void>): Promise<void> {
    this.identity = await this.store.register()
    this.onRestore = restore
    await this.tick()
    this.timer = setInterval(() => { void this.tick() }, RENEW_MS)
    this.deadlineTimer = setInterval(() => {
      if ([...this.leases.values()].some(l => l.deadline <= monotonic())) this.fence('SELF_FENCED')
    }, 100)
  }
  isActive(): boolean {
    const lease = this.leases.get(CLUSTER_LEASE)
    return !this.halted && !!lease && lease.deadline > monotonic()
  }
  canServe(): boolean { return this.isActive() && this.restored }
  state(): string { return this.halted ? 'fenced' : this.canServe() ? 'active' : 'standby' }
  async transition<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.transitions.get(key) || Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.transitions.set(key, next)
    try { return await next } finally { if (this.transitions.get(key) === next) this.transitions.delete(key) }
  }
  private remember(key: string, result: Claim, started: number): Lease {
    if (!result.owned || !result.epoch || !Number.isFinite(result.remainingMs)) throw new Error('HA_INVALID_LEASE_RESPONSE')
    const lease = { key, epoch: result.epoch, deadline: started + Math.min(SELF_FENCE_MS, result.remainingMs! - 100) }
    if (lease.deadline <= monotonic()) throw new Error('HA_LEASE_RESPONSE_TOO_LATE')
    this.leases.set(key, lease)
    this.event('lease_acquired', { key, epoch: lease.epoch, nodeId: this.identity?.nodeId })
    return lease
  }
  private async tick(): Promise<void> {
    if (this.ticking || this.halted) return
    this.ticking = true
    const started = monotonic()
    try {
      // Also validates registration/disabled state on standby (no local-only health).
      await this.store.alive()
      for (const lease of this.leases.values()) {
        const renewalStarted = monotonic()
        await this.store.renew(lease)
        lease.deadline = renewalStarted + SELF_FENCE_MS
        this.renewLatency = Math.max(this.renewLatency, monotonic() - renewalStarted)
      }
      if (!this.leases.has(CLUSTER_LEASE)) {
        const acquiredAt = monotonic()
        const claim = await this.store.claim(CLUSTER_LEASE)
        if (claim.owned) this.remember(CLUSTER_LEASE, claim, acquiredAt)
        else if (claim.expired && claim.owner && claim.boot && !this.fencing) void this.takeover(claim.owner, claim.boot)
      }
      if (monotonic() - started >= SELF_FENCE_MS) throw new Error('HA_RENEWAL_DEADLINE')
      const deadline = Math.min(started + SELF_FENCE_MS, ...[...this.leases.values()].map(l => l.deadline))
      this.heartbeat(deadline)
      if (this.isActive() && !this.restored && !this.restoring) {
        this.restoring = true
        void this.onRestore!().then(() => {
          if (!this.halted) { this.restored = true; this.event('node_ready', { nodeId: this.identity?.nodeId }) }
        }).catch(() => this.fence('RESTORE_FAILED')).finally(() => { this.restoring = false })
      }
      if (monotonic() - this.lastSample > 15000) {
        const owned = [...this.leases.keys()].filter(k => k !== CLUSTER_LEASE).length
        const sample = await this.metrics.sample(owned, this.connected.size, this.renewLatency)
        await this.store.sample(sample)
        this.event('capacity_sample', { nodeId: this.identity?.nodeId, ...sample })
        this.lastSample = monotonic(); this.renewLatency = 0
      }
    } catch { this.fence('SELF_FENCED') }
    finally { this.ticking = false }
  }
  private async takeover(owner: string, boot: string): Promise<void> {
    this.fencing = true
    try {
      if (!this.fencer || !this.identity?.fencingEnabled) throw new Error('HA_FENCING_NOT_ACTIVATED')
      const plan = await this.store.beginFence(owner, boot)
      const evidence = await this.fencer.powerOffAndConfirm(plan)
      await this.store.confirmFence(plan, evidence)
      this.event('power_off_confirmed', { target: owner, boot })
      // Next regular tick performs the atomic claim; no socket before this point.
    } catch { await this.alert('FENCE_UNCONFIRMED', owner) }
    finally { this.fencing = false }
  }
  private async alert(code: string, target = ''): Promise<void> {
    this.event(code, { nodeId: this.identity?.nodeId, target })
    await this.store.alert(code, target).catch(() => undefined)
    await this.notify?.({ code, nodeId: this.identity?.nodeId, target }).catch(() => { this.event('operator_notification_failed') })
  }
  fence(code = 'SELF_FENCED'): void {
    if (this.halted) return
    this.halted = true; this.restored = false
    if (this.timer) clearInterval(this.timer)
    for (const close of this.closers.values()) { try { close() } catch { /* watchdog kills the process independently */ } }
    this.closers.clear(); this.connected.clear()
    void this.alert(code)
    // Do not release/erase leases: takeover still requires confirmed power-off.
    // Stop heartbeat; the independent supervisor kills this process <=15s.
  }
  async acquireSession(key: string): Promise<Lease> {
    if (key === CLUSTER_LEASE || !this.isActive()) throw new Error('HA_NOT_ACTIVE')
    const existing = this.leases.get(key)
    if (existing && existing.deadline > monotonic()) return existing
    const started = monotonic(), claim = await this.store.claim(key)
    if (!claim.owned) throw new Error('HA_SESSION_OWNED_ELSEWHERE_OR_UNFENCED')
    return this.remember(key, claim, started)
  }
  lease(key: string): Lease {
    const token = this.leases.get(key)
    if (!this.isActive() || !token || token.deadline <= monotonic()) { this.fence(); throw new Error('HA_STALE_LEASE') }
    return token
  }
  async readAuth(key: string, items: string[]): Promise<Record<string, string>> {
    try {
      const records = await this.store.read(this.lease(key), items)
      return Object.fromEntries(Object.entries(records).map(([item, value]) => [item, this.cipher.open(key, item, value)]))
    } catch { this.fence(); throw new Error('HA_AUTH_READ_FAILED') }
  }
  async writeAuth(key: string, values: Record<string, string | null>): Promise<void> {
    try {
      const encrypted = Object.fromEntries(Object.entries(values).map(([item, value]) => [item, value === null ? null : this.cipher.seal(key, item, value)]))
      await this.store.write(this.lease(key), encrypted)
    } catch { this.fence(); throw new Error('HA_AUTH_WRITE_FAILED') }
  }
  async saveMeta(key: string, meta: unknown, restore = true, purge = false): Promise<void> {
    try { await this.store.catalog(this.lease(key), this.cipher.seal(key, '@meta', JSON.stringify(meta)), restore, purge) }
    catch { this.fence(); throw new Error('HA_CATALOG_WRITE_FAILED') }
  }
  async catalog(restoreOnly = true): Promise<Array<{ key: string; meta: { webhookUrl: string; [key: string]: unknown } }>> {
    if (!this.isActive()) return []
    try { return (await this.store.list()).filter(entry => !restoreOnly || entry.restore).map(entry => ({ key: entry.key, meta: JSON.parse(this.cipher.open(entry.key, '@meta', entry.meta)) })) }
    catch { this.fence(); throw new Error('HA_CATALOG_READ_FAILED') }
  }
  async closeSocket(key: string, raw: any): Promise<void> {
    const ws = raw.ws?.socket || raw.ws
    raw.end(undefined)
    if (ws?.terminate) ws.terminate()
    const until = monotonic() + 3000
    while (ws?.readyState !== 3) {
      if (monotonic() >= until) { this.fence(); throw new Error('HA_SOCKET_CLOSE_UNCONFIRMED') }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    this.closers.delete(key); this.connected.delete(key)
  }
  protectSocket<T extends object>(key: string, raw: T, close: () => void): T {
    const lease = this.lease(key)
    this.closers.set(key, close)
    return new Proxy(raw, { get: (target, property) => {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function' || property === 'end') return value
      return (...args: unknown[]) => {
        this.lease(key)
        return this.store.runFenced(lease, () => Promise.resolve(value.apply(target, args)), () => this.fence()).then(result => {
          if (property === 'sendMessage') this.metrics.sent()
          return result
        })
      }
    } })
  }
  async shutdown(): Promise<void> {
    this.fence()
    if (this.deadlineTimer) clearInterval(this.deadlineTimer)
    await this.store.close()
  }
}
let runtime: HaCoordinator | undefined
export function getHaRuntime(): HaCoordinator | undefined {
  if (process.env.WA_HA_ENABLED !== 'true') return undefined
  if (runtime) return runtime
  if (!process.send || process.env.WA_HA_SUPERVISED !== '1') throw new Error('HA_INDEPENDENT_SUPERVISOR_REQUIRED')
  const boot = randomUUID(), url = process.env.WA_HA_DATABASE_URL
  const keys = process.env.WA_HA_KEYRING_JSON, kid = process.env.WA_HA_CURRENT_KID
  if (!url || !keys || !kid) throw new Error('HA_CONFIGURATION_INCOMPLETE')
  const local = process.env.WA_HA_LOCAL_TEST === '1'
  const pool = makePool(url, local, process.env.WA_HA_CA_FILE)
  const fencePool = process.env.WA_HA_FENCER_DATABASE_URL ? makePool(process.env.WA_HA_FENCER_DATABASE_URL, local, process.env.WA_HA_CA_FILE) : undefined
  const fencer = process.env.WA_HA_HETZNER_TOKEN ? new HetznerFencer(process.env.WA_HA_HETZNER_TOKEN) : undefined
  const webhook = process.env.WA_HA_OPERATOR_ALERT_URL
  if (!webhook || new URL(webhook).protocol !== 'https:') throw new Error('HA_OPERATOR_ALERT_HTTPS_REQUIRED')
  runtime = new HaCoordinator(new PgHaStore(pool, boot, fencePool), new AuthCipher(kid, JSON.parse(keys)), fencer,
    deadline => { process.send!({ type: 'ha-heartbeat', deadline }) },
    (event, fields = {}) => { logger.info({ event, ...fields }, 'HA lifecycle') },
    async event => { const result = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(process.env.WA_HA_OPERATOR_ALERT_TOKEN ? { Authorization: 'Bearer ' + process.env.WA_HA_OPERATOR_ALERT_TOKEN } : {}) },
      body: JSON.stringify(event), signal: AbortSignal.timeout(3000) }); if (!result.ok) throw new Error('HA_NOTIFICATION_REJECTED') })
  return runtime
}
