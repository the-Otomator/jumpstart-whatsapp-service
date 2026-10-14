import { createHash } from 'crypto'
import { PgHaStore, FencePlan } from './store'
export interface NodeFencer { powerOffAndConfirm(plan: FencePlan): Promise<string> }
export interface ProvisionSpec { name: string; serverType: string; image: string; location: string; sshKeys: string[] }
export interface NodeProvisioner { provision(spec: ProvisionSpec, approvedActionId: string): Promise<{ resourceId: string }> }
export class HetznerFencer implements NodeFencer {
  constructor(private readonly token: string, private readonly request: typeof fetch = fetch) {}
  private async api(path: string, method = 'GET', body?: unknown): Promise<any> {
    let response: Response
    try { response = await this.request('https://api.hetzner.cloud/v1' + path, { method,
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) }) }
    catch { throw new Error('HA_PROVIDER_UNREACHABLE') }
    if (!response.ok) throw new Error('HA_PROVIDER_REQUEST_REJECTED')
    return response.json()
  }
  async powerOffAndConfirm(plan: FencePlan): Promise<string> {
    if (plan.provider !== 'hetzner' || !/^[1-9][0-9]*$/.test(plan.resourceId)) throw new Error('HA_PROVIDER_UNSUPPORTED')
    // Poweroff is destructive and MUST only be reached after DB begin_fence.
    const before = await this.api('/servers/' + plan.resourceId)
    if (before.server?.id?.toString() !== plan.resourceId) throw new Error('HA_PROVIDER_ID_MISMATCH')
    if (before.server.status !== 'off') await this.api('/servers/' + plan.resourceId + '/actions/poweroff', 'POST')
    const until = Date.now() + 20000
    do {
      const current = await this.api('/servers/' + plan.resourceId)
      if (current.server?.id?.toString() === plan.resourceId && current.server.status === 'off') return 'hetzner:server-off:' + plan.resourceId
      await new Promise(resolve => setTimeout(resolve, 500))
    } while (Date.now() < until)
    throw new Error('HA_POWER_OFF_UNCONFIRMED')
  }
}
export function approvalHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
export class HetznerProvisioner implements NodeProvisioner {
  constructor(private readonly approvalStore: PgHaStore, private readonly token: string, private readonly request: typeof fetch = fetch) {}
  async provision(spec: ProvisionSpec, approvedActionId: string): Promise<{ resourceId: string }> {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(spec.name) || !spec.serverType || !spec.image || !spec.location || !spec.sshKeys.length) throw new Error('HA_PROVISION_SPEC_INVALID')
    const normalized = { name: spec.name, serverType: spec.serverType, image: spec.image, location: spec.location, sshKeys: [...spec.sshKeys].sort() }
    await this.approvalStore.call('consume_approval', [approvedActionId, 'provision', spec.name, approvalHash(normalized)])
    // One attempt only. Unknown outcome must be reconciled by approved-action label
    // before issuing any replacement approval. Never auto-retry paid creation.
    let response: Response
    try { response = await this.request('https://api.hetzner.cloud/v1/servers', { method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: spec.name, server_type: spec.serverType, image: spec.image, location: spec.location,
        ssh_keys: normalized.sshKeys, start_after_create: false, labels: { 'wa-ha-approved-action': approvedActionId } }), signal: AbortSignal.timeout(10000) }) }
    catch { throw new Error('HA_PROVISION_OUTCOME_UNKNOWN_RECONCILE') }
    if (!response.ok) throw new Error('HA_PROVISION_REJECTED_APPROVAL_CONSUMED')
    const data = await response.json() as { server?: { id?: number } }
    if (!data.server?.id) throw new Error('HA_PROVISION_OUTCOME_UNKNOWN_RECONCILE')
    return { resourceId: String(data.server.id) }
  }
}
