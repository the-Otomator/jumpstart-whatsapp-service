// Local-only test worker: actual coordinator, PostgreSQL leases and auth adapter;
// instrumented TCP transport replaces WhatsApp. Never contacts WhatsApp.
const net = require('node:net')
const { createHash, randomUUID } = require('node:crypto')
const { HaCoordinator } = require('../../dist/ha/coordinator')
const { PgHaStore, makePool } = require('../../dist/ha/store')
const { AuthCipher } = require('../../dist/ha/crypto')
const { useSharedAuthState } = require('../../dist/ha/authState')
const { BufferJSON } = require('@whiskeysockets/baileys')
const boot = randomUUID()
const store = new PgHaStore(makePool(process.env.HA_TEST_NODE_URL, true), boot, makePool(process.env.HA_TEST_FENCER_URL, true))
const cipher = new AuthCipher('test', { test: process.env.HA_TEST_KEY })
const connections = new Map(), pending = new Map()
process.on('message', msg => {
 if (msg.type === 'fence-result') { const resolve = pending.get(msg.id); pending.delete(msg.id); resolve?.(msg.confirmed) }
})
const fencer = { async powerOffAndConfirm(plan) {
 if (plan.provider !== 'test-process') throw new Error('TEST_PROVIDER_ONLY')
 const id = randomUUID()
 const answer = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('TEST_FENCE_TIMEOUT')) }, 3000)
  pending.set(id, confirmed => { clearTimeout(timer); resolve(confirmed) })
  process.send({ type: 'fence-request', id, plan })
 })
 if (!answer) throw new Error('TEST_POWER_OFF_UNCONFIRMED')
 return 'test-process:confirmed-exit:' + plan.resourceId
} }
const event = (name, fields = {}) => {
 const record = { at: Date.now(), event: name, ...fields }
 console.log(JSON.stringify(record)); process.send({ type: 'event', record })
}
const runtime = new HaCoordinator(store, cipher, fencer, deadline => process.send({ type: 'ha-heartbeat', deadline }), event)
async function restore() {
 for (const { key } of await runtime.catalog()) {
  if (connections.has(key)) continue
  await runtime.acquireSession(key)
  const auth = await useSharedAuthState(runtime, key)
  if (!auth.state.creds.me?.id) { event('QR_REQUIRED'); throw new Error('TEST_EXPECTED_PAIRED_AUTH') }
  const fingerprint = createHash('sha256').update(JSON.stringify(auth.state.creds.noiseKey, BufferJSON.replacer)).digest('hex')
  const socket = net.connect(Number(process.env.HA_TEST_WITNESS_PORT), '127.0.0.1')
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  const raw = { sendMessage: async () => {
    // Regression: auth/ratchet writes commit inside a send without deadlocking
    // the send permit; they use a different lock from ownership claims.
    await auth.state.keys.set({ 'pre-key': { 'fixture': { public: Buffer.alloc(32, 3), private: Buffer.alloc(32, 4) } } })
    socket.write(JSON.stringify({ type: 'message', node: runtime.identity.nodeId }) + '\n')
    return { key: { id: 'fixture-message' } }
  }, end: () => socket.destroy(), ws: { socket: { readyState: 3, terminate: () => socket.destroy() } } }
  const protectedSocket = runtime.protectSocket(key, raw, () => { socket.destroy(); runtime.markConnected(key, false) })
  connections.set(key, socket); runtime.markConnected(key, true)
  socket.write(JSON.stringify({ type: 'open', key, node: runtime.identity.nodeId, paired: true, fingerprint }) + '\n')
  await protectedSocket.sendMessage()
  event('test_socket_open', { key, node: runtime.identity.nodeId, qr: false })
 }
}
runtime.start(restore).catch(() => { event('WORKER_START_FAILED'); process.exit(1) })
process.on('SIGTERM', async () => { await runtime.shutdown(); process.exit(0) })
