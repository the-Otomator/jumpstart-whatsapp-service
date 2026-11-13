import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

describe('sessionStore channel migration', () => {
  let tmp = ''
  let cwd = ''

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-channel-'))
    cwd = process.cwd()
    process.chdir(tmp)
    fs.mkdirSync(path.join(tmp, 'sessions', 'org1'), { recursive: true })
  })

  after(() => {
    process.chdir(cwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('migrates legacy meta.json to meta.<channel>.json without touching creds', async () => {
    const orgDir = path.join(tmp, 'sessions', 'org1')
    fs.writeFileSync(path.join(orgDir, 'creds.json'), JSON.stringify({ me: { id: '1@s.whatsapp.net' } }))
    fs.writeFileSync(
      path.join(orgDir, 'meta.json'),
      JSON.stringify({
        orgId: 'org1',
        provider: 'baileys',
        autoRestore: true,
        createdAt: new Date().toISOString(),
        webhookUrl: 'https://example.com/hook',
      })
    )

    const store = await import('./sessionStore')
    const meta = store.loadSessionMeta('org1', 'phone')
    assert.equal(meta?.channel, 'phone')
    assert.ok(fs.existsSync(path.join(orgDir, 'meta.phone.json')))
    assert.ok(!fs.existsSync(path.join(orgDir, 'meta.json')))
    assert.ok(fs.existsSync(path.join(orgDir, 'creds.json')), 'creds must remain (no reconnect)')

    store.saveSessionMeta({
      orgId: 'org1',
      provider: 'meta-cloud',
      channel: 'official',
      autoRestore: true,
      createdAt: new Date().toISOString(),
      webhookUrl: 'https://example.com/official',
      metaAccessToken: 'tok',
      metaPhoneNumberId: '1',
      metaWabaId: '2',
    })
    assert.ok(fs.existsSync(path.join(orgDir, 'meta.official.json')))
    assert.equal(store.loadSessionMeta('org1', 'official')?.provider, 'meta-cloud')
    assert.equal(store.loadSessionMeta('org1', 'phone')?.provider, 'baileys')

    store.deleteSessionAuthDir('org1')
    assert.ok(!fs.existsSync(path.join(orgDir, 'creds.json')))
    assert.ok(fs.existsSync(path.join(orgDir, 'meta.official.json')), 'official preserved on phone purge')
  })
})
