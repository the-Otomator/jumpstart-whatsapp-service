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
  const migrationSql = fs.readFileSync(
    path.resolve(__dirname, '..', 'migrations', '20260818_wa_device_webhook_url.sql'),
    'utf8'
  )
  const protectedChangeIndex = migrationSql.indexOf("if tg_op = 'INSERT' then")
  const postgresBypassIndex = migrationSql.indexOf("if session_user = 'postgres' or session_user = table_owner then")
  const denialIndex = migrationSql.indexOf("errcode = '42501'")

  assert.ok(migrationSql.includes('security definer'))
  assert.ok(migrationSql.includes('before insert or update on public.whatsapp_devices'))
  assert.ok(migrationSql.includes('new.webhook_url is not distinct from old.webhook_url'))
  assert.ok(migrationSql.includes('from public.admin_users'))
  assert.ok(migrationSql.includes('pg_catalog.lower(email) = pg_catalog.lower(auth.email())'))
  assert.ok(migrationSql.includes('grant select, insert, update on public.whatsapp_devices to service_role'))
  assert.ok(migrationSql.includes('revoke execute on function public.whatsapp_devices_guard_webhook_url() from anon'))
  assert.ok(!migrationSql.includes('information_schema.columns'))
  assert.ok(protectedChangeIndex >= 0)
  assert.ok(postgresBypassIndex > protectedChangeIndex)
  assert.ok(denialIndex > postgresBypassIndex)

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
    // The generated backfill changes webhook_url, while the trigger returns NEW for
    // a postgres session before its denial branch. This guards the apply-time path
    // without connecting to or mutating a database in this unit test.
    assert.ok(result.sql.includes('update public.whatsapp_devices'))
    assert.ok(result.sql.includes("execute set_whatsapp_device_webhook('https://tenant.example.test/wa-incoming?secret=fixture', 'usable-device');"))
    assert.ok(!result.sql.includes('invalid-device'))
    console.log('backfill-device-webhooks.test.ts: all checks passed')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main()
