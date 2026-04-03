📋 משימה ל-Claude Code
─────────────────────
שם: Add WhatsApp Sessions Management Page to otomator-admin
Branch: feature/whatsapp-sessions-page

## Context

The otomator-admin portal (Cloudflare Pages) needs a new page to manage all WhatsApp service instances.
A Supabase Edge Function `whatsapp-proxy` is already deployed and handles secure proxying to the WhatsApp service — the admin frontend should NEVER call wa.otomator.pro directly.

### Infrastructure ready:
- **Supabase project:** `mzalzjtsyrjycaxolldv`
- **Supabase URL:** `https://mzalzjtsyrjycaxolldv.supabase.co`
- **Supabase anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YWx6anRzeXJqeWNheG9sbGR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzAzMTUsImV4cCI6MjA5MDMwNjMxNX0.Jzar1LcYcUj05SrKWOQX09QB6pZKDBrSkAp2-hhuK_Y`
- **Edge Function:** `whatsapp-proxy` (deployed, verify_jwt=true)
- **Test subscription:** org_id=`test-org`, product=`whatsapp-service`, status=`active`

### Edge Function usage:

All calls to the WhatsApp service go through the Edge Function. The frontend calls it like this:

```typescript
const { data, error } = await supabase.functions.invoke('whatsapp-proxy', {
  body: {
    path: '/api/sessions',       // the WhatsApp service API path
    method: 'GET',               // HTTP method
    body: { ... }                // optional request body (for POST/DELETE)
  }
})
```

Available paths:
- `GET /health` → `{ status, sessions, connected, uptime, memoryMB }`
- `GET /api/sessions` → `{ sessions: [...], count }`
- `GET /api/sessions/:orgId/status` → session status object
- `POST /api/sessions/:orgId/start` → start a session (body: `{ webhookUrl?, autoRestore? }`)
- `DELETE /api/sessions/:orgId` → stop a session
- `GET /api/sessions/:orgId/webhook-failures` → `{ failures: [...], count }`

### Supabase query for subscriptions:

```typescript
const { data: subscriptions } = await supabase
  .from('central_subscriptions')
  .select('org_id, organization_name, user_email, plan, status, sumit_token, started_at, expires_at')
  .eq('product_id', 'dcb75b3d-b326-4803-bed8-0532727313cb')  // whatsapp-service product ID
  .order('started_at', { ascending: false })
```

---

## מה לעשות:

### 1. Create the WhatsApp management page

Route: `/admin/whatsapp` (or wherever the admin routing pattern places it)

#### Section 1 — Service Health Banner

A top bar showing real-time service health from `GET /health`:

```
● WhatsApp Service  |  3 sessions  |  2 connected  |  Uptime 2h 14m  |  RAM 128MB
```

- Green dot if status=ok, red if unreachable
- Poll every 30 seconds
- Show "Service unreachable" if the call fails

#### Section 2 — Sessions Table

A table showing all active WhatsApp sessions from `GET /api/sessions`:

| org_id | Organization | Phone | Status | Actions |
|--------|-------------|-------|--------|---------|
| test-org | Otomator Test | +972-50-123-4567 | 🟢 Connected | Disconnect |
| beta-org | Beta Inc | — | 🟡 Waiting QR | Open QR / Disconnect |
| gamma | Gamma Co | — | 🔴 Disconnected | Reconnect |

**Status indicators:**
- `connected` → 🟢
- `qr` → 🟡
- `connecting` → 🟡 (spinner)
- `disconnected` → 🔴

**Actions:**
- **Open QR** → opens `https://wa.otomator.pro/connect/:orgId` in a new tab
- **Disconnect** → calls `DELETE /api/sessions/:orgId` via proxy (with confirm dialog)
- **Reconnect** → calls `POST /api/sessions/:orgId/start` via proxy

**Auto-refresh:** poll `GET /api/sessions` every 10 seconds

#### Section 3 — Subscriptions Table

Below the sessions, show all WhatsApp subscriptions from Supabase `central_subscriptions`:

| org_id | Organization | Email | Plan | Status | Started | Expires |
|--------|-------------|-------|------|--------|---------|---------|

Show status badges: `active` = green, `cancelled` = red, `expired` = gray, `trial` = blue

### 2. Enrich the sessions table with subscription data

Cross-reference the sessions API data with subscription data:
- If a session exists but no subscription → show ⚠️ "No subscription"
- If a subscription exists but no active session → show "Offline" in sessions table

### 3. Navigation

Add a "WhatsApp" item to the admin sidebar/nav linking to the new page. Use a chat/phone icon.

---

## קבצים רלוונטיים:
- Wherever pages/routes are defined in the admin project
- Supabase client configuration file
- Navigation/sidebar component

## אל תגע ב:
- Supabase Edge Functions (already deployed)
- WhatsApp service code (separate repo)
- Supabase schema/migrations (already set up)

## Stack notes:
- The admin is on Cloudflare Pages — check the existing framework (likely React/Vue + Supabase client)
- Follow the existing design patterns and component library used in the project
- Use the existing Supabase client instance — don't create a new one

## לאחר הביצוע:
- Run the build command — must be zero errors
- Test locally: verify the health banner shows data and sessions table renders
- Report: what was done, any errors, branch name, preview URL if available
