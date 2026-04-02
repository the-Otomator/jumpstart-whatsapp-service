#!/bin/bash
# ─────────────────────────────────────────────
# jumpstart-whatsapp-service — VPS first-time setup
# Run on: 147.93.127.180 (Hostinger, Ubuntu 24.04 + Docker)
# ─────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/the-Otomator/jumpstart-whatsapp-service.git"
APP_DIR="/opt/whatsapp-service"
DOMAIN="wa.otomator.co.il"
BRANCH="feature/production-hardening"

echo "=== 1. Clone repo ==="
if [ -d "$APP_DIR" ]; then
  echo "Directory exists, pulling latest..."
  cd "$APP_DIR" && git fetch && git checkout "$BRANCH" && git pull origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "=== 2. Ensure Docker is installed ==="
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

echo "=== 3. Create .env ==="
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 16)
  sed -i "s/change_this_to_a_random_secret_32chars/$SECRET/" .env
  sed -i "s|https://hub.jumpstart.co.il|https://hub.jumpstart.co.il,https://otomator-admin.pages.dev|" .env
  echo ""
  echo "════════════════════════════════════════════"
  echo "  Generated API_SECRET: $SECRET"
  echo "  ⚠️  SAVE THIS SECRET — you need it to call the API"
  echo "════════════════════════════════════════════"
  echo ""
else
  echo ".env already exists, skipping..."
fi

echo "=== 4. Docker compose up (multi-stage build) ==="
docker compose up -d --build

echo "=== 5. Verify ==="
sleep 5
docker compose ps
echo ""
curl -s http://localhost:3001/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3001/health
echo ""

echo "=== 6. Nginx reverse proxy ==="
if [ ! -f /etc/nginx/sites-available/whatsapp ]; then
  if ! command -v nginx &> /dev/null; then
    apt-get update -qq && apt-get install -y -qq nginx
    systemctl enable nginx
  fi

  cat > /etc/nginx/sites-available/whatsapp <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

  ln -sf /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  echo "Nginx configured for $DOMAIN"
else
  echo "Nginx config already exists, skipping..."
fi

echo "=== 7. SSL (Certbot) ==="
if ! command -v certbot &> /dev/null; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi
if host "$DOMAIN" | grep -q "147.93.127.180"; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m nizan@otomator.co.il
  echo "SSL certificate installed!"
else
  echo "⚠️  DNS for $DOMAIN not pointing to this server yet."
  echo "    Point the A record to 147.93.127.180, then run:"
  echo "    certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m nizan@otomator.co.il"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ WhatsApp service is LIVE"
echo "  Health: http://147.93.127.180:3001/health"
echo "  API:    https://$DOMAIN/api/ (after DNS+SSL)"
echo "═══════════════════════════════════════════"
