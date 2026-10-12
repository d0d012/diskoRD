#!/bin/bash
# Update an already provisioned diskoRD VPS to the code in /opt/diskord.
# (First-time server setup is scripts/deploy.sh.)
#
#   rsync -az --exclude .git --exclude node_modules --exclude dist --exclude target \
#     --exclude .pi-logs --exclude .claude --exclude '.env*' --exclude DEV_CREDENTIALS.md \
#     --exclude backend/server ./ root@204.168.224.53:/opt/diskord/
#   ssh root@204.168.224.53 "bash /opt/diskord/scripts/update.sh"
#
# Backs up the running backend image, the web build and the database first, and prints
# the rollback command at the end. Volumes (database, Redis sessions, uploads) are kept.

set -euo pipefail

REPO_DIR="/opt/diskord"
BACKUP_DIR="/root/diskord-backups"
COMPOSE=(docker compose -f "$REPO_DIR/infra/docker-compose.prod.yml" --env-file "$REPO_DIR/.env.prod")

cd "$REPO_DIR"
if [ ! -f .env.prod ]; then
  echo "ERROR: $REPO_DIR/.env.prod not found"
  exit 1
fi
set -a; source .env.prod; set +a

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

###############################################################################
# 1. Backups
###############################################################################
echo "==> Backing up ($STAMP)..."
BACKEND_IMAGE=$("${COMPOSE[@]}" config --images | grep -i backend | head -1)
if docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1; then
  docker tag "$BACKEND_IMAGE" "diskord-backend-backup:$STAMP"
  echo "    backend image -> diskord-backend-backup:$STAMP"
fi
if [ -d frontend/dist ]; then
  cp -r frontend/dist "$BACKUP_DIR/dist-$STAMP"
  echo "    web build     -> $BACKUP_DIR/dist-$STAMP"
fi
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_DIR/db-$STAMP.sql"
echo "    database      -> $BACKUP_DIR/db-$STAMP.sql"

###############################################################################
# 2. Web build (served by nginx from frontend/dist)
###############################################################################
echo "==> Building frontend..."
cd "$REPO_DIR/frontend"
npm ci --silent
npm run build
cd "$REPO_DIR"

###############################################################################
# 3. Services — only containers whose image or config changed are recreated
###############################################################################
echo "==> Starting services..."
"${COMPOSE[@]}" up -d --build

echo "==> Waiting for Postgres..."
for _ in $(seq 1 30); do
  "${COMPOSE[@]}" exec -T postgres pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
  sleep 2
done

###############################################################################
# 4. Database migrations
###############################################################################
echo "==> Running migrations..."
POSTGRES_CONTAINER=$("${COMPOSE[@]}" ps -q postgres)
POSTGRES_IP=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$POSTGRES_CONTAINER")
migrate \
  -path "$REPO_DIR/backend/migrations" \
  -database "postgres://${DB_USER}:${DB_PASSWORD}@${POSTGRES_IP}:5432/${DB_NAME}?sslmode=disable" \
  up

"${COMPOSE[@]}" ps --format "table {{.Name}}\t{{.Status}}"

echo ""
echo "==> Update complete."
echo "    Roll back the backend and web build with:"
echo "      docker tag diskord-backend-backup:$STAMP $BACKEND_IMAGE && \\"
echo "      ${COMPOSE[*]} up -d --no-build backend && \\"
echo "      rm -rf $REPO_DIR/frontend/dist && cp -r $BACKUP_DIR/dist-$STAMP $REPO_DIR/frontend/dist"
echo "    Database backup: $BACKUP_DIR/db-$STAMP.sql"
