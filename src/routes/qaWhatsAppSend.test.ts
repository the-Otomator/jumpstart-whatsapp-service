import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Request, Response } from 'express'
import { qaWhatsAppSend } from './qaWhatsAppSend'

test('scoped QA WhatsApp key refuses wrong session, recipient, cap and revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wa-qa-test-'))
  const previousDirectory = process.env.WA_QA_POLICY_DIRECTORY
  process.env.WA_QA_POLICY_DIRECTORY = directory
  const token = 'a'.repeat(43)
  const policy = {
    keyHash: createHash('sha256').update(token).digest('hex'),
    session: 'approved-test-sender',
    recipient: '972528393669',
    dailyCap: 1,
    revoked: false,
  }
  const valid = { orgId: policy.session, to: policy.recipient, message: '[QA · Test] Message' }
  let sends = 0
  const handler = qaWhatsAppSend(async (message) => {
    assert.equal(message.orgId, policy.session)
    assert.equal(message.to, policy.recipient)
    sends++
    return 'provider-test-id'
  })
  const invoke = async (body: unknown) => {
    let status = 200
    let payload: unknown
    const response = {
      status(value: number) { status = value; return this },
      json(value: unknown) { payload = value; return this },
    } as unknown as Response
    await handler({ headers: { authorization: 'Bearer ' + token }, body } as Request, response, () => {})
    return { status, payload }
  }

  try {
    await writeFile(join(directory, 'policy.json'), JSON.stringify(policy))
    assert.equal((await invoke({ ...valid, orgId: 'other' })).status, 403)
    assert.equal((await invoke({ ...valid, to: '972500000000' })).status, 403)
    assert.equal((await invoke({ ...valid, mediaUrl: 'https://example.test' })).status, 400)
    const attempts = await Promise.all([invoke(valid), invoke(valid)])
    assert.deepEqual(attempts.map(result => result.status).sort(), [200, 429])
    assert.deepEqual(attempts.find(result => result.status === 200)?.payload, { messageId: 'provider-test-id' })
    await writeFile(join(directory, 'policy.json'), JSON.stringify({ ...policy, revoked: true }))
    assert.equal((await invoke(valid)).status, 403)
    assert.equal(sends, 1)
  } finally {
    if (previousDirectory === undefined) delete process.env.WA_QA_POLICY_DIRECTORY
    else process.env.WA_QA_POLICY_DIRECTORY = previousDirectory
    await rm(directory, { recursive: true, force: true })
  }
})
