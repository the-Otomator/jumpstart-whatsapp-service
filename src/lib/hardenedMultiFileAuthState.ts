/**
 * Production-oriented multi-file auth state for Baileys.
 *
 * Replaces stock useMultiFileAuthState because that helper:
 * - documents itself as "not for production"
 * - writes with non-atomic writeFile (torn reads on crash)
 * - only mutexes in-process; no cross-process single-writer guard
 *
 * This module keeps the same folder layout (creds.json + type-id.json keys) so
 * existing sessions remain readable, but:
 * - all writes go temp → rename (atomic on same filesystem)
 * - a global per-folder write queue serializes saveCreds + key writes
 * - caller must hold sessionAuthLock before opening
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  proto,
  initAuthCreds,
  BufferJSON,
} from '@whiskeysockets/baileys'
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys'

function fixFileName(file?: string): string {
  return (file ?? '').replace(/\//g, '__').replace(/:/g, '-')
}

/**
 * Per-folder promise chain — serializes all auth file mutations for one session.
 * Independent of Baileys' in-process Mutex; covers saveCreds + keys.set concurrency.
 */
const folderQueues = new Map<string, Promise<void>>()

function enqueueWrite(folder: string, task: () => Promise<void>): Promise<void> {
  const prev = folderQueues.get(folder) ?? Promise.resolve()
  const next = prev
    .catch(() => {
      // keep queue alive after a prior failure
    })
    .then(task)
  folderQueues.set(
    folder,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const body = JSON.stringify(data, BufferJSON.replacer)
  await writeFile(tmp, body, 'utf-8')
  await rename(tmp, filePath)
}

export interface HardenedAuthState {
  state: AuthenticationState
  saveCreds: () => Promise<void>
  /** Drain the write queue (tests / graceful shutdown). */
  flush: () => Promise<void>
}

export async function useHardenedMultiFileAuthState(folder: string): Promise<HardenedAuthState> {
  const folderInfo = await stat(folder).catch(() => null)
  if (folderInfo) {
    if (!folderInfo.isDirectory()) {
      throw new Error(
        `found something that is not a directory at ${folder}, either delete it or specify a different location`
      )
    }
  } else {
    await mkdir(folder, { recursive: true })
  }

  const writeData = async (data: unknown, file: string): Promise<void> => {
    const filePath = join(folder, fixFileName(file))
    await enqueueWrite(folder, () => atomicWriteJson(filePath, data))
  }

  const readData = async (file: string): Promise<unknown | null> => {
    try {
      const filePath = join(folder, fixFileName(file))
      const data = await readFile(filePath, { encoding: 'utf-8' })
      return JSON.parse(data, BufferJSON.reviver)
    } catch {
      return null
    }
  }

  const removeData = async (file: string): Promise<void> => {
    const filePath = join(folder, fixFileName(file))
    await enqueueWrite(folder, async () => {
      try {
        await unlink(filePath)
      } catch {
        // missing is fine
      }
    })
  }

  const creds: AuthenticationCreds =
    ((await readData('creds.json')) as AuthenticationCreds | null) || initAuthCreds()

  const saveCreds = async (): Promise<void> => {
    await writeData(creds, 'creds.json')
  }

  const flush = async (): Promise<void> => {
    await (folderQueues.get(folder) ?? Promise.resolve())
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value as SignalDataTypeMap[typeof type]
            })
          )
          return data
        },
        set: async (data: SignalDataSet) => {
          // Serialize the whole batch on the folder queue so concurrent set/saveCreds cannot interleave mid-file.
          await enqueueWrite(folder, async () => {
            for (const category of Object.keys(data) as (keyof SignalDataSet)[]) {
              const categoryData = data[category]
              if (!categoryData) continue
              for (const id of Object.keys(categoryData)) {
                const value = categoryData[id]
                const file = `${category}-${id}.json`
                const filePath = join(folder, fixFileName(file))
                if (value) {
                  await atomicWriteJson(filePath, value)
                } else {
                  try {
                    await unlink(filePath)
                  } catch {
                    // missing ok
                  }
                }
              }
            }
          })
        },
      },
    },
    saveCreds,
    flush,
  }
}

/** Test helper: number of folders with a pending/idle queue entry. */
export function authWriteQueueSize(): number {
  return folderQueues.size
}
