/**
 * M2: webhook integrity — fail-loud start/restore, no-restart PATCH.
 * Run: npx ts-node --transpile-only src/lib/webhookIntegrity.test.ts
 */
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
// Load providers barrel first so BaileysProvider finishes init before pool↔provider cycle.
import { getProvider } from '../providers'
import type { BaileysProvider } from '../providers/baileys/baileysProvider'
import {
  isValidWebhookUrl,
  requireWebhookUrl,
  redactWebhookUrl,
  WebhookUrlRequiredError,
  WEBHOOK_URL_REQUIRED,
} from './webhookUrl'
import type { Session } from '../types'

function getBaileys(): BaileysProvider {
  return getProvider('baileys') as BaileysProvider
}

function testValidator(): void {
  assert.strictEqual(isValidWebhookUrl(undefined), false)
  assert.strictEqual(isValidWebhookUrl(''), false)
  assert.strictEqual(isValidWebhookUrl('   '), false)
  assert.strictEqual(isValidWebhookUrl('not-a-url'), false)
  assert.strictEqual(isValidWebhookUrl('ftp://example.com/x'), false)
  assert.strictEqual(isValidWebhookUrl('https://example.com/hook'), true)
  assert.strictEqual(isValidWebhookUrl('http://example.com/hook'), true)

  assert.throws(() => requireWebhookUrl(undefined), WebhookUrlRequiredError)
  assert.throws(() => requireWebhookUrl(''), (e: Error) => {
    return e instanceof WebhookUrlRequiredError && e.code === WEBHOOK_URL_REQUIRED
  })

  const redacted = redactWebhookUrl('https://ex.test/wa-webhook?secret=abc123&x=1')
  assert.ok(redacted.includes('secret=***'))
  assert.ok(!redacted.includes('abc123'))
}

async function testStartRejectsMissingWebhook(): Promise<void> {
  const provider = getBaileys()
  await assert.rejects(
    () => provider.start('org-no-webhook'),
    (err: unknown) =>
      err instanceof WebhookUrlRequiredError && err.code === WEBHOOK_URL_REQUIRED
  )
  assert.strictEqual(provider.getSocket('org-no-webhook'), undefined)
  assert.strictEqual(provider.getStatus('org-no-webhook'), undefined)
}

async function testRestoreSkipsMissingWebhook(): Promise<void> {
  const prevCwd = process.cwd()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-webhook-integrity-'))
  process.chdir(tmp)

  try {
    const orgId = 'org-restore-no-webhook'
    const dir = path.join(tmp, 'sessions', orgId)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({
        orgId,
        provider: 'baileys',
        createdAt: new Date().toISOString(),
        autoRestore: true,
        // intentionally no webhookUrl
      }),
      'utf-8'
    )
    // creds.json so listStoredSessions includes this org
    fs.writeFileSync(path.join(dir, 'creds.json'), '{}', 'utf-8')

    const provider = getBaileys()
    await provider.restoreSessions()

    const session = provider.getStatus(orgId)
    assert.ok(session, 'restore must surface a session row so lastError is visible')
    assert.strictEqual(session.status, 'disconnected')
    assert.ok(
      session.lastError?.includes(WEBHOOK_URL_REQUIRED),
      `expected lastError containing ${WEBHOOK_URL_REQUIRED}, got ${session.lastError}`
    )
    assert.strictEqual(provider.getSocket(orgId), undefined, 'must not create a socket')
  } finally {
    process.chdir(prevCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function testPatchWebhookKeepsSocket(): Promise<void> {
  const provider = getBaileys()
  const orgId = 'org-patch-webhook'
  const sessions = (
    provider as unknown as { sessions: Map<string, Session> }
  ).sessions
  const sockets = (
    provider as unknown as { sockets: Map<string, object> }
  ).sockets

  const fakeSocket = { id: 'socket-identity-1' }
  sessions.set(orgId, {
    orgId,
    provider: 'baileys',
    status: 'connected',
    webhookUrl: 'https://example.test/old?secret=oldsecret',
  })
  sockets.set(orgId, fakeSocket)

  const before = provider.getSocket(orgId)
  const result = provider.updateWebhookUrl(
    orgId,
    'https://example.test/functions/v1/wa-webhook?secret=newsecret'
  )
  const after = provider.getSocket(orgId)

  assert.strictEqual(before, after, 'socket instance must be identical (no reconnect)')
  assert.strictEqual(before, fakeSocket)
  assert.strictEqual(
    sessions.get(orgId)?.webhookUrl,
    'https://example.test/functions/v1/wa-webhook?secret=newsecret'
  )
  assert.ok(result.previous?.includes('old'))
  assert.ok(result.next.includes('newsecret'))
}

async function main(): Promise<void> {
  testValidator()
  await testStartRejectsMissingWebhook()
  await testRestoreSkipsMissingWebhook()
  await testPatchWebhookKeepsSocket()
  console.log('webhookIntegrity.test.ts: all checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
