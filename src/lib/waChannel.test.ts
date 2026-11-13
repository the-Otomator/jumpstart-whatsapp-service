import assert from 'node:assert/strict'
import {
  assertOfficialSendAllowed,
  channelFromProvider,
  pickSendChannel,
  providerFromChannel,
} from './waChannel'

assert.equal(channelFromProvider('baileys'), 'phone')
assert.equal(channelFromProvider('meta-cloud'), 'official')
assert.equal(providerFromChannel('phone'), 'baileys')
assert.equal(providerFromChannel('official'), 'meta-cloud')

assert.equal(
  pickSendChannel({ lane: 'marketing', channel: 'phone' }, { phone: true, official: true }),
  'phone',
  'explicit channel overrides'
)
assert.equal(
  pickSendChannel({ lane: 'marketing' }, { phone: true, official: true }),
  'official',
  'marketing + official → official'
)
assert.equal(
  pickSendChannel({ lane: 'operational' }, { phone: true, official: true }),
  'phone',
  'operational → phone'
)
assert.equal(
  pickSendChannel({ lane: 'marketing' }, { phone: true }),
  'phone',
  'marketing without official → phone'
)
assert.equal(
  pickSendChannel({ lane: 'operational' }, { official: true }),
  'official',
  'only official → official'
)

assert.throws(
  () => assertOfficialSendAllowed({ type: 'text' }, 'official'),
  /approved template/
)
assert.doesNotThrow(() =>
  assertOfficialSendAllowed(
    { type: 'template', template: { name: 'hello', language: 'he' } },
    'official'
  )
)

console.log('waChannel.test.ts: all checks passed')
