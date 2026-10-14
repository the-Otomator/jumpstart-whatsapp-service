const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { once } = require('node:events')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { Pool } = require('pg')
const { AuthCipher } = require('../../dist/ha/crypto')
const { PgHaStore, makePool, monotonic } = require('../../dist/ha/store')
const { HetznerFencer, HetznerProvisioner, approvalHash } = require('../../dist/ha/providers')
const { recommendFleet } = require('../../dist/ha/metrics')
const { supervise } = require('../../dist/ha/launcher')
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, '_state', 'wa-ha-phase1-simulation.jsonl')
fs.mkdirSync(path.dirname(output), { recursive: true })
const adminUrl = process.env.HA_TEST_ADMIN_URL || 'postgresql://wa_ha_test@127.0.0.1:55439/postgres'
const parsed = new URL(adminUrl)
if (!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) || parsed.port !== '55439' || parsed.username !== 'wa_ha_test') throw new Error('REFUSING_NONLOCAL_TEST_DATABASE')
const admin = new Pool({ connectionString: adminUrl, max: 2 })
const suffix = randomBytes(4).toString('hex')
const dbName = 'wa_ha_test_' + suffix
const names = Object.fromEntries(['a','b','c','d','fa','fb','fc','fd','ops','reader','denied'].map(n => [n, 'ha_test_' + suffix + '_' + n]))
const pools = [], children = [], records = []
let db, witness, tests = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, timeout = 10000) {
 const start = Date.now()
 while (!(await predicate())) { if (Date.now() - start > timeout) throw new Error('TEST_WAIT_TIMEOUT'); await sleep(50) }
}
async function test(name, fn) { await fn(); tests++; console.log('PASS ' + name) }
function url(role) { const copy = new URL(adminUrl); copy.username = names[role]; copy.pathname = '/' + dbName; return copy.toString() }
function pool(role) { const result = makePool(url(role), true); pools.push(result); return result }
function record(value) { records.push(value); fs.appendFileSync(output, JSON.stringify(value) + '\n') }
const sample = { cpuPercent: 12, ramPercent: 30, diskPercent: 20, owned: 0, connected: 0, messagesPerMinute: 0, renewLatencyMs: 1 }
async function main() {
 const actual = (await admin.query('show data_directory')).rows[0].data_directory
 const expected = process.env.HA_TEST_EXPECTED_DATA_DIR || path.join(root, '_task_tmp/wa-ha-phase1/pgdata')
 const normalize = x => x.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()
 assert.equal(normalize(actual), normalize(expected), 'Refusing to mutate an unexpected local server')
 await admin.query('CREATE DATABASE "' + dbName + '"')
 db = new Pool({ connectionString: adminUrl.replace(/\/postgres(?:\?.*)?$/, '/' + dbName) })
 await db.query(fs.readFileSync(path.join(root, 'supabase/migrations/20261014073436_wa_ha_phase1.sql'), 'utf8').replace(/^\uFEFF/,''))
 for (const role of Object.values(names)) await admin.query('CREATE ROLE "' + role + '" LOGIN')
 for (const n of ['a','b','c','d']) await admin.query('GRANT wa_ha_service TO "' + names[n] + '"')
 for (const n of ['fa','fb','fc','fd']) await admin.query('GRANT wa_ha_fencer TO "' + names[n] + '"')
 await admin.query('GRANT wa_ha_operator TO "' + names.ops + '"')
 await admin.query('GRANT wa_ha_reader TO "' + names.reader + '"')
 for (const n of ['a','b','c','d']) await db.query('INSERT INTO wa_ha.nodes(node_id,db_role,fencer_role,provider,resource_id,session_capacity,fencing_enabled) VALUES($1,$2,$3,$4,$5,10,true)', [n,names[n],names['f'+n],n==='a'||n==='b'?'fixture':'test-process','fixture-'+n])
 const bootA=randomUUID(),bootB=randomUUID()
 const A=new PgHaStore(pool('a'),bootA,pool('fa')),B=new PgHaStore(pool('b'),bootB,pool('fb'))
 await A.register();await B.register()
 const key = randomBytes(32).toString('base64'), cipher = new AuthCipher('test',{test:key})
 await test('AES-GCM auth round-trip and fresh nonces', async()=>{
  const a=cipher.seal('session','creds','secret-fixture'),b=cipher.seal('session','creds','secret-fixture')
  assert.equal(cipher.open('session','creds',a),'secret-fixture');assert.notEqual(a.iv,b.iv);assert(!JSON.stringify(a).includes('secret-fixture'))
 })
 await test('AAD/session swap and ciphertext tamper rejected',async()=>{
  const a=cipher.seal('session','creds','fixture');assert.throws(()=>cipher.open('other','creds',a))
  a.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>cipher.open('session','creds',a))
 })
 await test('key rotation reads old ciphertext only while old key retained',async()=>{
  const a=cipher.seal('session','creds','fixture'),next=randomBytes(32).toString('base64')
  assert.equal(new AuthCipher('next',{test:key,next}).open('session','creds',a),'fixture')
  assert.throws(()=>new AuthCipher('next',{next}).open('session','creds',a))
 })
 await test('ten concurrent claims each have exactly one node winner',async()=>{
  for(let i=0;i<10;i++){const claims=await Promise.all([A.claim('race-'+i),B.claim('race-'+i)]);assert.equal(claims.filter(c=>c.owned).length,1)}
 })
 const initial=await A.claim('auth-fixture'),leaseA={key:'auth-fixture',epoch:initial.epoch,deadline:monotonic()+15000}
 await test('lease renew, encrypted write and read on real PostgreSQL',async()=>{
  await A.renew(leaseA);await A.write(leaseA,{creds:cipher.seal(leaseA.key,'creds','fixture')})
  assert.equal(cipher.open(leaseA.key,'creds',(await A.read(leaseA,['creds'])).creds),'fixture')
 })
 await test('both nodes write capacity and reader can read sanitized fleet data',async()=>{
  await A.sample(sample);await B.sample(sample)
  const fleet=(await pool('reader').query('select wa_ha.fleet_snapshot() as fleet')).rows[0].fleet
  assert.equal(fleet.samples.length,2);assert(!JSON.stringify(fleet).includes('db_role'))
 })
 await db.query("UPDATE wa_ha.leases SET expires_at=clock_timestamp()-interval '1 second'")
 await test('expired owner cannot renew and expiry alone cannot transfer ownership',async()=>{
  await assert.rejects(()=>A.renew(leaseA),/HA_STALE_LEASE/)
  const blocked=await B.claim(leaseA.key);assert.equal(blocked.owned,false);assert.equal(blocked.expired,true)
 })
 const plan=await B.beginFence('a',bootA)
 await test('unconfirmed fence and wrong resource cannot transfer ownership',async()=>{
  await assert.rejects(()=>B.confirmFence({...plan,resourceId:'wrong'},'fixture-off'),/HA_FENCE_CONFIRMATION_INVALID/)
  assert.equal((await B.claim(leaseA.key)).owned,false)
 })
 await B.confirmFence(plan,'fixture:off-confirmed')
 const next=await B.claim(leaseA.key),leaseB={key:leaseA.key,epoch:next.epoch,deadline:monotonic()+15000}
 await test('confirmed fencing permits takeover with higher epoch',async()=>{assert(next.owned);assert(BigInt(next.epoch)>BigInt(initial.epoch))})
 await test('stale owner auth writes and external sends rejected',async()=>{
  await assert.rejects(()=>A.write(leaseA,{creds:cipher.seal(leaseA.key,'creds','stale')}))
  let sent=false;await assert.rejects(()=>A.runFenced(leaseA,async()=>{sent=true},()=>{}));assert.equal(sent,false)
 })
 await test('current owner cannot use an old epoch',async()=>{await assert.rejects(()=>B.write({...leaseB,epoch:initial.epoch},{creds:null}),/HA_STALE_LEASE/)})
 await test('disabled node cannot auto-rejoin and unknown login cannot claim',async()=>{
  await assert.rejects(()=>A.register(),/HA_EXPLICIT_REJOIN_REQUIRED/)
  await assert.rejects(()=>pool('denied').query('select wa_ha.register_node($1)',[randomUUID()]),/permission denied/)
 })
 await test('runtime has no direct tables, fencing/operator privileges or PUBLIC definer grants',async()=>{
  await assert.rejects(()=>A.pool.query('update wa_ha.leases set epoch=999'),/permission denied/)
  await assert.rejects(()=>A.call('consume_approval',[randomUUID(),'provision','x','a'.repeat(64)]),/permission denied/)
  await assert.rejects(()=>A.call('begin_fence',[bootA,'b',bootB]),/permission denied/)
  const result=await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a where n.nspname='wa_ha' and a.grantee=0 and a.privilege_type='EXECUTE'")
  assert.equal(result.rows[0].n,0)
  assert.equal((await db.query("select count(*)::int as n from pg_tables where schemaname='wa_ha' and not rowsecurity")).rows[0].n,0)
 })
 await test('send permit does not deadlock independent auth/ratchet commit',async()=>{
  await B.runFenced(leaseB,async()=>{await B.write(leaseB,{ratchet:cipher.seal(leaseB.key,'ratchet','next')});return true},()=>{throw new Error('unexpected fence')})
 })
 await test('null capacity metrics are rejected',async()=>{
  await assert.rejects(()=>B.sample({...sample,ramPercent:null}),/HA_SAMPLE_INVALID/)
 })
 const ops=new PgHaStore(pool('ops'),randomUUID())
 await test('operator approval is bound to kind/node/boot and consumed once',async()=>{
  const action=randomUUID(),hash=createHash('sha256').update('activate-fencing\nb\n'+bootB).digest('hex')
  await db.query("insert into wa_ha.operator_approvals(action_id,kind,target,request_hash,approved_by,expires_at) values($1,'activate-fencing','b',$2,'local-test',clock_timestamp()+interval '1 minute')",[action,hash])
  await assert.rejects(()=>ops.call('operator_node_action',[action,'activate-fencing','b',hash,randomUUID()]),/HA_APPROVAL_PAYLOAD_MISMATCH/)
  await ops.call('operator_node_action',[action,'activate-fencing','b',hash,bootB])
  await assert.rejects(()=>ops.call('operator_node_action',[action,'activate-fencing','b',hash,bootB]),/HA_APPROVAL_REQUIRED_OR_USED/)
 })
 await test('concurrent sends serialize while auth commits remain independent',async()=>{
  let active=0,peak=0,fences=0
  await Promise.all(Array.from({length:3},()=>B.runFenced(leaseB,async()=>{active++;peak=Math.max(peak,active);await sleep(450);await B.write(leaseB,{fixture:cipher.seal(leaseB.key,'fixture','ok')});active--},()=>fences++)))
  assert.equal(peak,1);assert.equal(fences,0)
 })
 const spec={name:'approved-fixture',serverType:'fixture',image:'fixture-image',location:'fixture-location',sshKeys:['test-key-id']}
 const normalized={...spec,sshKeys:[...spec.sshKeys].sort()}
 let creates=0
 const provisioner=new HetznerProvisioner(ops,'test-token',async()=>{creates++;return new Response(JSON.stringify({server:{id:123}}),{status:201})})
 await test('provisioning without a persisted approval makes zero provider calls',async()=>{
  await assert.rejects(()=>provisioner.provision(spec,randomUUID()));assert.equal(creates,0)
 })
 const approval=randomUUID()
 await db.query("insert into wa_ha.operator_approvals(action_id,kind,target,request_hash,approved_by,expires_at) values($1,'provision',$2,$3,'local-test',clock_timestamp()+interval '1 minute')",[approval,spec.name,approvalHash(normalized)])
 await test('approved provisioning is one-shot and reusing approval is rejected',async()=>{
  assert.deepEqual(await provisioner.provision(spec,approval),{resourceId:'123'})
  await assert.rejects(()=>provisioner.provision(spec,approval));assert.equal(creates,1)
 })
 await test('Hetzner fencer confirms the expected resource is off, not just HTTP success',async()=>{
  let count=0;const fencer=new HetznerFencer('test-token',async(_url,options)=>{
   if(options.method==='POST')return new Response(JSON.stringify({action:{id:42}}),{status:201})
   count++;return new Response(JSON.stringify({server:{id:123,status:count===1?'running':'off'}}),{status:200})
  })
  assert.equal(await fencer.powerOffAndConfirm({provider:'hetzner',resourceId:'123'}),'hetzner:server-off:123')
  await assert.rejects(()=>fencer.powerOffAndConfirm({provider:'unsupported',resourceId:'123'}),/HA_PROVIDER_UNSUPPORTED/)
 })
 await test('fleet recommendation separates redundancy from active-node capacity',async()=>{
  assert.equal(recommendFleet([{enabled:true,state:'ready'}],[]),'add-node')
  assert.equal(recommendFleet([{enabled:true,state:'ready'},{enabled:true,state:'ready'}],[sample,sample,{...sample,cpuPercent:90}]),'healthy')
  assert.equal(recommendFleet([{enabled:true,state:'ready'},{enabled:true,state:'ready'}],Array(3).fill({...sample,ramPercent:90})),'upgrade-node')
 })
 await test('independent watchdog kills a stalled event loop',async()=>{
  const child=supervise(path.join(__dirname,'test-stalled-worker.cjs'),[],1500);children.push(child)
  const start=Date.now();await once(child,'exit');assert(Date.now()-start<12000);assert(child.signalCode||child.exitCode!==0)
 })
 // Paired test auth is synthetic and never sent to WhatsApp.
 const creds=initAuthCreds();creds.me={id:'15550001111@s.whatsapp.net',name:'HA fixture'};creds.registered=true
 const fingerprint=createHash('sha256').update(JSON.stringify(creds.noiseKey,BufferJSON.replacer)).digest('hex')
 await db.query("insert into wa_ha.leases(session_key) values('test-session')")
 await db.query("insert into wa_ha.auth_state(session_key,item_key,encrypted) values('test-session','creds',$1)",[JSON.stringify(cipher.seal('test-session','creds',JSON.stringify(creds,BufferJSON.replacer)))])
 await db.query("insert into wa_ha.catalog(session_key,encrypted_meta) values('test-session',$1)",[JSON.stringify(cipher.seal('test-session','@meta',JSON.stringify({webhookUrl:'https://fixture.invalid/webhook'})))])
 const live=new Map();let duplicates=0
 witness=net.createServer(socket=>{
  socket.on('error',()=>{}) // Killing the fixture deliberately resets its TCP connection.
  let body='',openedKey
  socket.on('data',chunk=>{body+=chunk;let end;while((end=body.indexOf('\n'))>=0){const msg=JSON.parse(body.slice(0,end));body=body.slice(end+1)
   if(msg.type==='open'){if(live.has(msg.key))duplicates++;openedKey=msg.key;live.set(msg.key,{node:msg.node,paired:msg.paired,fingerprint:msg.fingerprint});record({at:Date.now(),event:'witness_open',key:msg.key,node:msg.node,paired:msg.paired,duplicates})}
  }})
  socket.on('close',()=>{if(openedKey){live.delete(openedKey);record({at:Date.now(),event:'witness_close',key:openedKey})}})
 })
 await new Promise(resolve=>witness.listen(0,'127.0.0.1',resolve))
 const witnessPort=witness.address().port
 const nodeChildren=new Map()
 function spawnNode(n){
  const child=supervise(path.join(__dirname,'test-worker.cjs'),[],15000,{...process.env,HA_TEST_NODE_URL:url(n),HA_TEST_FENCER_URL:url('f'+n),HA_TEST_KEY:key,HA_TEST_WITNESS_PORT:String(witnessPort)})
  children.push(child);nodeChildren.set(n,child)
  child.on('message',async msg=>{
   if(msg.type==='event')record(msg.record)
   if(msg.type==='fence-request'){
    const target=nodeChildren.get(msg.plan.nodeId)
    const confirmed=!!target&&String(target.pid)===msg.plan.resourceId&&(target.exitCode!==null||target.signalCode!==null)
    if(child.connected)child.send({type:'fence-result',id:msg.id,confirmed})
   }
  })
  return child
 }
 const nodeC=spawnNode('c')
 await db.query("update wa_ha.nodes set resource_id=$1 where node_id='c'",[String(nodeC.pid)])
 await until(()=>live.get('test-session')?.node==='c',20000)
 const nodeD=spawnNode('d')
 await db.query("update wa_ha.nodes set resource_id=$1 where node_id='d'",[String(nodeD.pid)])
 await until(async()=>Number((await db.query("select count(distinct node_id) as n from wa_ha.capacity_samples where node_id in ('c','d')")).rows[0].n)===2,20000)
 const killAt=Date.now();record({at:killAt,event:'kill_node_a',node:'c'});nodeC.kill('SIGKILL')
 await test('real two-process takeover after 60s lease, confirmed dead owner, no QR/duplicate transport',async()=>{
  await until(()=>live.get('test-session')?.node==='d',95000)
  const elapsed=Date.now()-killAt
  assert(elapsed<=90000);assert.equal(duplicates,0);assert.equal(live.get('test-session').paired,true);assert.equal(live.get('test-session').fingerprint,fingerprint)
  assert(records.some(r=>r.event==='power_off_confirmed'));assert(!records.some(r=>r.event==='QR_REQUIRED'))
  record({at:Date.now(),event:'takeover_assertions_passed',elapsedMs:elapsed,duplicateSockets:duplicates,qrRequired:false,transport:'instrumented-local-tcp'})
 })
 await test('capacity remains readable for both simulated nodes after takeover',async()=>{
  await until(async()=>Number((await db.query("select count(*) as n from wa_ha.capacity_samples where node_id='d' and (metrics->>'connected')::int=1")).rows[0].n)>0,20000)
  const snapshot=(await pool('reader').query('select wa_ha.fleet_snapshot() as fleet')).rows[0].fleet
  assert(snapshot.samples.some(s=>s.node_id==='c'));assert(snapshot.samples.some(s=>s.node_id==='d'))
 })
 await test('DB disable/partition doubt self-fences the surviving socket within 15s',async()=>{
  const start=Date.now();await db.query("update wa_ha.nodes set enabled=false where node_id='d'")
  await until(()=>!live.has('test-session'),15000);assert(Date.now()-start<=15000)
 })
 await test('rollback removes private schema and preserves role groups for audited cleanup',async()=>{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
  await db.query(fs.readFileSync(path.join(root,'supabase/rollbacks/20261014073436_wa_ha_phase1.sql'),'utf8').replace(/^\uFEFF/,''))
  assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname='wa_ha'")).rows[0].n,0)
  assert.equal((await db.query("select count(*)::int n from pg_roles where rolname='wa_ha_service'")).rows[0].n,1)
 })
 console.log(JSON.stringify({tests,simulationLog:output,duplicateSockets:duplicates,qrRequired:false}))
}
main().catch(err=>{console.error(err);process.exitCode=1}).finally(async()=>{
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')
 if(witness)await new Promise(resolve=>witness.close(resolve))
 await Promise.all(pools.map(p=>p.end().catch(()=>{})))
 await db?.end().catch(()=>{})
 // Exact names generated by this run, on the verified disposable local server.
 await admin.query('DROP DATABASE IF EXISTS "'+dbName+'" WITH (FORCE)').catch(()=>{})
 for(const role of Object.values(names))await admin.query('DROP ROLE IF EXISTS "'+role+'"').catch(()=>{})
 await admin.end()
})
