import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const text = readFileSync(new URL('../workflows/task-link.yml', import.meta.url), 'utf8');
const prod = /PROD_BRANCH: (main|master)/.exec(text)[1];
const script = text.split('          script: |\n')[1].split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
test('trusted workflow does not check out PR code and uses the protected App', () => {
  assert.match(text, /pull_request_target:/);
  for (const event of ['opened','edited','synchronize','reopened','closed']) assert.ok(text.includes(event));
  assert.ok(!text.includes('actions/checkout')); assert.ok(!text.includes('pull_request:'));
  assert.match(text, /environment: task-link-gate/); assert.match(text, /permission-statuses: write/);
  assert.match(script, /APP_SLUG !== 'otomator-release-gate'/);
});
test('production and feature events fail closed while the server verifies only PR identity', async () => {
  for (const base of [prod,'feature/test']) {
    const statuses=[], requests=[], failures=[];
    const github={rest:{pulls:{get:async()=>({data:{state:'open',base:{ref:base},head:{sha:'a'.repeat(40)}}})},repos:{createCommitStatus:async value=>statuses.push(value)}}};
    const context={repo:{owner:'the-Otomator',repo:'fixture'},payload:{pull_request:{number:1,base:{ref:base}}}};
    const run=new AsyncFunction('github','context','core','fetch','process',script);
    const env={PROD_BRANCH:prod,OPS_URL:'https://fixture',OPS_SECRET:'fixture',APP_SLUG:'otomator-release-gate'};
    await run(github,context,{setFailed:value=>failures.push(value)},async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,valid:false}));},{env});
    assert.equal(statuses.length,1); assert.equal(statuses[0].state,'failure'); assert.equal(statuses[0].context,'task-link');
    assert.deepEqual(requests,[{repo:'the-Otomator/fixture',action:'task_link',number:1}]);
    statuses.length=0;
    await run(github,context,{setFailed:value=>failures.push(value)},async()=>{throw new Error('fixture unavailable')},{env});
    assert.equal(statuses[0].state,'failure'); assert.equal(failures.length,1);
  }
});
