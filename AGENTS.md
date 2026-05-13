# Jumpstart WhatsApp Service

Multi-tenant WhatsApp microservice built on Baileys (unofficial WhatsApp Web API).

## Quick reference

- **Build**: `npm run build` (TypeScript → `dist/`)
- **Dev**: `npm run dev`
- **Start**: `npm start`
- **Docker**: `docker compose up --build`

## Architecture

```
src/
  index.ts              — Express app entry, auto-restore, graceful shutdown
  auth.ts               — Bearer token auth middleware
  sessionManager.ts     — Baileys socket lifecycle, incoming message handler
  types.ts              — Shared TypeScript interfaces
  lib/
    logger.ts           — pino structured logger
    metaClient.ts       — Stateless Meta Graph API wrapper for template CRUD
    metaWebhookVerify.ts— HMAC-SHA256 signature verification for Meta webhooks
    sessionStore.ts     — JSON file store for session auto-restore
    shutdown.ts         — Graceful SIGTERM/SIGINT handler
    templateCache.ts    — In-memory template cache (5-min TTL per org)
    webhookDispatcher.ts— Webhook POST with retries
  middleware/
    requestId.ts        — x-request-id propagation
    validate.ts         — Zod request validation
  routes/
    sessions.ts         — /api/sessions CRUD
    messages.ts         — /api/messages send + send-bulk with media
    groups.ts           — /api/groups create/add/remove/promote/demote/send/metadata + settings
    contacts.ts         — /api/contacts/:phone/profile + /exists (Baileys profile lookups, 6h cache)
    templates.ts        — /api/templates CRUD (proxy to Meta Graph API)
    webhooks.ts         — /webhooks/meta receiver (HMAC-verified, template status events)
    meta-webhook.ts     — /meta-webhook legacy receiver (messages + statuses)
```

## Key conventions

- All API routes under `/api` require `Authorization: Bearer <API_SECRET>`
- Session auth state persisted in `sessions/<orgId>/` (gitignored)
- Never commit `.env` or `sessions/` directory
- Incoming WhatsApp messages forwarded to org's webhookUrl

## Templates API

Stateless proxy to Meta Graph API for WhatsApp template management. Caller provides per-tenant Meta credentials on every request (VPS stores nothing).

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/templates` | Bearer | Create + submit template to Meta |
| `GET` | `/api/templates?orgId=…` | Bearer | List templates (5-min cache) |
| `GET` | `/api/templates/:name?orgId=…` | Bearer | Single template detail |
| `POST` | `/api/templates/sync` | Bearer | Force re-pull from Meta |
| `DELETE` | `/api/templates/:name?orgId=…` | Bearer | Delete template from Meta |
| `GET` | `/webhooks/meta` | Public | Meta webhook verification handshake |
| `POST` | `/webhooks/meta` | HMAC | Template status update receiver |

### Credential passing

- **POST / DELETE**: pass `meta: { accessToken, wabaId }` in the request body.
- **GET**: pass `x-meta-access-token` and `x-meta-waba-id` as request headers.

### curl examples

```bash
# Create a template
curl -X POST https://wa.otomator.pro/api/templates \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "orgId": "wm-abc123",
    "name": "appointment_reminder",
    "language": "he",
    "category": "UTILITY",
    "components": [
      { "type": "BODY", "text": "שלום {{1}}, תזכורת לפגישה ב-{{2}}." }
    ],
    "meta": { "accessToken": "EAA...", "wabaId": "123456789" }
  }'

# List templates (cached)
curl https://wa.otomator.pro/api/templates?orgId=wm-abc123 \
  -H "Authorization: Bearer $API_SECRET" \
  -H "x-meta-access-token: EAA..." \
  -H "x-meta-waba-id: 123456789"

# Force sync
curl -X POST https://wa.otomator.pro/api/templates/sync \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "orgId": "wm-abc123", "meta": { "accessToken": "EAA...", "wabaId": "123456789" } }'

# Delete
curl -X DELETE "https://wa.otomator.pro/api/templates/appointment_reminder?orgId=wm-abc123" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "meta": { "accessToken": "EAA...", "wabaId": "123456789" } }'
```

### Environment variables (VPS)

| Var | Purpose |
|-----|---------|
| `META_APP_SECRET` | HMAC verification for `/webhooks/meta` (Meta App → Settings → Basic → App Secret) |
| `META_GRAPH_BASE` | Graph API base URL, default `https://graph.facebook.com/v21.0` |
