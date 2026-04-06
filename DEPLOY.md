# Deployment Guide — jumpstart-whatsapp-service

## Prerequisites
- Ubuntu 22.04+ VPS (1GB RAM minimum, 2GB recommended)
- A domain or subdomain pointing to the VPS (e.g. `wa.yourdomain.com`)

---

## 1. SSH into VPS

```bash
ssh root@YOUR_VPS_IP
```

---

## 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # should print v20.x.x
```

---

## 3. Install PM2

```bash
npm install -g pm2
```

---

## 4. Install Nginx

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## 5. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/jumpstart-whatsapp-service.git
cd jumpstart-whatsapp-service
```

---

## 6. Install dependencies and build

```bash
npm install
npm run build
```

---

## 7. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in:
- `API_SECRET` — generate with `openssl rand -hex 16`
- `ALLOWED_ORIGINS` — frontend origin(s), comma-separated (e.g. `http://localhost:5174`, production hub URL). Used for **CORS** and Helmet **`frame-ancestors`** so Jumpstart can call `/connect/.../status` and embed `/connect/...` in an iframe.

---

## 8. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # follow the printed command to enable auto-start on reboot
```

Check status:
```bash
pm2 status
pm2 logs jumpstart-whatsapp
```

---

## 9. Configure Nginx reverse proxy

```bash
sudo cp nginx.conf /etc/nginx/sites-available/whatsapp
# Edit the file and replace wa.YOURDOMAIN.com with your actual domain
sudo nano /etc/nginx/sites-available/whatsapp

sudo ln -s /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 10. SSL with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d wa.yourdomain.com
# Follow prompts — certbot will auto-update the nginx config
sudo systemctl reload nginx
```

Certbot auto-renews. Test renewal:
```bash
sudo certbot renew --dry-run
```

---

## API Usage

All endpoints require `Authorization: Bearer YOUR_API_SECRET` header.

### Start a session (triggers QR scan)
```
POST /api/sessions/{orgId}/start
Body: { "webhookUrl": "https://your-backend.com/webhooks/whatsapp" }
```

### Poll for QR code
```
GET /api/sessions/{orgId}/qr
→ { "qr": "data:image/png;base64,..." }
```

### Check session status
```
GET /api/sessions/{orgId}/status
→ { "orgId": "org_123", "status": "connected", "phoneNumber": "972501234567" }
```

### Send a message
```
POST /api/messages/send
Body: { "orgId": "org_123", "to": "972509876543", "message": "Hello!" }
```

### Send a message (session path alias)
Same behavior as above; `orgId` comes from the URL.
```
POST /api/sessions/{orgId}/send
Body: { "to": "972509876543", "message": "Hello!" }
```

### Send bulk messages (1.5s delay between each)
```
POST /api/messages/send-bulk
Body: [{ "orgId": "org_123", "to": "972509876543", "message": "Hi" }, ...]
```

### Stop a session
```
DELETE /api/sessions/{orgId}
```

### Health check (no auth required)
```
GET /health
→ { "status": "ok", "sessions": 2, "uptime": 3600 }
```

---

## Webhook Events

If you provide a `webhookUrl` when starting a session, the service will POST these events:

| Event | Payload |
|---|---|
| `qr` | `{ event: "qr", orgId, qr: "data:image/png;base64,..." }` |
| `connected` | `{ event: "connected", orgId, phone: "972501234567" }` |
| `disconnected` | `{ event: "disconnected", orgId }` |

---

## Session Persistence

Auth credentials are saved to `./sessions/{orgId}/` on disk. After a restart, sessions that were previously connected will attempt to reconnect automatically without needing a new QR scan — as long as the WhatsApp account hasn't been logged out.
