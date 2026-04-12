📋 משימה ל-Cursor
─────────────────────
שם: WhatsApp Service Purchase Page + Payment Flow
Branch: feature/whatsapp-purchase-page
Repo: otomator-admin (c:\Users\Me\projects\otomator-admin)

## Context

A full SUMIT payment flow has been set up in the backend. The Cursor task is to build the **frontend** — a public pricing page and the payment callback handling.

### What's already deployed (DON'T rebuild these):

1. **Supabase Edge Function `sumit-whatsapp`** — handles `get_plans`, `create_payment`, `payment_callback`
2. **DB tables:** `whatsapp_plans` (3 plans seeded), `whatsapp_payments` (tracks transactions)
3. **DB table:** `central_subscriptions` (auto-provisioned on successful payment)

### Supabase project:
- **URL:** `https://mzalzjtsyrjycaxolldv.supabase.co`
- **Anon key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YWx6anRzeXJqeWNheG9sbGR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzAzMTUsImV4cCI6MjA5MDMwNjMxNX0.Jzar1LcYcUj05SrKWOQX09QB6pZKDBrSkAp2-hhuK_Y`

### Edge Function API:

**Base URL:** `https://mzalzjtsyrjycaxolldv.supabase.co/functions/v1/sumit-whatsapp`

No JWT required (verify_jwt=false) — this is a public purchase flow.

#### Action: `get_plans`
```json
POST { "action": "get_plans" }
→ { "plans": [{ id, slug, name, name_he, description_he, amount_agorot, features, limits, is_featured, ... }] }
```

#### Action: `create_payment`
```json
POST {
  "action": "create_payment",
  "planId": "uuid-of-plan",
  "email": "customer@example.com",
  "name": "Customer Name",
  "phone": "+972501234567",
  "successUrl": "https://otomator-admin.pages.dev/payment/callback",
  "cancelUrl": "https://otomator-admin.pages.dev/payment/cancel"
}
→ { "paymentUrl": "https://pay.sumit.co.il/...", "paymentId": "uuid", "orgId": "generated-org-id" }
```
Then redirect user to `paymentUrl`.

#### Action: `payment_callback`
```json
POST {
  "action": "payment_callback",
  "payment_id": "uuid",
  "sumit_transaction_id": "from-url-params",
  "valid": "1"
}
→ { "ok": true, "orgId": "...", "connectUrl": "https://wa.otomator.pro/connect/..." }
```

---

## מה לעשות:

### 1. Public Pricing Page

Route: `/whatsapp/pricing` (or `/pricing/whatsapp`)

This is a **public** page — no auth required. It should look professional and be in Hebrew RTL.

**Layout:**
- Hero section: headline + subtitle explaining WhatsApp Service
- 3 plan cards side by side (Basic / Pro / Enterprise)
- Pro card highlighted as "featured" (is_featured=true)
- Each card shows: name_he, price (amount_agorot / 100 → ₪), features list, CTA button

**Plan cards:**
- Load plans from Edge Function (`get_plans`)
- Price display: `₪99/חודש`, `₪199/חודש`, `₪499/חודש`
- Features: render the `features` JSONB array as a checklist
- Featured plan: larger/highlighted card with "מומלץ" badge

**CTA button behavior:**
- Click → show a small form modal asking for: שם מלא, אימייל, טלפון (optional)
- On submit → call `create_payment` edge function
- On response → redirect to `paymentUrl` (SUMIT's hosted payment page)

### 2. Payment Callback Page

Route: `/payment/callback`

This page is where SUMIT redirects after payment. It reads URL params and calls the edge function.

**Flow:**
1. Read `?payment_id=...&Valid=1&TransactionID=...` from URL
2. Call edge function with `action: "payment_callback"`
3. If success → redirect to `/payment/success?orgId=...&connectUrl=...`
4. If failed → redirect to `/payment/cancel`

**UI:** Show a spinner with "מעבד את התשלום..." while processing.

### 3. Payment Success Page

Route: `/payment/success`

**Show:**
- ✅ Success icon
- "התשלום התקבל בהצלחה!"
- "החשבון שלך הופעל. מספר הארגון שלך: [orgId]"
- Big CTA button: "חבר את ה-WhatsApp שלך" → links to `connectUrl` (https://wa.otomator.pro/connect/:orgId)
- Secondary text: "בקרוב תקבל גם גישה ל-JumpStart Hub לניהול מלא"

### 4. Payment Cancel Page

Route: `/payment/cancel`

**Show:**
- ⚠️ Warning icon
- "התשלום בוטל"
- "אם נתקלת בבעיה, אנחנו כאן לעזור."
- Button: "חזור לדף המחירים" → links back to pricing page
- Link: "צור קשר" → mailto:nizan@otomator.co.il

### 5. Navigation

Add "WhatsApp Service" or "תמחור" to the main navigation/footer — linking to the pricing page.
This should be visible even to non-authenticated visitors.

---

## Design notes:

- Hebrew RTL (`dir="rtl"`, `lang="he"`)
- Dark theme consistent with existing admin portal design
- Green accent (#4ade80) for WhatsApp branding
- Mobile responsive — pricing cards stack vertically on small screens
- The pricing page should work as a standalone marketing page

## Plans data (already seeded):

| Slug | Name Hebrew | Price | Featured |
|------|-------------|-------|----------|
| basic | בסיסי | ₪99/חודש | No |
| pro | מקצועי | ₪199/חודש | Yes |
| enterprise | ארגוני | ₪499/חודש | No |

## קבצים רלוונטיים:
- App router / routing configuration
- Existing Supabase client setup (use the adminSupabase client for the otomator-admin project)
- Existing design system / component library

## אל תגע ב:
- Supabase Edge Functions (already deployed)
- Database schema (already created)
- WhatsApp service code (separate repo)
- The existing WhatsApp sessions management page

## לאחר הביצוע:
- Run build — must be zero errors
- Test locally: verify pricing page loads plans, CTA opens form, callback page handles redirect
- Report: what was done, any errors, branch name
