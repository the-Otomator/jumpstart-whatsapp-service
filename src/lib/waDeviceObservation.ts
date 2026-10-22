/** Shared protocol with wa-webhook; DB remains the cross-instance authority. */
export interface DeviceObservation {
  status?: string;
  refreshSeen?: boolean;
  audit?: Record<string, unknown>;
  phoneNumber?: string | null;
  lastError?: string | null;
  clearError?: boolean;
}
export interface DeviceRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export function isHistoryObservation(payload: Record<string, unknown>): boolean {
  return payload.history === true || payload.isBackfill === true || payload.is_backfill === true ||
    payload.skipDownstream === true;
}
export function createDeviceObserver(client: DeviceRpcClient, clock = Date.now) {
  const attempts = new Map<string, number>();
  return async (sessionKey: string, observation: DeviceObservation = {}) => {
    const at = clock(), last = attempts.get(sessionKey);
    const due = last === undefined || at - last >= 30_000;
    if (!due && !observation.status) return { data: false, error: null };
    if (due) {
      if (attempts.size >= 4096) attempts.delete(attempts.keys().next().value!);
      attempts.set(sessionKey, at); // Reserve before awaiting; no per-event promise queue.
    }
    try {
      const result = await client.rpc("wa_devices_observe", {
        p_session_key: sessionKey,
        p_status: observation.status ?? null,
        p_refresh_seen: due && observation.refreshSeen !== false,
        p_audit: due ? observation.audit ?? null : null,
        p_phone_number: observation.phoneNumber ?? null,
        p_last_error: observation.lastError ?? null,
        p_clear_error: observation.clearError === true,
      });
      if (result.error && due && attempts.get(sessionKey) === at) attempts.delete(sessionKey);
      return result;
    } catch (error) {
      if (due && attempts.get(sessionKey) === at) attempts.delete(sessionKey);
      throw error;
    }
  };
}
