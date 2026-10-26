import assert from 'node:assert/strict'
import { acceptHistoryPage, requestHistoryPage, historyMessage } from './historyPull'

const anchor = { id: 'anchor', remoteJid: '972500000000@s.whatsapp.net', fromMe: false }
const inbound = { key: { ...anchor, id: 'in' }, message: { conversation: 'הסר' }, messageTimestamp: 100 }
const outbound = { key: { ...anchor, id: 'out', fromMe: true }, message: { conversation: 'reply' }, messageTimestamp: 101 }

async function main() {
  let calls = 0
  for (const override of [{ enabled: false }, { connected: false }, { anchor: null }, { anchor: { ...anchor, remoteJid: '123@g.us' } }]) {
    await assert.rejects(requestHistoryPage({ session: 'closed', enabled: true, connected: true, anchor,
      timestampMs: 200000, fetch: async () => { calls++; return 'none' }, ...override }), /HISTORY_GATE_CLOSED/)
  }
  assert.equal(calls, 0)
  console.log('PASS AC-03: missing anchor, disconnected, switch off and group => zero Baileys calls')
  let now = 0
  const times: number[] = []
  for (let i = 0; i < 3; i++) {
    const id = `request-${i}`
    const request = requestHistoryPage({ session: 'pace', enabled: true, connected: true, anchor, timestampMs: 200000,
      now: () => now, sleep: async ms => { now += ms }, fetch: async () => {
        times.push(now)
        setImmediate(() => {
          assert.equal(acceptHistoryPage('pace', { messages: [inbound], syncType: 3, peerDataRequestSessionId: id }), false)
          assert.equal(acceptHistoryPage('pace', { messages: [inbound], syncType: 6, peerDataRequestSessionId: 'unrelated' }), false)
          assert.equal(acceptHistoryPage('pace', { messages: [inbound, outbound], syncType: 6, peerDataRequestSessionId: id }), true)
        })
        return id
      },
    })
    await assert.rejects(requestHistoryPage({ session: 'pace', enabled: true, connected: true, anchor, timestampMs: 200000,
      fetch: async () => { throw new Error('parallel fetch') } }), /HISTORY_BUSY/)
    const rows = await request
    assert.deepEqual(rows.map(historyMessage).map(row => row?.fromMe), [false, true])
    assert.ok(rows.map(historyMessage).every(row => row?.isBackfill === true && row?.observed === false && row?.source === 'history-pull'))
  }
  assert.deepEqual(times, [0, 5000, 10000])
  console.log('PASS AC-02: correlated on-demand both directions; automatic and unrelated history ignored')
  console.log('PASS AC-04: never two in flight; three requests at 0ms, 5000ms, 10000ms')
  await assert.rejects(requestHistoryPage({ session: 'timeout', enabled: true, connected: true, anchor, timestampMs: 200000,
    timeoutMs: 5, fetch: async () => 'no-answer' }), /HISTORY_PHONE_OFFLINE/)
  await assert.rejects(requestHistoryPage({ session: 'recheck', enabled: true, connected: true, anchor, timestampMs: 200000,
    authorize: async () => false, fetch: async () => { throw new Error('must not reach phone') } }), /HISTORY_GATE_CLOSED/)
  console.log('PASS bounded no-answer and last-moment authorization check')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
