import { Pool, PoolClient } from 'pg'
import { readFileSync } from 'fs'
import { Envelope } from './crypto'
export interface Lease { key: string; epoch: string; deadline: number }
export interface Claim { owned: boolean; epoch?: string; remainingMs?: number; owner?: string; boot?: string; expired?: boolean }
export interface NodeIdentity { nodeId: string; fencingEnabled: boolean; capacity: number }
export interface FencePlan { nodeId: string; provider: string; resourceId: string; boot: string }
export interface CatalogEntry { key: string; meta: Envelope; restore: boolean }
export interface CapacitySample { cpuPercent: number; ramPercent: number; diskPercent: number; owned: number; connected: number; messagesPerMinute: number; renewLatencyMs: number }
export function monotonic(): number { return Number(process.hrtime.bigint() / 1000000n) }
export function makePool(url: string, localTest = false, caFile?: string): Pool {
  const parsed = new URL(url)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('HA_DB_URL_INVALID')
  if ([...parsed.searchParams.keys()].some(k => /^ssl/i.test(k))) throw new Error('HA_DB_SSL_OPTIONS_MUST_BE_SEPARATE')
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  const pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 3000,
    query_timeout: 4000, options: '-c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000',
    ssl: localTest && loopback ? false : { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) } })
  // Never emit connection strings/passwords through error logs.
  pool.on('error', () => { /* subsequent guarded operations fail closed */ })
  return pool
}
export class PgHaStore {
  private readonly sends = new Map<string, Promise<unknown>>()
  constructor(readonly pool: Pool, readonly boot: string, readonly fencePool?: Pool) {}
  async call<T>(name: string, args: unknown[], pool = this.pool): Promise<T> {
    if (!/^[a-z_]+$/.test(name)) throw new Error('HA_QUERY_NAME_INVALID')
    const marks = args.map((_, i) => '$' + (i + 1)).join(',')
    const result = await pool.query('select wa_ha.' + name + '(' + marks + ') as value', args)
    return result.rows[0].value as T
  }
  alive(): Promise<void> { return this.call('node_alive', [this.boot]) }
  register(): Promise<NodeIdentity> { return this.call('register_node', [this.boot]) }
  claim(key: string): Promise<Claim> { return this.call('try_acquire', [key, this.boot]) }
  renew(lease: Lease): Promise<void> { return this.call('renew', [lease.key, this.boot, lease.epoch]) }
  read(lease: Lease, items: string[]): Promise<Record<string, Envelope>> { return this.call('read_auth', [lease.key, this.boot, lease.epoch, items]) }
  write(lease: Lease, entries: Record<string, Envelope | null>): Promise<void> { return this.call('write_auth', [lease.key, this.boot, lease.epoch, JSON.stringify(entries)]) }
  catalog(lease: Lease, meta: Envelope, restore: boolean, purge = false): Promise<void> { return this.call('put_catalog', [lease.key, this.boot, lease.epoch, JSON.stringify(meta), restore, purge]) }
  list(): Promise<CatalogEntry[]> { return this.call('list_catalog', [this.boot]) }
  sample(metrics: CapacitySample): Promise<void> { return this.call('record_sample', [this.boot, JSON.stringify(metrics)]) }
  alert(code: string, target = ''): Promise<void> { return this.call('raise_alert', [this.boot, code, target]) }
  async beginFence(target: string, boot: string): Promise<FencePlan> {
    if (!this.fencePool) throw new Error('HA_FENCER_NOT_CONFIGURED')
    return this.call('begin_fence', [this.boot, target, boot], this.fencePool)
  }
  async confirmFence(plan: FencePlan, evidence: string): Promise<void> {
    if (!this.fencePool) throw new Error('HA_FENCER_NOT_CONFIGURED')
    return this.call('confirm_fence', [this.boot, plan.nodeId, plan.boot, plan.resourceId, evidence], this.fencePool)
  }
  // Hold a transaction advisory permit through the external send. Claims share
  // this lock; independent ratchet/auth transactions must commit before transmit.
  async runFenced<T>(lease: Lease, operation: () => Promise<T>, onFence: () => void): Promise<T> {
    const previous = this.sends.get(lease.key) || Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.sendWithPermit(lease, operation, onFence))
    this.sends.set(lease.key, next)
    try { return await next } finally { if (this.sends.get(lease.key) === next) this.sends.delete(lease.key) }
  }
  private async sendWithPermit<T>(lease: Lease, operation: () => Promise<T>, onFence: () => void): Promise<T> {
    let client: PoolClient | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let permit = false, committing = false
    try {
      client = await this.pool.connect()
      await client.query('BEGIN')
      await client.query('select wa_ha.check_send($1,$2,$3)', [lease.key, this.boot, lease.epoch])
      if (lease.deadline <= monotonic()) throw new Error('HA_LOCAL_DEADLINE')
      permit = true
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { onFence(); reject(new Error('HA_SEND_DEADLINE')) }, 10000) })
      const result = await Promise.race([operation(), timeout])
      committing = true
      await client.query('COMMIT')
      return result
    } catch (err) {
      if (!permit || committing || (err as Error).message === 'HA_SEND_DEADLINE') onFence()
      if (client) await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally { if (timer) clearTimeout(timer); client?.release() }
  }
  async close(): Promise<void> { await this.pool.end(); await this.fencePool?.end() }
}
