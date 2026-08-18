import fs from 'fs'
import path from 'path'
import { isValidWebhookUrl } from '../src/lib/webhookUrl'

export interface BackfillDeviceReport {
  sessionKey: string
  metaPath: string
  status: 'usable' | 'missing_meta' | 'invalid_meta' | 'session_key_mismatch'
  reason?: string
}

export interface BackfillResult {
  expectedDeviceCount: number
  sessionDirectoriesFound: number
  usableCount: number
  unusableCount: number
  unaccountedDeviceCount: number
  devices: BackfillDeviceReport[]
  sql: string
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function generateDeviceWebhookBackfill(
  sessionsDir: string,
  expectedDeviceCount = 16
): BackfillResult {
  const directoryNames = fs.existsSync(sessionsDir)
    ? fs.readdirSync(sessionsDir)
      .filter((name) => fs.statSync(path.join(sessionsDir, name)).isDirectory())
      .sort()
    : []
  const devices: BackfillDeviceReport[] = []
  const updates: Array<{ sessionKey: string; webhookUrl: string }> = []

  for (const directoryName of directoryNames) {
    const metaPath = path.join(sessionsDir, directoryName, 'meta.json')
    if (!fs.existsSync(metaPath)) {
      devices.push({
        sessionKey: directoryName,
        metaPath,
        status: 'missing_meta',
        reason: 'meta.json does not exist',
      })
      continue
    }

    let meta: { orgId?: unknown; webhookUrl?: unknown }
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as typeof meta
    } catch (error) {
      devices.push({
        sessionKey: directoryName,
        metaPath,
        status: 'invalid_meta',
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    const sessionKey = typeof meta.orgId === 'string' ? meta.orgId.trim() : ''
    if (!sessionKey || sessionKey !== directoryName) {
      devices.push({
        sessionKey: sessionKey || directoryName,
        metaPath,
        status: 'session_key_mismatch',
        reason: `meta orgId does not match session directory ${directoryName}`,
      })
      continue
    }

    if (!isValidWebhookUrl(meta.webhookUrl)) {
      devices.push({
        sessionKey,
        metaPath,
        status: 'invalid_meta',
        reason: 'webhookUrl is missing or is not an absolute HTTP(S) URL',
      })
      continue
    }

    devices.push({ sessionKey, metaPath, status: 'usable' })
    updates.push({ sessionKey, webhookUrl: meta.webhookUrl.trim() })
  }

  const sqlLines = [
    '-- Generated from session metadata. Review before applying; this file was not executed.',
    'begin;',
    'prepare set_whatsapp_device_webhook(text, text) as',
    '  update public.whatsapp_devices',
    '  set webhook_url = $1',
    '  where session_key = $2',
    '    and webhook_url is null;',
    '',
    ...updates.map(({ sessionKey, webhookUrl }) =>
      `execute set_whatsapp_device_webhook(${sqlLiteral(webhookUrl)}, ${sqlLiteral(sessionKey)});`
    ),
    '',
    'deallocate set_whatsapp_device_webhook;',
    'commit;',
    '',
  ]

  const usableCount = updates.length
  return {
    expectedDeviceCount,
    sessionDirectoriesFound: directoryNames.length,
    usableCount,
    unusableCount: devices.length - usableCount,
    unaccountedDeviceCount: Math.max(0, expectedDeviceCount - directoryNames.length),
    devices,
    sql: sqlLines.join('\n'),
  }
}

function readOption(name: string, fallback: string): string {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function main(): void {
  const sessionsDir = path.resolve(readOption('--sessions-dir', 'sessions'))
  const outputDir = path.resolve(readOption(
    '--output-dir',
    path.join('_task_tmp', 'wa-device-webhook-url')
  ))
  const expectedDeviceCount = Number(readOption('--expected-count', '16'))
  if (!Number.isInteger(expectedDeviceCount) || expectedDeviceCount < 0) {
    throw new Error('--expected-count must be a non-negative integer')
  }

  const result = generateDeviceWebhookBackfill(sessionsDir, expectedDeviceCount)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(path.join(outputDir, 'backfill.sql'), result.sql, 'utf8')
  fs.writeFileSync(
    path.join(outputDir, 'backfill-report.json'),
    JSON.stringify({ ...result, sql: undefined }, null, 2),
    'utf8'
  )
  console.log(JSON.stringify({
    expectedDeviceCount: result.expectedDeviceCount,
    sessionDirectoriesFound: result.sessionDirectoriesFound,
    usableCount: result.usableCount,
    unusableCount: result.unusableCount,
    unaccountedDeviceCount: result.unaccountedDeviceCount,
    sqlPath: path.join(outputDir, 'backfill.sql'),
    reportPath: path.join(outputDir, 'backfill-report.json'),
  }))
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
