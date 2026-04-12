# Handoff B — WhatsApp Device Management in JumpStart Client Portal

## מה צריך לבנות

דף ניהול מכשירים ב-JumpStart Hub — הפורטל שבו כל לקוח מנהל את השירותים שלו.
כל לקוח רואה **רק את ה-orgId שלו** — אין גישה למכשירים של לקוחות אחרים.

---

## ה-orgId של הלקוח

כשלקוח נרשם לשירות WhatsApp, נוצר לו `org_id` ב-`central_subscriptions`.
הלקוח לא רואה את ה-org_id בממשק — הוא שקוף. מה שהוא רואה זה "המכשיר שלי".

**איך מוצאים את ה-org_id של לקוח מחובר:**
```sql
SELECT org_id FROM central_subscriptions
WHERE user_email = $user_email
  AND product_id = (SELECT id FROM products WHERE slug = 'whatsapp-service')
  AND status = 'active'
LIMIT 1;
```

---

## ה-flow של הלקוח

```
לקוח נכנס ל-JumpStart Hub
    ↓
נכנס ל-"WhatsApp" / "צ'אט חכם"
    ↓
אם אין מנוי → מסך רכישה (SUMIT)
אם יש מנוי פעיל → מסך ניהול מכשיר
    ↓
אם לא מחובר → כפתור "חבר מכשיר" → פותח /connect/:orgId
אם מחובר → מסך סטטוס עם כפתור "נתק" / "החלף מכשיר"
```

---

## Status endpoint (ציבורי, ללא auth)

```
GET https://wa.otomator.pro/connect/:orgId/status
```

**Response:**
```json
{
  "status": "connected",
  "phoneNumber": "972501234567"
}
```

השתמש בזה ל-polling מה-client side (כל 10 שניות כשהלקוח בדף).

---

## Actions (דרך backend — לא מה-browser ישירות!)

ה-API_SECRET לא יכול להיות ב-frontend. כל קריאה לAPI עוברת דרך ה-backend של JumpStart.

### נתק מכשיר
```
DELETE https://wa.otomator.pro/api/sessions/:orgId
Authorization: Bearer <API_SECRET>
```

### חבר מחדש
```
POST https://wa.otomator.pro/api/sessions/:orgId/start
Authorization: Bearer <API_SECRET>
Body: { "autoRestore": true }
```

### עמוד QR (ציבורי — ללא auth)
```
https://wa.otomator.pro/connect/:orgId
```
פתח בiframe או בtab חדש.

---

## UI — מסך ניהול מכשיר

### מצב: מחובר ✅

```
┌─────────────────────────────────────────┐
│  📱 WhatsApp מחובר                      │
│                                         │
│  המספר שלך: +972-50-123-4567           │
│  ● פעיל מאז: 02/04/2026               │
│                                         │
│  [החלף מכשיר]  [נתק]                   │
└─────────────────────────────────────────┘
```

**החלף מכשיר:**
1. קורא ל-DELETE (ניתוק)
2. פותח `/connect/:orgId` בiframe או popup
3. אחרי חיבור — מעדכן את הUI

### מצב: לא מחובר ⚠️

```
┌─────────────────────────────────────────┐
│  📱 WhatsApp לא מחובר                  │
│                                         │
│  חבר את המכשיר שלך כדי לקבל           │
│  הודעות אוטומטיות מהשירות             │
│                                         │
│  [חבר מכשיר ←]                        │
└─────────────────────────────────────────┘
```

**חבר מכשיר** → redirect ל`/connect/:orgId` (או iframe).

### מצב: QR פעיל (ממתין לסריקה) 📷

```
┌─────────────────────────────────────────┐
│  📷 ממתין לחיבור                       │
│                                         │
│  [iFrame → /connect/:orgId]            │
│                                         │
│  הדף יתעדכן אוטומטית אחרי חיבור       │
└─────────────────────────────────────────┘
```

---

## Iframe vs Redirect

**עדיף iframe** אם הפורטל בנוי כ-SPA (React/Vue) — הלקוח לא יוצא מהפורטל.

```html
<iframe
  src="https://wa.otomator.pro/connect/acme-corp"
  style="border: none; width: 100%; height: 600px; border-radius: 16px;"
/>
```

ה-connect page עצמו כבר RTL עברית, dark theme — יתאים לתוך הפורטל.

**עדיף redirect** אם הפורטל בנוי בBubble.io / Webflow — פשוט יותר לממש.

---

## Backend endpoint שצריך ב-JumpStart Hub

```typescript
// POST /api/whatsapp/disconnect
// (אוטנטיקציה — רק הלקוח הנוכחי יכול לנתק את עצמו)
async function disconnectDevice(userEmail: string) {
  const orgId = await getOrgIdForUser(userEmail)  // מSupabase
  await fetch(`https://wa.otomator.pro/api/sessions/${orgId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_API_SECRET}` }
  })
}
```

---

## סדר בנייה מומלץ

1. Backend endpoint לget ה-orgId של הלקוח המחובר
2. Status polling מ-`/connect/:orgId/status` (ציבורי, ישירות מ-frontend)
3. UI — כל שלושת המצבים (connected / disconnected / qr)
4. Backend action: disconnect
5. Iframe ל-connect page
6. Backend action: reconnect
