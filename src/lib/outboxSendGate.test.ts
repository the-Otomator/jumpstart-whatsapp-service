import assert from 'node:assert/strict'
import { outboxCheckedPurpose, readOutboxGateMode } from './outboxSendGate'

assert.equal(readOutboxGateMode({}), 'observe')
assert.equal(readOutboxGateMode({ OUTBOX_SEND_GATE_MODE: 'required' }), 'required')
assert.equal(readOutboxGateMode({ OUTBOX_SEND_GATE_MODE: 'OFF' }), 'off')
assert.equal(
  outboxCheckedPurpose({ header: (name: string) => (name === 'x-jumpstart-outbox-checked' ? 'broadcast' : null) } as never),
  'broadcast',
)
assert.equal(outboxCheckedPurpose({ header: () => null } as never), null)
console.log('outboxSendGate tests passed')
