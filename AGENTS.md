# Jumpstart WhatsApp Service

<!-- COWORK-EXEC-CONTRACT v2 — RELEASE WINDOWS (canonical text, identical in every repo) -->
## Release windows — production changes only at night

**Production vs everything else.** Production = the `main`/`master` branch and whatever it deploys. Everything else — feature branches and their preview links — can change at any hour.
**One feature = one branch.** Every feature, upgrade or addition gets its own branch from the latest production branch (`feature/<name>`, `fix/<name>`). Never put two features in one branch or PR. A fix or addition to a feature that is not merged yet goes on that feature's own branch; once the feature is merged, the next addition gets a new branch. Every push to a feature branch auto-publishes its own preview link (see "This repo"); put the link in result.md. Merging to production happens only at night (below).

**Window:** 23:00–06:00 Asia/Jerusalem, every night.

Inside the window only:
- merging a PR to `main` in a repo where merge auto-deploys to production (see "This repo" below);
- any production frontend/app deploy (Cloudflare Pages `--branch main`, Lovable, SSH deploy, `wrangler deploy`);
- any Supabase Edge Function deploy to `dgxnnwnugdxzeopleera` or `mzalzjtsyrjycaxolldv`;
- any database schema change. JumpStart DB (`dgxnnwnugdxzeopleera`): ONLY through the production migration queue (`public.migration_queue_submit`), never applied directly. otomator-admin DB (`mzalzjtsyrjycaxolldv`): inside the window only.

Allowed at any hour: build, test, commit, push branches, open/update PRs, preview deploys (never the production project), read-only queries.

**Off-window exception:** only when the task file contains the exact line
`Off-window approved by Nizan: <YYYY-MM-DD HH:MM> — <reason>`
Cowork writes that line only after Nizan approved it explicitly in chat. "Authorized now: merge/deploy" alone does NOT override the window.

**If the window blocks you:** stop right before the gated action, finish everything else, and write `Pending night window: <action>` in result.md. Do not wait, loop or sleep until the window.

**Never:** add the `off-window-approved` label yourself, disable/skip/re-run-to-bypass the `release-window` check, use admin/bypass merge, or push directly to `main`.

**Night releases (how merges actually happen):** a PR that only needs merging is merged by the `nightly-merge` workflow at 23:15 IL — after Nizan approves it in otomator-admin → "שחרורי לילה". Your job ends at "PR ready": report the PR number and write `Pending night window: merge (approve PR #<n> in Night releases)` in result.md.
If the PR needs steps after the merge (Edge Function deploy, migration-queue submit, live verification, anything beyond the merge itself), put the line `Release: manual` in the PR body; such PRs are never auto-merged and the task file's night phase is run in Cursor instead.
**Never:** approve, unapprove or pause anything in Night releases, write to the `release_*` tables, or edit `nightly-merge.yml` / `release-window.yml` to weaken them.

**Release levels (automatic, never set by hand):** every PR gets a `level:N-…` label + `release-level` status from the `release-level` workflow (rules on the base branch, `.github/release-levels.conf`):
L0 docs · L1 safe-ui (screens only, no dependencies/config/sensitive files, calls nothing new on the server) · L2 sensitive (login, billing, routing, build config, dependencies, workflows, unclassified paths, or a server name the base branch never used) · L3 server (Edge Functions, Pages Functions, workers) · L4 database (migrations → migration queue).
Only L0/L1 may be released during the day, and only when Nizan presses "למזג עכשיו" in Night releases for a repo where day merges are on. Everything else merges at night. Keep L1 PRs small and screens-only so they can go out by day; put server/DB work in its own PR.
**Never:** add/remove `level:*` labels, post a `release-level` or `release-window` status yourself, or edit `.github/release-levels.conf` / `.github/scripts/release-level.sh` to lower a level.

### This repo
Merging does NOT deploy. Production deploy is a manual SSH deploy to the WhatsApp server — **only inside the window** (or with the off-window line). A service restart disconnects WhatsApp sessions, so this matters as much as a frontend deploy.


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
