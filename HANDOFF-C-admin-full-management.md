# Handoff C — Complete WhatsApp Service Management in otomator-admin

> **For:** Cursor (otomator-admin repo at `c:\Users\Me\projects\otomator-admin`)
> **Status of previous work:** HANDOFF-A (feature/whatsapp-sessions-page, commit 50940e0) is done — sessions table + health banner + basic actions exist.
> **This handoff:** Add all missing management capabilities to make the admin portal a complete control panel for the WhatsApp service.

---

## What Already Exists (Don't Rebuild)

From HANDOFF-A:
- Page at `/admin/whatsapp` (or `/admin/sessions`)
- `GET /health` → Service Health Banner (uptime, sessions count, RAM)
- `GET /api/sessions` → Sessions table with status + auto-polling
- Actions per session: Disconnect (`DELETE /api/sessions/:orgId`), Reconnect (`POST /api/sessions/:orgId/start`), Open QR link
- Supabase `central_subscriptions` table read-only view
- Supabase Edge Function `whatsapp-proxy` is already deployed and working

---

## Architecture — How API Calls Work

**All calls to the WhatsApp service go through the Supabase Edge Function**, never directly from the browser.

```
Browser → Supabase Edge Function (whatsapp-proxy) → wa.otomator.pro
```

**Edge Function:** Already deployed at `mzalzjtsyrjycaxolldv.supabase.co/functions/v1/whatsapp-proxy`

Call it from the frontend like this:
```typescript
const { data, error } = await supabase.functions.invoke('whatsapp-proxy', {
  body: {
    path: '/api/sessions',        // WhatsApp service path
    method: 'GET',
    body: null,                   // request body (for POST/DELETE)
  }
})
```

**Supabase connection:** Use the existing Supabase client already in the project.

---

## Full WhatsApp Service API Reference

Base URL (internal, used by edge function): `https://wa.otomator.pro`
Auth: `Authorization: Bearer 00b5c06e2cf219d11c3e599acd564726` — only in Edge Function, never in browser.

### Sessions Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all active sessions |
| `GET` | `/api/sessions/:orgId/status` | Status of one session |
| `GET` | `/api/sessions/:orgId/qr` | Get QR as base64 (only when status=qr) |
| `POST` | `/api/sessions/:orgId/start` | Start/restart a session |
| `DELETE` | `/api/sessions/:orgId` | Stop and remove a session |
| `GET` | `/api/sessions/:orgId/webhook-failures` | Get failed webhook deliveries |
| `DELETE` | `/api/sessions/:orgId/webhook-failures` | Clear webhook failures log |

### Messages Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/messages/send` | Send a single message |
| `POST` | `/api/messages/send-bulk` | Send to multiple recipients |

### Status Values

| Value | Meaning |
|-------|---------|
| `connecting` | Starting up, no QR yet |
| `qr` | QR ready, waiting for scan |
| `connected` | Active and working ✅ |
| `disconnected` | Lost connection ⚠️ |

### Session Object Shape

```typescript
{
  orgId: string
  status: 'connecting' | 'qr' | 'connected' | 'disconnected'
  phoneNumber?: string    // e.g. "972505253669", null if not yet connected
  webhookUrl?: string
}
```

---

## What to Add — 4 New Sections

### Section A — Webhook Failures Panel

Add a collapsible "Webhook Failures" row expander in the sessions table.
When expanded, shows failed webhook deliveries for that org.

**API calls:**
```typescript
// Get failures
{ path: `/api/sessions/${orgId}/webhook-failures`, method: 'GET' }
// Returns: { failures: [...], count: number }

// Clear failures
{ path: `/api/sessions/${orgId}/webhook-failures`, method: 'DELETE' }
// Returns: { success: true, cleared: number }
```

**UI:**
- Show a red badge `⚠️ 3` next to org name if `count > 0`
- Click badge → expands failures list below the row
- Each failure shows: timestamp, endpoint URL, error message, HTTP status
- "Clear All" button → calls DELETE → badge disappears

---

### Section B — Send Test Message

Add a "Send Test Message" button in the Actions column (only shown when status = `connected`).

Opens a small modal/drawer with:
- **To:** phone number input (Israeli format, e.g. `0528393669` → auto-formats to `972528393669`)
- **Message:** textarea
- **Send** button

**API call:**
```typescript
{
  path: '/api/messages/send',
  method: 'POST',
  body: {
    orgId: 'the-org-id',
    to: '972528393669',
    type: 'text',
    message: 'text here'
  }
}
// Returns: { success: true, messageId: "3EB00E..." }
```

Show success toast with messageId, or error toast if failed.

**Phone number formatting helper:**
```typescript
function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.startsWith('0')) return '972' + digits.slice(1)
  if (digits.startsWith('972')) return digits
  return digits
}
```

---

### Section C — Start Session with Webhook URL

