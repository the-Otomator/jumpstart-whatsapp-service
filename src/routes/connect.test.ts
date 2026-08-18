import assert from 'assert'
import express from 'express'
import fs from 'fs'
import type { Server } from 'http'
import os from 'os'
import path from 'path'
import connectRouter from './connect'
import * as sessionManager from '../sessionManager'
import * as supabase from '../lib/supabase'

type StartCall = { orgId: string; webhookUrl?: string }

async function main(): Promise<void> {
  const originalCwd = process.cwd()
  const originalDefaultWebhookUrl = process.env.DEFAULT_WEBHOOK_URL
  const originalGetStatus = sessionManager.getStatus
  const originalStartSession = sessionManager.startSession
  const originalStopSession = sessionManager.stopSession
  const originalValidateOrg = supabase.validateOrg
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-connect-route-'))
  const startCalls: StartCall[] = []
  const stopCalls: string[] = []
  const statuses = new Map<string, unknown>()
  let server: Server | undefined

  try {
    process.chdir(tmp)
    delete process.env.DEFAULT_WEBHOOK_URL
    ;(sessionManager as any).getStatus = (orgId: string) => statuses.get(orgId)
    ;(sessionManager as any).startSession = async (orgId: string, webhookUrl?: string) => {
      startCalls.push({ orgId, webhookUrl })
    }
    ;(sessionManager as any).stopSession = (orgId: string) => {
      stopCalls.push(orgId)
    }
    ;(supabase as any).validateOrg = async () => ({ valid: true })

    const app = express()
    app.use('/connect', connectRouter)
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    const address = server.address()
    assert(address && typeof address !== 'string', 'test server did not expose a TCP port')
    const baseUrl = `http://127.0.0.1:${address.port}/connect`

    const orgWithMeta = 'org-with-meta-webhook'
    const webhookUrl = 'https://example.test/functions/v1/wa-incoming?secret=test'
    const sessionDir = path.join(tmp, 'sessions', orgWithMeta)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
      orgId: orgWithMeta,
      webhookUrl,
      createdAt: new Date().toISOString(),
      autoRestore: true,
    }))

    const startedResponse = await fetch(`${baseUrl}/${orgWithMeta}`)
    const startedBody = await startedResponse.text()
    assert.strictEqual(startedResponse.status, 200)
    assert.ok(startedBody.includes('<!-- connect-v3 -->'), 'connect marker must remain present')
    assert.deepStrictEqual(startCalls, [{ orgId: orgWithMeta, webhookUrl }])

    const orgWithDefault = 'org-with-default-webhook'
    const defaultWebhookUrl = 'https://default.example.test/wa-incoming'
    process.env.DEFAULT_WEBHOOK_URL = defaultWebhookUrl
    const defaultResponse = await fetch(`${baseUrl}/${orgWithDefault}`)
    assert.strictEqual(defaultResponse.status, 200)
    assert.deepStrictEqual(startCalls[1], { orgId: orgWithDefault, webhookUrl: defaultWebhookUrl })

    const orgWithoutWebhook = 'org-without-webhook'
    process.env.DEFAULT_WEBHOOK_URL = 'not-a-valid-url'
    const missingResponse = await fetch(`${baseUrl}/${orgWithoutWebhook}`)
    const missingBody = await missingResponse.text()
    assert.strictEqual(missingResponse.status, 503)
    assert.ok(missingBody.includes('לא ניתן להתחיל חיבור מכאן'))
    assert.ok(missingBody.includes('<!-- connect-v3 -->'), 'error page must retain connect marker')
    assert.strictEqual(startCalls.length, 2, 'missing webhookUrl must not create a session')

    const disconnectedOrg = 'org-disconnected-without-webhook'
    statuses.set(disconnectedOrg, { orgId: disconnectedOrg, status: 'disconnected' })
    delete process.env.DEFAULT_WEBHOOK_URL
    const disconnectedResponse = await fetch(`${baseUrl}/${disconnectedOrg}`)
    assert.strictEqual(disconnectedResponse.status, 503)
    assert.strictEqual(startCalls.length, 2, 'disconnected session without webhookUrl must not restart')
    assert.deepStrictEqual(stopCalls, [], 'disconnected session must not be purged before webhook resolution')

    console.log('connect.test.ts: auto-start and missing-webhook checks passed')
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    process.chdir(originalCwd)
    if (originalDefaultWebhookUrl === undefined) delete process.env.DEFAULT_WEBHOOK_URL
    else process.env.DEFAULT_WEBHOOK_URL = originalDefaultWebhookUrl
    ;(sessionManager as any).getStatus = originalGetStatus
    ;(sessionManager as any).startSession = originalStartSession
    ;(sessionManager as any).stopSession = originalStopSession
    ;(supabase as any).validateOrg = originalValidateOrg
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
