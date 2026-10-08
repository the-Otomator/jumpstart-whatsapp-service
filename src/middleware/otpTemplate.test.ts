import assert from 'node:assert/strict'
import { sendMessageSchema } from './validate'

const input = {
  orgId: 'meta-1f63d665b06549c7ad0492427cfb7265', to: '15555550100', type: 'template',
  template: { name: 'otp_login_he', language: 'he', components: [
    { type: 'body', parameters: [{ type: 'text', text: 'fixture' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'fixture' }] },
  ] },
}
const parsed = sendMessageSchema.parse(input)
assert.deepEqual(parsed.template?.components, input.template.components, 'preserve copy-code button metadata for Meta')
assert.equal(sendMessageSchema.safeParse({ ...input, template: { ...input.template,
  components: [{ ...input.template.components[1], sub_type: 'arbitrary' }] } }).success, false)
assert.equal(sendMessageSchema.safeParse({ ...input, template: { ...input.template,
  components: [{ ...input.template.components[1], index: '-1' }] } }).success, false)
console.log('otpTemplate: copy-code metadata preserved; invalid subtype/index rejected')
