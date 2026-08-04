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

## Inbound media cache

On inbound image/video/audio/document/sticker messages, Baileys downloads the file at receive time
(decryption keys live on the message object and are not fetchable later) into
`sessions/<orgId>/media/<messageId>.<ext>` on the `sessions-data` volume.

The webhook payload then includes:

| Field | Meaning |
|-------|---------|
| `mediaType` | `image` / `video` / `audio` / `document` / `sticker` |
| `mediaUrl` | `https://<WA_HOST>/api/media/<orgId>/<messageId>` (when a cache file was written) |
| `mediaMime` | MIME from the Baileys message node |
| `mediaSize` | Size in bytes when known |
| `mediaFilename` | Filename from document message, or a synthetic `<type>.<ext>` |
| `mediaTooLarge` | `true` when over 16MB — metadata only, no file |

### Authenticated media fetch

```
GET /api/media/:orgId/:messageId
Authorization: Bearer <API_SECRET>
```

Streams the cached file (`Content-Type`, `Content-Length`, `Content-Disposition`).  
`orgId` and `messageId` are restricted to `[A-Za-z0-9._-]{1,200}` (rejects `../` and path separators).  
404 when the cache file is missing. The Hub Edge Function `wa-webhook` fetches this URL and uploads to R2.

Cached media is a hand-off buffer, not durable storage — prune with `WA_MEDIA_TTL_DAYS` (default **7**).
