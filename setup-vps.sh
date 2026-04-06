#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# jumpstart-whatsapp-service — VPS first-time setup
#
# Target server : wa-prod-1 · Hetzner CCX13 · 178.104.118.178
# OS            : Ubuntu 24.04
# Domain        : wa.otomator.pro (Cloudflare proxied — orange cloud ON)
# SSL           : Terminated at Cloudflare (self-signed cert on origin)
#
# Usage: ssh root@178.104.118.178 "bash -s" < setup-vps.sh
#   OR:  scp setup-vps.sh root@178.104.118.178:/tmp/ && ssh root@178.104.118.178 bash /tmp/setup-vps.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/the-Otomator/jumpstart-whatsapp-service.git"
APP_DIR="/opt/whatsapp-service"
DOMAIN="wa.otomator.pro"
BRANCH="main"
SERVER_IP="178.104.118.178"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  JumpStart WhatsApp Service — Hetzner Setup                  ║"
echo "║  Server: wa-prod-1 · $SERVER_IP                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. System baseline ────────────────────────────────────────────
echo "=== 1. System update + timezone ==="
apt-get update -qq && apt-get upgrade -y -qq
hostnamectl set-hostname wa-prod-1
timedatectl set-timezone Asia/Jerusalem
echo "  ✓ Hostname: $(hostname)"
echo "  ✓ Timezone: $(timedatectl | grep 'Time zone' | awk '{print $3}')"

# ── 2. Firewall ───────────────────────────────────────────────────
echo ""
echo "=== 2. Firewall (ufw) ==="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  ✓ Ports open: SSH, 80, 443"

# ── 3. Docker ─────────────────────────────────────────────────────
echo ""
echo "=== 3. Docker ==="
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  ✓ Docker installed: $(docker --version)"
else
  echo "  ✓ Docker already installed: $(docker --version)"
fi

# ── 4. Nginx ──────────────────────────────────────────────────────
echo ""
echo "=== 4. Nginx ==="
if ! command -v nginx &> /dev/null; then
  apt-get install -y -qq nginx
  systemctl enable nginx
  echo "  ✓ Nginx installed"
else
  echo "  ✓ Nginx already installed"
fi

# ── 5. Self-signed TLS cert (for Cloudflare Full mode) ────────────
echo ""
echo "=== 5. Self-signed TLS certificate ==="
if [ ! -f /etc/nginx/ssl/wa.crt ]; then
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/wa.key \
    -out    /etc/nginx/ssl/wa.crt \
    -subj   "/CN=$DOMAIN" \
    2>/dev/null
  chmod 600 /etc/nginx/ssl/wa.key
  echo "  ✓ Self-signed cert created (/etc/nginx/ssl/wa.crt)"
  echo "  ℹ  Set Cloudflare SSL mode to 'Full' (not Strict)"
else
  echo "  ✓ Cert already exists, skipping"
fi

# ── 6. Clone repo ─────────────────────────────────────────────────
echo ""
echo "=== 6. Clone repository ==="
if [ -d "$APP_DIR" ]; then
  echo "  Directory exists — pulling latest..."
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
echo "  ✓ Repo ready at $APP_DIR"

# ── 7. Configure .env ─────────────────────────────────────────────
echo ""
echo "=== 7. Environment variables ==="
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET=$(openssl rand -hex 16)
  PARTNER_KEY=$(openssl rand -hex 16)
  sed -i "s/change_this_to_a_random_secret_32chars/$SECRET/" "$APP_DIR/.env"
  sed -i "s/generate-a-strong-secret-here/$PARTNER_KEY/" "$APP_DIR/.env"
  echo ""
  echo "  ╔════════════════════════════════════════════════════════════╗"
  echo "  ║  ⚠️  SAVE THESE SECRETS — needed to call the API           ║"
  echo "  ╠════════════════════════════════════════════════════════════╣"
  printf   "  ║  API_SECRET:               %-32s  ║\n" "$SECRET"
  printf   "  ║  PARTNER_REGISTRATION_KEY: %-32s  ║\n" "$PARTNER_KEY"
  echo "  ╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  ⚠️  Edit .env now to add SUPABASE_URL, SUPABASE_SERVICE_KEY, etc."
  echo "     nano $APP_DIR/.env"
  echo ""
  echo "  Press ENTER when .env is ready, or Ctrl+C to abort."
  read -r
else
  echo "  ✓ .env already exists, skipping"
fi

# ── 8. Docker Compose up ──────────────────────────────────────────
echo ""
echo "=== 8. Docker Compose build & start ==="
cd "$APP_DIR"
docker compose up -d --build
echo "  ✓ Container started"
sleep 5
docker compose ps

# ── 9. Nginx site config ──────────────────────────────────────────
echo ""
echo "=== 9. Nginx reverse proxy ==="
if [ ! -f /etc/nginx/sites-available/whatsapp ]; then
  cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/whatsapp
  ln -sf /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/whatsapp
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  echo "  ✓ Nginx configured for $DOMAIN"
else
  echo "  Nginx config exists — updating..."
  cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/whatsapp
  nginx -t && systemctl reload nginx
  echo "  ✓ Nginx config updated"
fi

# ── 10. Health check ──────────────────────────────────────────────
echo ""
echo "=== 10. Health check ==="
sleep 3
echo -n "  Local (Docker direct): "
curl -s http://127.0.0.1:3001/health | python3 -m json.tool 2>/dev/null \
  || curl -s http://127.0.0.1:3001/health

echo ""
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║  ✅  Setup complete!                                         ║"
echo "  ╠══════════════════════════════════════════════════════════════╣"
echo "  ║  Health (local):   http://127.0.0.1:3001/health             ║"
echo "  ║  Health (public):  https://$DOMAIN/health      ║"
echo "  ║  Logs:             cd $APP_DIR && docker compose logs -f    ║"
echo "  ╠══════════════════════════════════════════════════════════════╣"
echo "  ║  ⚠️  Cloudflare reminder:                                     ║"
echo "  ║     SSL/TLS → Overview → set mode to 'Full'                 ║"
echo "  ║     (NOT 'Full strict' — origin uses self-signed cert)      ║"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo ""
