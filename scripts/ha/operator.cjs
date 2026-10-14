// Explicit operator entry point. Never loaded by the service.
const fs = require('node:fs')
const { randomUUID, createHash } = require('node:crypto')
const { makePool, PgHaStore } = require('../../dist/ha/store')
const { HetznerProvisioner, approvalHash } = require('../../dist/ha/providers')
async function main() {
 const [kind, target, payloadFile, approvalId] = process.argv.slice(2)
 if (!['provision','manual-fence','rejoin','activate-fencing'].includes(kind) || !target || !payloadFile) throw Error('USAGE: operator.cjs KIND TARGET PAYLOAD_JSON [APPROVAL_UUID]')
 const payload = JSON.parse(fs.readFileSync(payloadFile,'utf8'))
 const normalized = kind === 'provision' ? {name:target,serverType:payload.serverType,image:payload.image,location:payload.location,sshKeys:[...payload.sshKeys].sort()} : {boot:payload.boot}
 if (kind !== 'provision' && !/^[a-f0-9-]{36}$/.test(payload.boot || '')) throw Error('BOOT_UUID_REQUIRED')
 const hash = kind === 'provision' ? approvalHash(normalized) : createHash('sha256').update(kind+'\n'+target+'\n'+payload.boot).digest('hex')
 // Planning is side-effect free, including no DB/network connection.
 if (!approvalId) { console.log(JSON.stringify({kind,target,requestHash:hash,payload:normalized})); return }
 if (!process.env.WA_HA_OPERATOR_DATABASE_URL) throw Error('OPERATOR_DB_REQUIRED')
 const pool = makePool(process.env.WA_HA_OPERATOR_DATABASE_URL, false, process.env.WA_HA_CA_FILE)
 const store = new PgHaStore(pool, randomUUID())
 try {
  if (kind === 'provision') {
   if (!process.env.WA_HA_PROVISION_HETZNER_TOKEN) throw Error('PROVISION_TOKEN_REQUIRED')
   console.log(JSON.stringify(await new HetznerProvisioner(store,process.env.WA_HA_PROVISION_HETZNER_TOKEN).provision(normalized,approvalId)))
  } else { await store.call('operator_node_action',[approvalId,kind,target,hash,payload.boot]);console.log('APPROVED_ACTION_COMPLETED') }
 } finally { await store.close() }
}
main().catch(()=>{console.error('HA_OPERATOR_ACTION_FAILED; reconcile audit state before retry');process.exitCode=1})
