import { test } from 'node:test'
import assert from 'node:assert/strict'
import { githubOutcome, reconcile } from './reconcile-release-prs.mjs'
const sha = 'a'.repeat(40)
test('merged, closed and real 404 have distinct outcomes', () => {
  assert.deepEqual(githubOutcome(200, { state: 'closed', merged_at: '2026-10-07T22:37:39Z', merge_commit_sha: sha }), { state: 'merged', merged_at: '2026-10-07T22:37:39Z', merge_sha: sha })
  assert.deepEqual(githubOutcome(200, { state: 'closed', merged_at: null, merge_commit_sha: sha }), { state: 'closed', merged_at: null, merge_sha: null })
  assert.equal(githubOutcome(404, null).state, 'gone')
  assert.equal(githubOutcome(200, { state: 'open' }), null)
})
test('permission, rate limit, upstream and malformed evidence never become gone', () => {
  for (const status of [401, 403, 429, 500, 503]) assert.throws(() => githubOutcome(status, {}))
  assert.throws(() => githubOutcome(200, { state: 'closed', merged_at: 'bad', merge_commit_sha: sha }))
  assert.throws(() => githubOutcome(200, { state: 'closed', merged_at: '2026-10-07T22:37:39Z', merge_commit_sha: null }))
})
test('sync uses the snapshot timestamp, sends all outcomes and skips reopened PRs', async () => {
  const bodies = []
  const lookup = (_repo, n) => n === 4 ? null : githubOutcome(n === 3 ? 404 : 200, { state: 'closed', merged_at: n === 1 ? '2026-10-07T22:37:39Z' : null, merge_commit_sha: sha })
  const count = await reconcile({ ok: true, synced_at: 'snapshot', unresolved_numbers: [1, 2, 3, 4] }, { repo: 'fixture/repo', opsUrl: 'fixture', secret: 'fixture' }, lookup,
    async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, updated: true }) } })
  assert.equal(count, 3)
  assert.deepEqual(bodies.map(b => b.state), ['merged', 'closed', 'gone'])
  assert.ok(bodies.every(b => b.synced_at === 'snapshot' && b.action === 'sync_closed'))
})
test('lookup errors and API write failures stop reconciliation', async () => {
  const args = [{ ok: true, unresolved_numbers: [1] }, { repo: 'fixture' }]
  await assert.rejects(reconcile(...args, () => { throw new Error('403') }), /403/)
  await assert.rejects(reconcile(...args, () => githubOutcome(404, null), async () => ({ ok: false, json: async () => ({ error: 'denied' }) })), /denied/)
})
