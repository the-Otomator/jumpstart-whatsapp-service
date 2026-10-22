import { strict as assert } from 'assert'
import { createDeviceObserver, isHistoryObservation } from './waDeviceObservation'
async function main(){
 let at=0;const calls:any[]=[];
 const observer=createDeviceObserver({rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null}}},()=>at)
 await Promise.all(Array.from({length:1000},()=>observer('device',{refreshSeen:false,audit:{category:'ok'}})))
 assert.equal(calls.length,1)
 at=29_999;await observer('device',{status:'disconnected',refreshSeen:false});assert.equal(calls.length,2);assert.equal(calls[1].args.p_refresh_seen,false)
 at=30_000;await observer('device',{refreshSeen:true});assert.equal(calls.length,3);assert.equal(calls[2].args.p_refresh_seen,true)
 assert(isHistoryObservation({history:true}));assert(isHistoryObservation({isBackfill:true}));assert(isHistoryObservation({is_backfill:true}));assert(!isHistoryObservation({event:'message'}))
 let n=0;const fail=createDeviceObserver({rpc:async()=>({data:null,error:++n===1?{message:'failed'}:null})},()=>0)
 await fail('retry');await fail('retry');assert.equal(n,2)
 console.log('device observation: concurrent sampling, immediate status, boundary, retry and history passed')
}
main().catch(e=>{console.error(e);process.exitCode=1})
