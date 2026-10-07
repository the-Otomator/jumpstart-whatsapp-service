// Only GETs GitHub. Writes the outcome through the existing authenticated sync API.
// Never treats permission/rate-limit/server/network errors as a missing PR.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function githubOutcome(status, pr) {
  if (status === 404) return { state: 'gone', merged_at: null, merge_sha: null, http_status: 404 }
  if (status !== 200) throw new Error(`GitHub lookup failed: HTTP ${status}`)
  if (pr.state === 'open') return null // Reopened or absent because the open list was truncated.
  if (pr.state !== 'closed') throw new Error('Unexpected GitHub PR state')
  if (pr.merged_at) {
    if (!Number.isFinite(Date.parse(pr.merged_at)) || !/^[0-9a-f]{40}$/i.test(pr.merge_commit_sha ?? '')) throw new Error('Incomplete merge evidence')
    return { state: 'merged', merged_at: pr.merged_at, merge_sha: pr.merge_commit_sha }
  }
  return { state: 'closed', merged_at: null, merge_sha: null }
}

export function lookupPr(repo, number) {
  let output
  try { output = execFileSync('gh', ['api', '--include', `repos/${repo}/pulls/${number}`], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) {
    output = String(error.stdout ?? '')
    if (!/^HTTP\/\S+ 404\b/m.test(output)) throw new Error(`GitHub lookup failed for ${repo}#${number}: ${String(error.stderr ?? error.message)}`)
  }
  const status = Number(/^HTTP\/\S+ (\d+)/m.exec(output)?.[1])
  const body = output.split(/\r?\n\r?\n/).slice(1).join('\n\n')
  return githubOutcome(status, status === 404 ? null : JSON.parse(body))
}

export async function reconcile(result, { repo, opsUrl, secret }, lookup = lookupPr, send = fetch) {
  if (!result.ok || !Array.isArray(result.unresolved_numbers)) throw new Error('Invalid sync response')
  let updated = 0
  for (const number of result.unresolved_numbers) {
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid PR number')
    const outcome = lookup(repo, number)
    if (!outcome) continue
    const response = await send(opsUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-release-secret': secret },
      body: JSON.stringify({ action: 'sync_closed', repo, number, synced_at: result.synced_at, ...outcome }), signal: AbortSignal.timeout(30_000) })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(`Terminal sync failed for #${number}: ${body.error ?? response.status}`)
    if (body.updated) updated++
  }
  return updated
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const updated = await reconcile(JSON.parse(process.argv[2]), { repo: process.env.REPO, opsUrl: process.env.OPS_URL, secret: process.env.OPS_SECRET })
  console.log(`Reconciled ${updated} PR outcome(s).`)
}
