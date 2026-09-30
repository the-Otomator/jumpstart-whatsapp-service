# Jumpstart WhatsApp Service

Multi-tenant WhatsApp microservice built on Baileys (unofficial WhatsApp Web API).

## Production server

| | |
|---|---|
| **Host** | `wa-prod-1` — Hetzner CCX13, Nuremberg |
| **IP** | `178.104.118.178` |
| **Domain** | `wa.otomator.pro` (Cloudflare proxied — orange cloud ON) |
| **SSL** | nginx TLS at `/etc/nginx/ssl/`; Cloudflare Origin CA replacement + Full (strict) remain pending |
| **App dir** | `/opt/whatsapp-service` |
| **Logs** | `cd /opt/whatsapp-service && docker compose logs -f` |
| **Health** | `https://wa.otomator.pro/health` |
| **SSH** | `ssh deploy@178.104.118.178` (key only; production deploys use the non-root sudo user) |
| **Firewall** | Hetzner `wa-fw` + UFW: public key-only SSH with fail2ban; HTTP(S) from Cloudflare only |
| **Backup** | Nightly encrypted `sessions-data`, app environment, and nginx config to private R2 `wa-backups`; 14-day retention |

> Previous server (decommissioned): Hostinger 147.93.127.180

## Quick reference

- **Build**: `npm run build` (TypeScript → `dist/`)
- **Dev**: `npm run dev`
- **Start**: `npm start`
- **Docker**: `docker compose up --build`
- **Deploy to prod**: `ssh deploy@178.104.118.178 "cd /opt/whatsapp-service && sudo ./scripts/deploy.sh"`
- **Backup status**: `ssh deploy@178.104.118.178 "sudo cat /var/lib/wa-backup/last_status"`

## Architecture

```
src/
  index.ts              — Express app entry, auto-restore, graceful shutdown
  auth.ts               — Bearer token auth middleware
  sessionManager.ts     — Baileys socket lifecycle, incoming message handler
  types.ts              — Shared TypeScript interfaces
  lib/
    logger.ts           — pino structured logger
    sessionStore.ts     — JSON file store for session auto-restore
    shutdown.ts         — Graceful SIGTERM/SIGINT handler
    webhookDispatcher.ts— Webhook POST with retries
  middleware/
    requestId.ts        — x-request-id propagation
    validate.ts         — Zod request validation
  routes/
    sessions.ts         — /api/sessions CRUD
    messages.ts         — /api/messages send + send-bulk with media
    groups.ts           — /api/groups create/add/remove/promote/demote/send/metadata + settings
    contacts.ts         — /api/contacts/:phone/profile + /exists (picture, About, business profile)
```

## Key conventions

- All API routes under `/api` require `Authorization: Bearer <API_SECRET>`
- Session auth state persisted in `sessions/<orgId>/` (gitignored)
- Never commit `.env` or `sessions/` directory
- Incoming WhatsApp messages forwarded to org's webhookUrl
