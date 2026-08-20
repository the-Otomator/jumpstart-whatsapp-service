import assert from 'assert'
import {
  resolveInboundPhone,
  resolveWebhookFrom,
  contactPhoneDigits,
  pickPnDigits,
} from './groupInbound'

function main(): void {
  const oneToOneLid = resolveInboundPhone({
    remoteJid: '203358262571163@lid',
    remoteJidAlt: '972501234567@s.whatsapp.net',
  }, false)
  assert.strictEqual(
    oneToOneLid,
    '972501234567',
    'one-to-one LID messages must use remoteJidAlt for downstream phone matching',
  )

  const groupLid = resolveInboundPhone({
    remoteJid: '120363372704739089@g.us',
    participant: '203358262571163@lid',
    participantAlt: '972501234567@s.whatsapp.net',
  }, true)
  assert.strictEqual(
    groupLid,
    '972501234567',
    'group LID messages must use participantAlt for downstream phone matching',
  )

  assert.strictEqual(
    resolveInboundPhone({ remoteJid: '203358262571163@lid' }, false),
    null,
    'an unresolved LID must not be mistaken for a phone number',
  )

  assert.strictEqual(
    resolveWebhookFrom({
      isGroup: false,
      remoteJid: '203358262571163@lid',
      senderPn: '972501234567',
      participantPn: null,
    }),
    '972501234567',
    'webhook from must prefer resolved PN over LID remoteJid',
  )

  assert.strictEqual(
    contactPhoneDigits({ id: '203358262571163@lid', phoneNumber: '972501234567@s.whatsapp.net' }),
    '972501234567',
    'v7 Contact.phoneNumber must win over LID id',
  )

  assert.strictEqual(
    pickPnDigits('203358262571163@lid', '972509999999@s.whatsapp.net'),
    '972509999999',
    'pickPnDigits must skip @lid candidates',
  )

  console.log('groupInbound.test.ts: all checks passed')
}

main()
