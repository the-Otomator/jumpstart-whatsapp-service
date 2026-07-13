# WA catalog in profile — jumpstart-whatsapp-service

## Diff summary

- `src/routes/contacts.ts`: parallel `sock.getCatalog({ jid, limit: 20 })` with `.catch(() => undefined)`; `mapCatalog()` maps Baileys products → wire shape; 6h cache unchanged.
- `src/types.ts`: `ContactCatalog`, `ContactCatalogProduct`, `catalog?` on `ContactProfileResponse`; `address` already on `ContactBusinessProfile`.

## Sample business profile response

```json
{
  "success": true,
  "phone": "972501234567",
  "exists_on_whatsapp": true,
  "profile_picture_url": "https://pps.whatsapp.net/v/t61.24694-24/...",
  "about": "פתוחים בימים א׳–ה׳",
  "business_profile": {
    "description": "סטודיו ליוגה ופילאטיס",
    "category": "Health & wellness",
    "email": "hello@example.co.il",
    "websites": ["https://example.co.il"],
    "address": "רחוב הרצל 1, תל אביב",
    "business_hours": {
      "timezone": "Asia/Jerusalem",
      "schedule": [
        { "day_of_week": "sun", "mode": "open", "open_time": 540, "close_time": 1200 }
      ]
    }
  },
  "catalog": {
    "products": [
      {
        "id": "1234567890",
        "name": "מנוי חודשי",
        "price": 299000,
        "currency": "ILS",
        "description": "10 שיעורים",
        "image_url": "https://..."
      }
    ]
  }
}
```

Non-business / no catalog: `business_profile` and `catalog` omitted.

## Build

- `npm run build` (tsc) ✓

## Deploy

Rebuild + redeploy container on VPS after merge (see `DEPLOY.md`).
