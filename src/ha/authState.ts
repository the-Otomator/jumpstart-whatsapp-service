import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys'
import type { AuthenticationState, SignalDataSet, SignalDataTypeMap } from '@whiskeysockets/baileys'
import { HaCoordinator } from './coordinator'
// Match legacy Baileys filenames so the offline import preserves key identity.
const itemKey = (type: string, id: string) => (type + '-' + id).replace(/\//g, '__').replace(/:/g, '-')
export async function useSharedAuthState(runtime: HaCoordinator, key: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; flush: () => Promise<void> }> {
  const existing = await runtime.readAuth(key, ['creds'])
  // Missing is allowed only for a newly provisioned/purged test or customer session.
  // Corrupt/missing encryption keys throw; they never silently start a QR flow.
  const creds = existing.creds ? JSON.parse(existing.creds, BufferJSON.reviver) : initAuthCreds()
  let queue = Promise.resolve()
  const write = (values: Record<string, string | null>): Promise<void> => {
    const next = queue.then(() => runtime.writeAuth(key, values))
    queue = next; return next
  }
  return { state: { creds, keys: {
    get: async (type, ids) => {
      await queue
      const items = ids.map(id => itemKey(type, id))
      const records = await runtime.readAuth(key, items)
      const values: { [id: string]: SignalDataTypeMap[typeof type] } = Object.create(null)
      for (const id of ids) {
        const text = records[itemKey(type, id)]
        let value = text ? JSON.parse(text, BufferJSON.reviver) : undefined
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value)
        values[id] = value
      }
      return values
    },
    set: async (data: SignalDataSet) => {
      const values: Record<string, string | null> = Object.create(null)
      for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries || {})) {
        values[itemKey(type, id)] = value == null ? null : JSON.stringify(value, BufferJSON.replacer)
      }
      await write(values)
    },
  } }, saveCreds: () => write({ creds: JSON.stringify(creds, BufferJSON.replacer) }), flush: () => queue }
}