The existing "Reconnect" button calls `POST /api/sessions/:orgId/start` but probably doesn't ask for a webhook URL.

Modify the Reconnect flow to show a small form before starting:
- **Webhook URL:** text input (pre-filled with existing webhookUrl if known, optional)
- Confirm → start session

**API call:**
```typescript
{
  path: `/api/sessions/${orgId}/start`,
  method: 'POST',
  body: {
    webhookUrl: 'https://...'   // optional, can be empty
  }
}
```

---

### Section D — Subscription Management

The existing view is read-only. Add full CRUD.

**Database table:** `central_subscriptions` in Supabase (project `mzalzjtsyrjycaxolldv`)

**Schema (relevant columns):**
```sql
org_id            text (primary key, slug format e.g. "acme-corp")
organization_name text
user_email        text
plan              text  -- 'basic' | 'pro' | 'enterprise'
status            text  -- 'active' | 'cancelled' | 'expired'
product_id        uuid  -- FK to products table, must be whatsapp-service product
sumit_token       text  -- payment token, optional
started_at        timestamptz
expires_at        timestamptz -- null = no expiry
```

**Get the whatsapp-service product_id:**
```sql
SELECT id FROM products WHERE slug = 'whatsapp-service';
```
Cache this ID — use it when creating new subscriptions.

#### D1 — Add Subscription (Manual)

"Add Subscription" button opens a form:
- Org ID (slug, e.g. `acme-corp`) — required, must be unique
- Organization Name — required
- User Email — required
- Plan — select: Basic / Pro / Enterprise
- Expires At — date picker, optional (leave empty = no expiry)

On submit → `INSERT INTO central_subscriptions` with `status = 'active'`.

After insert, the WhatsApp service will automatically allow that org to connect (it validates against this table).

#### D2 — Edit Subscription

Click row → drawer opens with all fields editable.
Allow changing: plan, status (active/cancelled), expires_at, organization_name, webhookUrl.

On save → `UPDATE central_subscriptions WHERE org_id = ?`

#### D3 — Cancel Subscription

"Cancel" button per row → confirm dialog → `UPDATE status = 'cancelled'`.
The WhatsApp service will immediately reject new connections for that org (existing connected session remains active until disconnected).

---

## Recommended Build Order

1. **Section D** (subscription management) — this is the most impactful, enables manual provisioning
2. **Section A** (webhook failures) — quick win, important for debugging customer issues
3. **Section B** (send test message) — useful for testing customer setups
4. **Section C** (webhook URL on reconnect) — small improvement to existing flow

---

## Important Notes

1. **Never expose the API_SECRET (`00b5c06e2cf219d11c3e599acd564726`) to the browser** — all WhatsApp API calls must go through the `whatsapp-proxy` Edge Function.

2. **The Edge Function is already deployed** — just call `supabase.functions.invoke('whatsapp-proxy', { body: { path, method, body } })`.

3. **Sessions are in-memory on the VPS** — if the service restarts, sessions auto-restore from disk but appear briefly as `connecting`. The subscriptions table in Supabase is the source of truth for WHO can connect.

4. **org_id is the key** — it links `central_subscriptions` (Supabase) ↔ the live session (WhatsApp service). Always consistent between both.

5. **The connect page** (`https://wa.otomator.pro/connect/:orgId`) is a self-contained QR page for end users. The admin "Open QR" button links there. Don't try to embed the QR inline in admin — just link to it.

6. **Phone number format for sending:** always `972XXXXXXXXX` without `+` or spaces.

---

## Files to Create/Modify

```
src/
  pages/admin/whatsapp/
    WhatsAppPage.tsx          -- EXISTS: add Sections A, B, C, D here
    components/
      WebhookFailuresRow.tsx  -- NEW: Section A
      SendMessageModal.tsx    -- NEW: Section B
      SubscriptionForm.tsx    -- NEW: Sections D1 + D2
      SubscriptionTable.tsx   -- EXISTS: add edit/cancel actions (D2, D3)
  lib/
    whatsappProxy.ts          -- NEW: typed wrapper around supabase.functions.invoke
```

**`whatsappProxy.ts` helper to create (typed wrapper):**
```typescript
import { supabase } from './supabaseClient'

export async function waProxy<T = unknown>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: object
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-proxy', {
    body: { path, method, body: body ?? null }
  })
  if (error) throw error
  return data as T
}

// Usage examples:
// const sessions = await waProxy<SessionsResponse>('/api/sessions')
// await waProxy(`/api/sessions/${orgId}`, 'DELETE')
// const result = await waProxy('/api/messages/send', 'POST', { orgId, to, type, message })
```

---

## Branch Name

`feature/whatsapp-admin-full-management`

## After Building

Run the project build, verify no TypeScript errors, confirm the 4 sections render and work against the live service at `https://wa.otomator.pro`.
