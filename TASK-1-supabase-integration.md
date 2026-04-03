📋 משימה ל-Claude Code
─────────────────────
שם: Add Supabase org validation to WhatsApp service
Branch: feature/supabase-org-validation

## Context

The otomator-admin Supabase project (`mzalzjtsyrjycaxolldv`) now has:
- A `products` table with `whatsapp-service` product (slug: `whatsapp-service`)
- A `central_subscriptions` table with a new `org_id` column (unique per product)
- The WhatsApp service needs to validate that an orgId has an active subscription before allowing session start

Supabase URL: `https://mzalzjtsyrjycaxolldv.supabase.co`

## מה לעשות:

### 1. Install @supabase/supabase-js
```bash
npm install @supabase/supabase-js
```

### 2. Create `src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — org validation disabled')
}

export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

/**
 * Check if an orgId has an active subscription for the whatsapp-service product.
 * Returns the subscription if valid, null if not found or inactive.
 * If Supabase is not configured, returns a mock "valid" result (dev mode).
 */
export async function validateOrg(orgId: string): Promise<{
  valid: boolean
  plan?: string
  userEmail?: string
  organizationName?: string
}> {
  // Dev mode — if no Supabase configured, allow all
  if (!supabase) {
    logger.debug({ orgId }, 'Supabase not configured — skipping org validation')
    return { valid: true }
  }

  try {
    const { data, error } = await supabase
      .from('central_subscriptions')
      .select('org_id, plan, status, user_email, organization_name, product_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .single()

    if (error || !data) {
      logger.info({ orgId }, 'No active subscription found for org')
      return { valid: false }
    }

    // Verify it's for the whatsapp-service product
    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', data.product_id)
      .single()

    if (product?.slug !== 'whatsapp-service') {
      logger.info({ orgId, productSlug: product?.slug }, 'Subscription is not for whatsapp-service')
      return { valid: false }
    }

    return {
      valid: true,
      plan: data.plan,
      userEmail: data.user_email,
      organizationName: data.organization_name,
    }
  } catch (err) {
    logger.error({ orgId, err }, 'Error validating org against Supabase')
    // Fail open in case of DB error — don't block the service
    return { valid: true }
  }
}
```

### 3. Add org validation to session start in `src/routes/sessions.ts`

In the `POST /:orgId/start` handler, BEFORE calling `startSession()`, add:

```typescript
import { validateOrg } from '../lib/supabase'

// Inside the handler, before startSession:
const orgCheck = await validateOrg(orgId)
if (!orgCheck.valid) {
  res.status(403).json({
    error: 'No active subscription for this organization',
    code: 'ORG_NOT_AUTHORIZED',
  })
  return
}
```

### 4. Add org validation to the connect page in `src/routes/connect.ts`

In the `GET /:orgId` handler, BEFORE auto-starting the session, add the same validation:

```typescript
import { validateOrg } from '../lib/supabase'

// Inside the handler, before auto-start:
const orgCheck = await validateOrg(orgId)
if (!orgCheck.valid) {
  res.status(403).send(renderErrorPage(orgId, 'אין מנוי פעיל לארגון זה'))
  return
}
```

Add a simple `renderErrorPage` function:
```typescript
function renderErrorPage(orgId: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>שגיאה — ${orgId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fafafa; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #141414; border: 1px solid #2a2a2a; border-radius: 16px; padding: 40px; max-width: 440px; width: 90%; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>${message}</h1>
    <p>צור קשר עם מנהל המערכת</p>
  </div>
</body>
</html>`
}
```

### 5. Update `.env.example`

Add these lines:
```
SUPABASE_URL=https://mzalzjtsyrjycaxolldv.supabase.co
SUPABASE_SERVICE_KEY=                              # Get from Supabase Dashboard → Settings → API → service_role key
```

### 6. Update `src/index.ts`

No changes needed — the validation happens at the route level.

## קבצים רלוונטיים:
- src/lib/supabase.ts (NEW)
- src/routes/sessions.ts
- src/routes/connect.ts
- .env.example
- package.json

## אל תגע ב:
- src/sessionManager.ts (session lifecycle stays as-is)
- src/lib/webhookDispatcher.ts
- docker-compose.yml
- Dockerfile

## לאחר הביצוע:
- הרץ `npm run build` — must be zero errors
- דווח: מה בוצע, שגיאות אם יש, מה ה-branch name
