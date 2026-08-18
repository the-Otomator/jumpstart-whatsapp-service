import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { generateDeviceWebhookBackfill } from './backfill-device-webhooks'

function writeMeta(root: string, sessionKey: string, meta: Record<string, unknown>): void {
  const dir = path.join(root, sessionKey)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
}

function main(): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-device-webhook-backfill-'))
  try {
    writeMeta(tmp, 'usable-device', {
      orgId: 'usable-device',
      webhookUrl: 'https://tenant.example.test/wa-incoming?secret=fixture',
    })
    writeMeta(tmp, 'invalid-device', {
      orgId: 'invalid-device',
      webhookUrl: 'ftp://tenant.example.test/nope',
    })
    fs.mkdirSync(path.join(tmp, 'missing-device'))

    const result = generateDeviceWebhookBackfill(tmp, 4)
    assert.strictEqual(result.usableCount, 1)
    assert.strictEqual(result.unusableCount, 2)
    assert.strictEqual(result.unaccountedDeviceCount, 1)
    assert.ok(result.sql.includes('set webhook_url = $1'))
    assert.ok(result.sql.includes('where session_key = $2'))
    assert.ok(result.sql.includes("execute set_whatsapp_device_webhook('https://tenant.example.test/wa-incoming?secret=fixture', 'usable-device');"))
    assert.ok(!result.sql.includes('invalid-device'))
    console.log('backfill-device-webhooks.test.ts: all checks passed')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main()
