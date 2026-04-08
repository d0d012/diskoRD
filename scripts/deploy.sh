#!/bin/bash
# diskoRD VPS deployment script
# Files are uploaded via SCP before running this script.
# Run as root on a fresh Hetzner Ubuntu 24.04 VPS:
#   ssh root@204.168.224.53 "bash /opt/diskord/scripts/deploy.sh"

set -euo pipefail

DOMAIN="diskord.ahmertezcan.com"
REPO_DIR="/opt/diskord"
EMAIL="ahmertezcan14@gmail.com"

cd "$REPO_DIR"

###############################################################################
# 1. System packages
###############################################################################
echo "==> Installing packages..."
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 certbot nodejs npm ufw

# golang-migrate binary
if ! command -v migrate &> /dev/null; then
  curl -fsSL https://github.com/golang-migrate/migrate/releases/download/v4.17.1/migrate.linux-amd64.tar.gz \
    | tar -xz -C /usr/local/bin migrate
fi

systemctl enable --now docker

###############################################################################
# 2. Firewall
###############################################################################
echo "==> Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 7880/tcp
ufw allow 7881/tcp
ufw allow 52000:52020/udp
ufw --force enable

###############################################################################
# 3. Check .env.prod
###############################################################################
if [ ! -f ".env.prod" ]; then
  echo "ERROR: .env.prod not found in $REPO_DIR"
  echo "Upload it first: scp .env.prod root@204.168.224.53:/opt/diskord/.env.prod"
  exit 1
fi

set -a; source .env.prod; set +a

###############################################################################
# 4. TLS certificate (Let's Encrypt)
###############################################################################
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "==> Obtaining TLS certificate for $DOMAIN..."
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"
fi

# Auto-renew cron
(crontab -l 2>/dev/null | grep -v "certbot renew"; \
  echo "0 3 * * * certbot renew --quiet && docker compose -f $REPO_DIR/infra/docker-compose.prod.yml --env-file $REPO_DIR/.env.prod restart nginx coturn") \
  | crontab -

###############################################################################
# 5. Build frontend (static files served by nginx)
###############################################################################
echo "==> Building frontend..."
cd "$REPO_DIR/frontend"
npm ci --silent
npm run build
cd "$REPO_DIR"

###############################################################################
# 6. Start Docker services
###############################################################################
echo "==> Starting services..."
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build

###############################################################################
# 7. Database migrations
###############################################################################
echo "==> Waiting for Postgres to be ready..."
sleep 8

POSTGRES_CONTAINER=$(docker compose -f infra/docker-compose.prod.yml ps -q postgres)
POSTGRES_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$POSTGRES_CONTAINER")

echo "==> Running migrations..."
migrate \
  -path "$REPO_DIR/backend/migrations" \
  -database "postgres://${DB_USER}:${DB_PASSWORD}@${POSTGRES_IP}:5432/${DB_NAME}?sslmode=disable" \
  up

echo ""
echo "==> Deploy complete!"
echo "    Health:  https://$DOMAIN/api/health"
echo "    WS:      wss://$DOMAIN/gateway"
echo ""
echo "Next: build Tauri on your Mac -> npm run tauri:build"
