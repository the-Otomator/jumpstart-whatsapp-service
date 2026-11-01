export const ALERT_ORG_ID = 'c3aa7a0d-461a-4ed4-882a-58bd063b1e62';
export type AlertResult = { ok: boolean; reason?: string; messageId?: string };

/** A session key is an opaque device identifier, never an organization ID. */
export async function gateOtomatorAlert(db: any, session: string | undefined, org: string | undefined): Promise<AlertResult> {
  if (org !== ALERT_ORG_ID) return { ok: false, reason: 'otomator_org_not_allowed' };
  if (!session?.trim()) return { ok: false, reason: 'wa_session_not_configured' };
  try {
    const { data, error } = await db.from('wa_devices')
      .select('organization_id,status,listen_only').eq('session_key', session).limit(2);
    if (error || !Array.isArray(data) || data.length !== 1) return { ok: false, reason: 'wa_device_not_found' };
    if (data[0].organization_id !== ALERT_ORG_ID) return { ok: false, reason: 'wa_device_not_otomator' };
    if (data[0].listen_only !== false) return { ok: false, reason: 'wa_device_listen_only' };
    if (data[0].status !== 'connected') return { ok: false, reason: 'wa_device_not_connected' };
    return { ok: true };
  } catch { return { ok: false, reason: 'wa_device_lookup_failed' }; }
}

export async function deliverOtomatorAlert(db: any, session: string | undefined, org: string | undefined,
  sendWa: () => Promise<AlertResult>, sendEmail: () => Promise<AlertResult>): Promise<AlertResult> {
  let wa = await gateOtomatorAlert(db, session, org);
  if (wa.ok) {
    try { wa = await sendWa(); } catch { wa = { ok: false, reason: 'wa_send_threw' }; }
  }
  if (wa.ok) return wa;
  console.warn('otomator_alert_whatsapp_skipped', { reason: wa.reason });
  let email: AlertResult;
  try { email = await sendEmail(); } catch { email = { ok: false, reason: 'platform_email_threw' }; }
  return { ...email, reason: `whatsapp:${wa.reason ?? 'send_failed'};email:${email.ok ? 'sent' : email.reason ?? 'failed'}` };
}
