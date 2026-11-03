# TASK — babyshiri-wa-inbound (COWORK-TASK-PACKAGE v1) · Approved by Nizan 2026-11-03
Dev task: `Task: jumpstart-task 446d902e-9bcc-4a5a-8bfb-3d4f9f3a8be9` · Repo: jumpstart (+ jumpstart-whatsapp-service if the secret lives there) · Staging: tyiylxtihzvxooecurwe
Org Baby Shiri 8e93d62f-e612-4642-9298-da90999689ca · wa_devices 48b99cee-5892-4c9a-aaca-a0e89ea48301 (baileys, phone 972526409087, session_key 8e93d62f-…__48b99cee-ffd5acf3).

## Facts (prod, 2026-11-03)
- Sending works. Inbound webhook audit: webhook_audit_status=auth_rejected, http 401, consecutive_failures ≈3,200, last success 2026-10-29 09:27Z. Incoming messages since 29.10 are not stored in JumpStart (wa history / org_messages / contact timeline).

## Do
1. Find why the WA service → JumpStart inbound webhook is rejected for this device (secret mismatch / rotated key / signature format). Fix at the root (no auth bypass, no loosened guard). Check whether other devices have the same failure; fix generically.
2. Verify: a real inbound message to 0526409087 (Nizan sends from 0528393669) appears in Baby Shiri's inbox/contact timeline; audit returns to ok and failures reset.
3. Backfill: if the WA service retained messages since 2026-10-29, replay them idempotently into Baby Shiri (no auto-replies, no automations fired by replay).
4. Staff invites (Nizan asked Cowork to resend): for the 7 Baby Shiri workforce_employees in status pending_activation EXCEPT עדי שירי (her own number is the sending device), resend the standard invite exactly as workforce-api does ('הוזמנת להצטרף לצוות! לכניסה עם מספר הטלפון שלך: https://hub.jumpstart.co.il/field/login'), via the org device, recording workforce_employee_invite reservation + outcome audit. Report per-employee result.
5. RESULT.md + STATE.json (ready_for_cowork). DDL via migration queue only. No other customer sends.
