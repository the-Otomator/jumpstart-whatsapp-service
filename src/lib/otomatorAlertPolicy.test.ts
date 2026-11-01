import { test } from 'node:test';
import { ALERT_ORG_ID, deliverOtomatorAlert, gateOtomatorAlert } from './otomatorAlertPolicy';
function assert(ok: unknown, message = 'assertion failed'): asserts ok { if (!ok) throw new Error(message); }
function registry(data: unknown, error: unknown = null, throws = false) {
  return { from(table: string) { assert(table === 'wa_devices'); return { select() { return { eq(key: string, value: string) {
    assert(key === 'session_key' && value === 'configured-session');
    return { limit: async (n: number) => { assert(n === 2); if (throws) throw new Error('unavailable'); return { data, error }; } };
  } }; } }; } };
}
const own = { organization_id: ALERT_ORG_ID, status: 'connected', listen_only: false };
  test('foreign configured device cannot send; platform email gets the alert', async () => {
    let whatsapp = 0, email = 0;
    const result = await deliverOtomatorAlert(registry([{ ...own, organization_id: 'customer' }]), 'configured-session', ALERT_ORG_ID,
      async () => { whatsapp++; return { ok: true }; }, async () => { email++; return { ok: true }; });
    assert(!whatsapp && email === 1 && result.ok && result.reason?.includes('wa_device_not_otomator'));
  });
for (const [name, db] of [
  ['missing', registry([])], ['ambiguous', registry([own, own])], ['error', registry([own], {})],
  ['throws', registry(null, null, true)], ['disconnected', registry([{ ...own, status: 'disconnected' }])],
  ['listen-only', registry([{ ...own, listen_only: true }])], ['unknown-policy', registry([{ ...own, listen_only: null }])],
] as const) test(`fail closed: ${name}`, async () => { assert(!(await gateOtomatorAlert(db, 'configured-session', ALERT_ORG_ID)).ok); });
test('foreign expected org cannot authorize its own device; empty config fails closed', async () => {
  assert(!(await gateOtomatorAlert(registry([own]), 'configured-session', 'customer')).ok);
  assert(!(await gateOtomatorAlert(registry([own]), '', ALERT_ORG_ID)).ok);
});
test('healthy own device sends once; no email needed', async () => {
  let wa = 0, email = 0;
  const result = await deliverOtomatorAlert(registry([own]), 'configured-session', ALERT_ORG_ID,
    async () => { wa++; return { ok: true }; }, async () => { email++; return { ok: true }; });
  assert(result.ok && wa === 1 && email === 0);
});
test('transport exception falls back; both channels failing preserve reasons', async () => {
  const result = await deliverOtomatorAlert(registry([own]), 'configured-session', ALERT_ORG_ID,
    async () => { throw new Error('offline'); }, async () => ({ ok: false, reason: 'email_unavailable' }));
  assert(!result.ok && result.reason === 'whatsapp:wa_send_threw;email:email_unavailable');
});
