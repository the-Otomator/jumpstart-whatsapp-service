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
  const originalGetStatus = sessionManager.getStatus
  const originalStartSession = sessionManager.startSession
  const originalStopSession = sessionManager.stopSession
  const originalValidateOrg = supabase.validateOrg
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-connect-route-'))
  const startCalls: StartCall[] = []
  const stopCalls: string[] = []
  const statuses = new Map<string, unknown>()
  const deviceWebhookUrls = new Map<string, string | null>()
  const deviceWebhookSecrets = new Map<string, string | null>()
  let server: Server | undefined

  try {
    process.chdir(tmp)
    ;(sessionManager as any).getStatus = (orgId: string) => statuses.get(orgId)
    ;(sessionManager as any).startSession = async (orgId: string, webhookUrl?: string) => {
      startCalls.push({ orgId, webhookUrl })
    }
    ;(sessionManager as any).stopSession = (orgId: string) => {
      stopCalls.push(orgId)
    }
    ;(supabase as any).validateOrg = async (orgId: string) => ({
      valid: true,
      deviceWebhookUrl: deviceWebhookUrls.get(orgId) ?? null,
      deviceWebhookSecret: deviceWebhookSecrets.get(orgId) ?? null,
    })

    const app = express()
    app.use('/connect', connectRouter)
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
    })
    const address = server.address()
    assert(address && typeof address !== 'string', 'test server did not expose a TCP port')
    const baseUrl = `http://127.0.0.1:${address.port}/connect`

    const orgWithDbAndMeta = 'org-with-db-and-meta-webhook'
    const dbWebhookUrl = 'https://registry.example.test/functions/v1/wa-incoming'
    const staleMetaWebhookUrl = 'https://legacy.example.test/old-hook'
    deviceWebhookUrls.set(orgWithDbAndMeta, dbWebhookUrl)
    const sessionDir = path.join(tmp, 'sessions', orgWithDbAndMeta)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
      orgId: orgWithDbAndMeta,
      webhookUrl: staleMetaWebhookUrl,
      createdAt: new Date().toISOString(),
      autoRestore: true,
    }))

    const startedResponse = await fetch(`${baseUrl}/${orgWithDbAndMeta}`)
    const startedBody = await startedResponse.text()
    assert.strictEqual(startedResponse.status, 200)
    assert.ok(startedBody.includes('<!-- connect-v3 -->'), 'connect marker must remain present')
    assert.deepStrictEqual(startCalls, [{ orgId: orgWithDbAndMeta, webhookUrl: dbWebhookUrl }])

    const orgWithMetaFallback = 'org-with-meta-fallback'
    const metaWebhookUrl = 'https://legacy.example.test/functions/v1/wa-incoming'
    const fallbackSessionDir = path.join(tmp, 'sessions', orgWithMetaFallback)
    fs.mkdirSync(fallbackSessionDir, { recursive: true })
    fs.writeFileSync(path.join(fallbackSessionDir, 'meta.json'), JSON.stringify({
      orgId: orgWithMetaFallback,
      webhookUrl: metaWebhookUrl,
      createdAt: new Date().toISOString(),
      autoRestore: true,
    }))
    deviceWebhookUrls.set(orgWithMetaFallback, null)
    const fallbackResponse = await fetch(`${baseUrl}/${orgWithMetaFallback}`)
    assert.strictEqual(fallbackResponse.status, 200)
    assert.deepStrictEqual(startCalls[1], { orgId: orgWithMetaFallback, webhookUrl: metaWebhookUrl })

    const orgWithoutWebhook = 'org-without-webhook'
    deviceWebhookSecrets.set(orgWithoutWebhook, 'orphaned-secret-value')
    const missingResponse = await fetch(`${baseUrl}/${orgWithoutWebhook}`)
    const missingBody = await missingResponse.text()
    assert.strictEqual(missingResponse.status, 503)
    assert.ok(missingBody.includes('לא ניתן להתחיל חיבור מכאן'))
    assert.ok(missingBody.includes('<!-- connect-v3 -->'), 'error page must retain connect marker')
    assert.strictEqual(startCalls.length, 2, 'missing webhookUrl must not create a session')

    const disconnectedOrg = 'org-disconnected-without-webhook'
    statuses.set(disconnectedOrg, { orgId: disconnectedOrg, status: 'disconnected' })
    const disconnectedResponse = await fetch(`${baseUrl}/${disconnectedOrg}`)
    assert.strictEqual(disconnectedResponse.status, 503)
    assert.strictEqual(startCalls.length, 2, 'disconnected session without webhookUrl must not restart')
    assert.deepStrictEqual(stopCalls, [], 'disconnected session must not be purged before webhook resolution')

    console.log('connect.test.ts: registry priority, disk fallback, and fail-closed checks passed')
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
    process.chdir(originalCwd)
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
