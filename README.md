# jumpstart-whatsapp-service

**Baileys-only** WhatsApp gateway for JumpStart unofficial (QR-linked) devices.

## Scope (2026-06-27)

| Path | Status |
|------|--------|
| `/connect`, `/api/sessions`, `/api/messages`, Baileys providers | **Active** |
| `/meta-webhook`, `/webhooks/meta`, `/api/meta/*`, `provider=meta-cloud` session start | **Deprecated (410)** |

Official **Meta Cloud API** (onboarding, inbound webhook, outbound send, session health) is handled entirely by **JumpStart Supabase Edge Functions** on `dgxnnwnugdxzeopleera`:

- `whatsapp-onboard` — connect / disconnect accounts
- `wa-webhook` — Meta webhook (`verify_jwt=false`), Baileys inbound
- `wa-meta-send` — Graph outbound
- `wa-meta-session-status` — Graph health poll

Public URLs (custom domain): `https://api.jumpstart.co.il/functions/v1/*`

This VPS remains at **`https://wa.otomator.pro`** for Baileys sessions only.
