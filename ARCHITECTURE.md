# JumpStart Platform Architecture

## The Three Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    1. OTOMATOR ADMIN PORTAL                         │
│                    (Internal — Nizan only)                           │
│                                                                     │
│  • Manage all products & subscriptions                              │
│  • View all WhatsApp sessions across all clients                    │
│  • Create/suspend client accounts                                   │
│  • SUMIT billing overview                                           │
│  • Service health monitoring                                        │
│                                                                     │
│  Repo: github.com/the-Otomator/otomator-admin                      │
│  DB:   Supabase (mzalzjtsyrjycaxolldv)                             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ reads/writes
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SUPABASE — otomator-admin                        │
│                                                                     │
│  products              → jumpstart, dugri, spaceviz, whatsapp       │
│  central_subscriptions → org_id, plan, status, sumit_token          │
│  admin_users           → portal access control                      │
│  subscription_events   → audit log                                  │
│  product_api_keys      → per-product API keys                       │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │ validates org                     │ reads own subscription
           ▼                                   ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│  2. WHATSAPP SERVICE     │   │  3. JUMPSTART CLIENT HUB             │
│  (Microservice — VPS)    │   │  (Client-facing — per org)           │
│                          │   │                                      │
│  • Baileys sessions      │   │  • Client sees their own device      │
│  • QR connect page       │   │  • Connect / disconnect WhatsApp     │
│  • Send/receive msgs     │   │  • Requires active subscription      │
│  • Webhook forwarding    │   │  • SUMIT payment for new signups     │
│  • Org validation        │   │                                      │
│                          │   │  Built inside: otomator-admin repo   │
│  URL: wa.otomator.pro    │   │  OR separate JumpStart Hub app       │
│  Repo: jumpstart-wa-svc  │   │                                      │
└──────────────────────────┘   └──────────────────────────────────────┘
```

---

## How They Connect

### Flow 1: Nizan creates a new client
```
Otomator Admin → INSERT into central_subscriptions
  org_id: "acme-corp"
  product: whatsapp-service
  plan: "pro"
  status: "active"
  user_email: "client@acme.com"
```

### Flow 2: Client connects WhatsApp
```
Client opens: wa.otomator.pro/connect/acme-corp
  → WhatsApp Service checks Supabase: is acme-corp active? ✅
  → Shows QR → Client scans → Connected
```

### Flow 3: Client manages device (JumpStart Hub)
```
Client logs into JumpStart Hub
  → Hub reads Supabase: what's my org_id?
  → Hub polls wa.otomator.pro/connect/acme-corp/status (public, no auth)
  → Shows: connected / disconnected / QR
  → Actions (disconnect/reconnect) go through Hub backend → WhatsApp API
```

### Flow 4: Nizan monitors everything (Admin Portal)
```
Admin Portal
  → Reads Supabase: all whatsapp-service subscriptions
  → Calls wa.otomator.pro/api/sessions (with API_SECRET, server-side)
  → Shows dashboard: all sessions, health, actions
```

---

## The Key Question: Where Does the Client Hub Live?

### Option A: Inside otomator-admin repo (recommended for now)
Two route groups in one app:
- `/admin/*` → Protected by admin auth → Nizan's management
- `/hub/:orgId/*` → Protected by client auth → Client's self-service

Pros: One repo, one deploy, shared Supabase connection.
Cons: Admin and client mixed in one codebase.

### Option B: Separate JumpStart Hub app
- otomator-admin → Admin only
- jumpstart-hub → Client only (separate repo, separate deploy)

Pros: Clean separation.
Cons: Two apps to maintain, two deploys.

### Recommendation
Start with Option A. When the client base grows beyond 20-30 clients, split into two apps. The Supabase layer stays the same either way.

---

## API Secret Flow (Security)

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Browser          │     │  Admin/Hub        │     │  WhatsApp Svc   │
│  (no secrets)     │────>│  Backend          │────>│  wa.otomator.pro│
│                   │     │  (has API_SECRET) │     │                 │
└──────────────────┘     └──────────────────┘     └─────────────────┘
         │                                                 │
         │  Direct (public, no auth):                      │
         └─────── GET /connect/:orgId/status ──────────────┘
```

The browser NEVER gets the API_SECRET. All authenticated calls go through the admin/hub backend.

---

## Supabase Tables Overview

| Table | Purpose | Used By |
|-------|---------|---------|
| products | Product catalog | Admin portal |
| central_subscriptions | Client subscriptions with org_id | Admin + WhatsApp service + Hub |
| subscription_events | Audit trail | Admin portal |
| admin_users | Admin portal access | Admin portal |
| product_api_keys | API keys per product | Future use |

---

## What Exists Today

| Component | Status |
|-----------|--------|
| WhatsApp Service (API + QR page) | ✅ Live at wa.otomator.pro |
| Supabase schema (products, subscriptions) | ✅ Ready |
| Org validation (service checks Supabase) | ✅ Deployed |
| Admin portal frontend | ❌ Not built |
| Client hub frontend | ❌ Not built |
| SUMIT billing integration | ❌ Not built |

---

## Build Order

### Phase 1 — DONE ✅
- WhatsApp microservice
- QR connect page
- Supabase org validation

### Phase 2 — Admin Portal (next)
1. Decide stack for otomator-admin frontend (React/Next.js?)
2. Build admin auth (based on admin_users table)
3. WhatsApp dashboard page (sessions + subscriptions)
4. Subscription CRUD (create org, assign plan, activate/suspend)

### Phase 3 — Client Hub
1. Client auth (email/password or magic link)
2. Device management page (status, connect, disconnect)
3. Embed /connect/:orgId in iframe for QR

### Phase 4 — Billing
1. SUMIT integration for monthly subscriptions
2. Signup flow: payment → create subscription → redirect to /connect
3. Auto-suspend on failed payment
