# Handoff A — WhatsApp Sessions Management in otomator-admin

## מה צריך לבנות

דף ניהול sessions ב-otomator-admin portal שמאפשר לניזן לראות ולנהל את כל מכשירי ה-WhatsApp של כל הלקוחות.

---

## API של WhatsApp Service

**Base URL:** `https://wa.otomator.pro`
**Auth:** `Authorization: Bearer <API_SECRET>` (מה-env של הפרויקט, לא לחשוף לclient)
**API_SECRET:** `00b5c06e2cf219d11c3e599acd564726`

### Endpoints רלוונטיים

#### GET /api/sessions
רשימת כל ה-sessions הפעילים.

**Response:**
```json
[
  {
    "orgId": "acme-corp",
    "status": "connected",
    "phoneNumber": "972501234567",
    "webhookUrl": "https://...",
    "startedAt": "2026-04-02T13:30:00.000Z"
  },
  {
    "orgId": "beta-org",
    "status": "qr",
    "phoneNumber": null
  }
]
```

**Session statuses:**
- `connecting` — מתחבר, QR עוד לא מוכן
- `qr` — ממתין לסריקת QR
- `connected` — מחובר ועובד
- `disconnected` — מנותק

#### GET /api/sessions/:orgId/status
סטטוס של org ספציפי.

#### POST /api/sessions/:orgId/start
הפעלת session חדש (בדרך כלל דרך /connect/:orgId, אבל אפשר גם מ-admin).

**Body:**
```json
{
  "webhookUrl": "https://...",   // optional
  "autoRestore": true             // optional, default true
}
```

#### DELETE /api/sessions/:orgId
עצירת session.

#### GET /health
```json
{
  "status": "ok",
  "sessions": 3,
  "connected": 2,
  "uptime": 3600,
  "memoryMB": 128
}
```

#### GET /api/sessions/:orgId/webhook-failures
שגיאות webhook לorg ספציפי (לdebug).

---

## מה לבנות ב-otomator-admin

### דף: `/admin/whatsapp` (או `/admin/sessions`)

#### Section 1 — Service Health Banner
```
● WhatsApp Service  |  3 sessions  |  2 connected  |  Uptime 2h 14m  |  RAM 128MB
```
מסמן `GET /health` כל 30 שניות.

#### Section 2 — Sessions Table

| org_id | Organization | Phone | Status | Actions |
|--------|-------------|-------|--------|---------|
| acme-corp | Acme Ltd | +972-50-123-4567 | 🟢 Connected | Disconnect |
| beta-org | Beta Inc | — | 🟡 Waiting QR | Open QR / Disconnect |
| gamma | Gamma Co | +972-52-987-6543 | 🔴 Disconnected | Reconnect |

**Actions:**
- **Open QR** — פותח `https://wa.otomator.pro/connect/:orgId` בtab חדש
- **Disconnect** — קורא ל-`DELETE /api/sessions/:orgId` עם confirm
- **Reconnect** — קורא ל-`POST /api/sessions/:orgId/start`

**Auto-refresh:** כל 10 שניות.

#### Section 3 — Supabase subscriptions table
לצד ה-API data, הצג גם את ה-`central_subscriptions` table (filtered by product slug = `whatsapp-service`):
- user_email
- plan
- status (active/cancelled)
- org_id
- organization_name

כפתור: **Add subscription** — פותח form ליצירת org חדש (org_id, user_email, plan).

---

## API Call מה-admin portal

**חשוב:** ה-API_SECRET לא יכול להיות ב-frontend. צריך לקרוא ל-WhatsApp service מה-backend של otomator-admin (server-side), לא מה-browser ישירות.

אם otomator-admin בנוי עם Supabase Edge Functions:
```typescript
// Edge Function: /functions/whatsapp-proxy
const WA_URL = 'https://wa.otomator.pro'
const WA_SECRET = Deno.env.get('WHATSAPP_API_SECRET')

Deno.serve(async (req) => {
  const { path, method, body } = await req.json()

  const res = await fetch(`${WA_URL}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${WA_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

אם ב-Next.js/Express — server-side API route עם הsecret ב-env.

---

## Supabase — otomator-admin

**Project:** `mzalzjtsyrjycaxolldv` (otomator-admin)
**URL:** `https://mzalzjtsyrjycaxolldv.supabase.co`

Query לget כל ה-whatsapp subscriptions:
```sql
SELECT
  cs.org_id,
  cs.organization_name,
  cs.user_email,
  cs.plan,
  cs.status,
  cs.sumit_token,
  cs.started_at,
  cs.expires_at
FROM central_subscriptions cs
JOIN products p ON cs.product_id = p.id
WHERE p.slug = 'whatsapp-service'
ORDER BY cs.started_at DESC;
```

---

## סדר בנייה מומלץ

1. Edge Function / API route עם proxy לWhatsApp service
2. Service health banner
3. Subscriptions table מSupabase (read-only קודם)
4. Sessions table מה-API (polling)
5. Actions: Disconnect / Reconnect / Open QR
6. Add subscription form
