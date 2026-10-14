// Offline-only import, no Baileys socket and no provider API. See runbook section 3.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { AuthCipher } = require('../../dist/ha/crypto')
const { makePool,PgHaStore,monotonic } = require('../../dist/ha/store')
async function main(){
 if(process.env.WA_HA_IMPORT_OFFLINE_CONFIRMED!=='old-owner-power-off-verified')throw Error('OFFLINE_CONFIRMATION_REQUIRED')
 const [session,authDir,metaFile]=process.argv.slice(2)
 if(!session||session==='@wa-ha-active'||!authDir||!metaFile)throw Error('IMPORT_ARGUMENTS_REQUIRED')
 const cipher=new AuthCipher(process.env.WA_HA_CURRENT_KID,JSON.parse(process.env.WA_HA_KEYRING_JSON||'{}'))
 const store=new PgHaStore(makePool(process.env.WA_HA_DATABASE_URL,false,process.env.WA_HA_CA_FILE),randomUUID())
 let renew,ticking=false,failed=false;const leases=[]
 try{
  await store.register()
  for(const key of ['@wa-ha-active',session]){const start=monotonic(),claim=await store.claim(key);if(!claim.owned)throw Error('IMPORT_LEASE_UNAVAILABLE');leases.push({key,epoch:claim.epoch,deadline:start+15000})}
  renew=setInterval(async()=>{if(ticking)return;ticking=true;try{for(const lease of leases){const start=monotonic();await store.renew(lease);lease.deadline=start+15000}}catch{failed=true}finally{ticking=false}},5000)
  const lease=leases[1]
  if((await store.list()).some(e=>e.key===session)||Object.keys(await store.read(lease,['creds'])).length)throw Error('IMPORT_DESTINATION_NOT_EMPTY')
  const files=await fs.readdir(authDir)
  if(!files.includes('creds.json'))throw Error('IMPORT_CREDS_MISSING')
  for(const file of files.filter(f=>f.endsWith('.json'))){
   if(failed||lease.deadline<=monotonic())throw Error('IMPORT_DB_PROOF_EXPIRED')
   const item=file.slice(0,-5),text=await fs.readFile(path.join(authDir,file),'utf8');JSON.parse(text)
   await store.write(lease,{[item]:cipher.seal(session,item,text)})
  }
  const meta=JSON.parse(await fs.readFile(metaFile,'utf8'))
  if(meta.orgId!==session||typeof meta.webhookUrl!=='string'||!meta.webhookUrl)throw Error('IMPORT_META_INVALID')
  await store.catalog(lease,cipher.seal(session,'@meta',JSON.stringify(meta)),true)
  console.log(JSON.stringify({event:'offline_import_complete',boot:store.boot,session,files:files.filter(f=>f.endsWith('.json')).length}))
 }finally{clearInterval(renew);while(ticking)await new Promise(r=>setTimeout(r,50));await store.close()}
}
main().catch(()=>{console.error('HA_IMPORT_FAILED; destination may be partial; keep all sockets offline and reconcile');process.exitCode=1})
