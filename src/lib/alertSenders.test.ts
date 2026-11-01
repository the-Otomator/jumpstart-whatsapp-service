import assert from 'node:assert/strict'
import * as registry from './jumpstartSupabase'
import * as monitor from './waDeviceMonitor'
import * as messages from '../routes/messages'
import { recordOrgValidationFailure, resetOrgValidationAlertStateForTests } from './validationAlert'

async function main() {
  const oldDb = registry.jumpstartSupabase, oldSend = messages.sendWhatsAppMessage, oldFetch = globalThis.fetch
  const oldEmail = process.env.RESEND_API_KEY, oldAlerts = process.env.WA_SESSION_ALERTS
  let emails = 0, sends = 0
  const row = { id:'synthetic', organization_id:'customer', name:'test', session_key:'down', status:'disconnected', phone_number:null, last_error:null }
  try {
    process.env.RESEND_API_KEY = 'synthetic'; process.env.WA_SESSION_ALERTS = '1'
    const db = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data:[{organization_id:'foreign',status:'connected',listen_only:false}],error:null }) }) }), update: () => ({ eq: async () => ({ error:null }) }) }) }
    ;(registry as any).jumpstartSupabase = db
    ;(messages as any).sendWhatsAppMessage = async () => { sends++; throw new Error('FOREIGN SEND') }
    globalThis.fetch = async (url, init) => { assert.equal(String(url),'https://api.resend.com/emails'); assert.equal(JSON.parse(String(init?.body)).from,'JumpStart <noreply@jumpstart.co.il>'); emails++; return Response.json({ id:'synthetic' }) }
    await monitor.sendOutageAlert(row, 600_000)
    await monitor.sendRecoveryAndClear(row)
    resetOrgValidationAlertStateForTests()
    await recordOrgValidationFailure('customer','SYNTHETIC_UNAVAILABLE')
    assert.equal(sends,0); assert.equal(emails,3)
    console.log('Actual outage/recovery/validation entrypoints: foreign devices blocked, 3 platform emails, zero WA sends')
  } finally {
    ;(registry as any).jumpstartSupabase = oldDb; (messages as any).sendWhatsAppMessage = oldSend; globalThis.fetch = oldFetch
    if(oldEmail===undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY=oldEmail
    if(oldAlerts===undefined) delete process.env.WA_SESSION_ALERTS; else process.env.WA_SESSION_ALERTS=oldAlerts
    resetOrgValidationAlertStateForTests()
  }
}
main().catch(e=>{console.error(e);process.exitCode=1})
