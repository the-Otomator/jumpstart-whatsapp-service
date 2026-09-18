import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { deleteSessionAuthDir, listStoredSessions, saveSessionMeta } from './sessionStore'

const originalCwd = process.cwd()
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-session-purge-'))
const sessionKey = 'test-delete-session'

try {
  process.chdir(testRoot)
  saveSessionMeta({
    orgId: sessionKey,
    createdAt: new Date(0).toISOString(),
    autoRestore: true,
  })
  const authDir = path.join(testRoot, 'sessions', sessionKey)
  fs.writeFileSync(path.join(authDir, 'creds.json'), '{"registered":true}', 'utf8')

  assert.ok(listStoredSessions().includes(sessionKey), 'fixture must be restart-restorable')
  deleteSessionAuthDir(sessionKey)
  assert.ok(!fs.existsSync(authDir), 'purge must remove metadata and pairing credentials')
  assert.ok(!listStoredSessions().includes(sessionKey), 'purged session must not resurrect on restart')

  console.log('sessionStore.purge.test.ts: all checks passed')
} finally {
  process.chdir(originalCwd)
  fs.rmSync(testRoot, { recursive: true, force: true })
}
