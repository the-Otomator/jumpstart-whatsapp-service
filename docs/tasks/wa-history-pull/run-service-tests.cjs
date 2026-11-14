// Run the exact npm test list without spawning an npx resolver for each file.
const { spawnSync } = require('node:child_process')
const { scripts } = require('../../../package.json')
const commands = scripts.test.split(' && ')
let passed = 0
for (const command of commands) {
  const match = /^npx ts-node --transpile-only (\S+)$/.exec(command)
  if (!match) throw new Error(`Unexpected test command: ${command}`)
  const result = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', match[1]], {
    stdio: 'inherit', env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
  passed++
}
console.log(`PASS full npm test list: ${passed}/${commands.length} test programs`)
