# Handoff — Next Cowork Session

**Updated:** 2026-04-05

> **Workflow:** Cowork manages and decides. Cursor executes code. Cowork recommends which AI model to use per task.

---

## Current State Summary

### WhatsApp Send Fix — DONE ✅
Edge Function `whatsapp-otomator-send` (on Otomator Supabase `mzalzj…`) now calls
`POST https://wa.otomator.pro/api/messages/send` with `{ orgId, to, message }`.
Legacy fallback paths only fire when `WHATSAPP_TRY_LEGACY_SEND=true`.

**Verified in Supabase (2026-04-05):**
- Edge Function active (v6)
- RPCs live: `get_org_devices`, `add_device`, `delete_device`, `_whatsapp_max_devices_for_plan`
- `central_subscriptions`: 1 active pro sub for nizan@otomator.co.il, org `c3aa7a0d-…`
- `whatsapp_devices`: 1 device, session_key = org_id, status **disconnected**

### VPS State
- CORS + iframe: `ALLOWED_ORIGINS` drives `cors()` and Helmet `frameAncestors`. If empty → browser errors on localhost.
- Helmet `crossOriginResourcePolicy`: `cross-origin` for fetch to `/connect/.../status`.

---

## Pending Actions (priority order)

### 1. Clean up `jumpstart-whatsapp-service` working tree
**Repo:** `jumpstart-whatsapp-service`
**Branch:** `feature/supabase-org-validation`
**Problem:** Staged and unstaged changes overlap on same files (.env.example, DEPLOY.md, src/index.ts).
**Action in Cursor (Sonnet):**
```bash
# Unstage everything to start clean
git reset HEAD

# Review all changes
git diff

# Commit in logical groups:
# Commit 1: Core features
git add src/routes/sessions.ts src/routes/messages.ts src/middleware/validate.ts src/routes/connect.ts src/index.ts
git commit -m "feat: session-path send alias, migrate, purge, Supabase org validation"

# Commit 2: Ops/infra
git add Dockerfile docker-compose.yml .env.example DEPLOY.md
git commit -m "ops: Docker + nginx hardening, env docs, deploy guide"

# Commit 3: Docs
git add CLAUDE.md PLAN.md HANDOFF-NEXT-SESSION.md
git commit -m "docs: update project docs and handoff"

git push origin feature/supabase-org-validation
```
**Report branch to Cowork for merge review.**

### 2. Commit otomator-admin migration file
**Repo:** `otomator-admin`
**Branch:** `feature/whatsapp-session-edit`
**Action in Cursor (Sonnet):**
```bash
git add supabase/migrations/20260405120000_whatsapp_hub_rpc_bootstrap.sql
git add CLAUDE.md
git commit -m "docs: add Hub RPC bootstrap migration + CLAUDE.md updates"
git push origin feature/whatsapp-session-edit
```

### 3. VPS redeploy (optional — for session-path send alias)
The new `POST /api/sessions/:orgId/send` route only exists after VPS Docker rebuild.
Edge Function already uses `/api/messages/send` as primary — alias is for backward compat only.
```bash
cd /opt/whatsapp-service
git pull
docker compose up -d --build
curl -sS https://wa.otomator.pro/health
```

### 4. Connect WhatsApp session for E2E test
Device status is **disconnected**. Before testing the full send flow:
1. otomator-admin → WhatsApp → "Open QR" on the device
2. Scan QR with WhatsApp on phone
3. Verify status → "connected"
4. Hub CRM: Contact → Messages → WhatsApp → send → success toast + row in `contact_messages`

### 5. Decide next feature work
Options from PROGRESS.md:
- **Deals pipeline UI** — CRM pipeline board view
- **Events CRUD** — event management in Hub
- **WhatsApp admin improvements** — subscription management, webhook monitoring

---

## Repo Branch Summary

| Repo | Branch | Status |
|------|--------|--------|
| `jumpstart-whatsapp-service` | `feature/supabase-org-validation` | Messy tree — needs cleanup commits (#1) |
| `otomator-admin` | `feature/whatsapp-session-edit` | 2 uncommitted files — needs commit (#2) |
| `jumpstart-app` | (latest) | Clean — Edge Function deployed |

---

## API Contract (canonical)

**Primary send:**
```
POST https://wa.otomator.pro/api/messages/send
Authorization: Bearer <API_SECRET>
{ "orgId": "<session_key>", "to": "9725XXXXXXXX", "message": "text" }
```

**Alias (after VPS rebuild):**
```
POST https://wa.otomator.pro/api/sessions/<ORG_ID>/send
Authorization: Bearer <API_SECRET>
{ "to": "9725XXXXXXXX", "message": "text" }
```

`to` format: digits only, no `+`, 10–15 chars.

---

## Supabase Quick Reference

| Project | ID | Role |
|---------|----|------|
| Jumpstart platform | `dgxnnwnugdxzeopleera` | Auth, users, orgs, CRM, Edge Functions |
| Otomator Hub | `mzalzjtsyrjycaxolldv` | central_subscriptions, whatsapp_devices, RPCs, whatsapp-otomator-send |

---

## Model Recommendations for Cursor

| Task type | Recommended model |
|-----------|-------------------|
| Simple file edits, git cleanup, commits | **Sonnet** (fast, accurate) |
| Multi-file refactors, new features | **Opus** (better reasoning) |
| Quick questions, code review | **Sonnet** |
| Supabase migrations, RLS policies | **Opus** (security-critical) |

---

## Related docs
- `otomator-admin/docs/WHATSAPP-INTEGRATION-PROGRESS.md` — full cross-repo picture
- `jumpstart-app/PROGRESS.md` — app-level state and migration status
