import { jumpstartSupabase } from './jumpstartSupabase'
import { createDeviceObserver, type DeviceObservation } from './waDeviceObservation'
const observe = jumpstartSupabase ? createDeviceObserver(jumpstartSupabase) : null
export async function observeWaDevice(sessionKey: string, observation: DeviceObservation) {
  return observe ? observe(sessionKey, observation) : {data: false, error: null}
}
