#!/bin/bash
# ─────────────────────────────────────────────────────────────
# reset-and-harden.sh
# Clean reset + hardening for wa.otomator.pro (178.104.118.178 — wa-prod-1 Hetzner)
#
# Usage:  ssh root@178.104.118.178
#         bash /opt/whatsapp-service/reset-and-harden.sh
# ─────────────────────────────────────────────────────────────
set -e

REPO_DIR="/opt/whatsapp-service"
DOMAIN="wa.otomator.pro"

echo ""
echo "══════════════════════════════════════════════"
echo "  WhatsApp Service — Clean Reset + Hardening"
echo "══════════════════════════════════════════════"

# ── 1. Stop and remove old containers ────────────────────────
echo ""
echo "▶ [1/6] Stopping and removing old containers..."
cd "$REPO_DIR"
docker compose down --remove-orphans 2>/dev/null || true

# ── 2. Prune stale Docker artifacts ──────────────────────────
echo ""
echo "▶ [2/6] Pruning stale Docker images and build cache..."
docker image prune -af
docker builder prune -af

# NOTE: We do NOT prune named volumes (sessions-data) to preserve
# existing WhatsApp sessions. Uncomment the line below ONLY if you
# want a truly clean slate (users will need to re-scan QR):
#
# docker volume rm whatsapp-service_sessions-data 2>/dev/null || true

# ── 3. Pull latest code ───────────────────────────────────────
echo ""
echo "▶ [3/6] Pulling latest code from git..."
git fetch origin
git reset --hard origin/feature/supabase-org-validation
echo "  Branch: $(git branch --show-current)"
echo "  Commit: $(git log --oneline -1)"

# ── 4. Verify .env exists ────────────────────────────────────
echo ""
echo "▶ [4/6] Checking .env..."
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "  ❌ ERROR: .env file not found at $REPO_DIR/.env"
  echo "     Create it with: cp .env.example .env && nano .env"
  exit 1
fi
echo "  ✅ .env found"

# ── 5. Build and start fresh ─────────────────────────────────
echo ""
echo "▶ [5/6] Building Docker image and starting service..."
docker compose up --build -d

echo ""
echo "  Waiting 15s for service to initialize..."
sleep 15

# ── 6. UFW firewall hardening ────────────────────────────────
echo ""
echo "▶ [6/6] Hardening firewall with UFW..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (nginx)'
ufw allow 443/tcp  comment 'HTTPS (nginx)'
# Port 3001 is intentionally NOT opened — docker binds to 127.0.0.1 only
ufw reload

echo ""
echo "  Firewall rules:"
ufw status numbered

# ── Health check ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  Health Check"
echo "══════════════════════════════════════════════"
HEALTH=$(curl -s http://localhost:3001/health || echo "FAILED")
echo "  Local:  $HEALTH"

REMOTE=$(curl -s https://$DOMAIN/health || echo "FAILED")
echo "  Public: $REMOTE"

echo ""
echo "  Container status:"
docker compose ps

echo ""
echo "  Recent logs:"
docker compose logs --tail=30

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ Done. Service running at https://$DOMAIN"
echo "══════════════════════════════════════════════"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f          # follow logs"
echo "    docker compose ps               # status"
echo "    docker compose restart          # restart"
echo "    docker compose down && docker compose up -d  # redeploy"