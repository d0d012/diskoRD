# Production Deployment Design — diskoRD on Hetzner

**Date:** 2026-04-01
**Domain:** diskord.ahmertezcan.com
**Target:** Hetzner CX22 VPS (Ubuntu 24.04), small private friend group

---

## Architecture

```
Internet
  │
  ├── :80   Nginx (HTTP → HTTPS redirect + ACME challenge)
  ├── :443  Nginx (TLS, serves frontend static + proxies API/WS)
  ├── :3478 Coturn (STUN/TURN UDP+TCP)
  ├── :5349 Coturn (TLS TURN)
  ├── :7880 LiveKit HTTP (internal use by backend JWT generation)
  ├── :7881 LiveKit TCP RTC
  └── :52000-52020/udp LiveKit WebRTC media
```

**Internal Docker network (not exposed):**
- `postgres:5432`
- `redis:6379`
- `backend:8080`

---

## Files Created

| File | Purpose |
|------|---------|
| `backend/Dockerfile` | Multi-stage Go build → alpine image |
| `infra/docker-compose.prod.yml` | All services, prod-safe, no external DB/Redis ports |
| `infra/livekit/livekit.prod.yaml` | LiveKit prod config (`use_external_ip: true`) |
| `infra/nginx/prod.conf` | TLS termination, HTTP→HTTPS, API+WS proxy, static frontend |
| `.env.prod.example` | Template — copy to `.env.prod`, fill secrets |
| `frontend/.env.production` | Vite env for Tauri build (points to prod domain) |
| `frontend/src/lib/api.ts` | Updated to read `VITE_API_URL` (Tauri compatibility) |
| `scripts/deploy.sh` | One-shot VPS setup script |

---

## Deployment Flow

1. **VPS setup:** `bash deploy.sh` — installs Docker, certbot, ufw; opens required ports
2. **TLS:** certbot standalone obtains Let's Encrypt cert for `diskord.ahmertezcan.com`
3. **Frontend build:** `npm run build` → `frontend/dist/` served by nginx statically
4. **Docker Compose up:** all services start
5. **Migrations:** `golang-migrate` runs against postgres container IP
6. **Auto-renew:** crontab entry renews cert and restarts nginx/coturn

## Tauri Distribution Flow

1. GoDaddy DNS: A record `diskord` → Hetzner VPS IP
2. VPS is up and `https://diskord.ahmertezcan.com/api/health` returns 200
3. On Mac: `cd frontend && npm run tauri:build`
   - Vite reads `.env.production` → `VITE_API_URL=https://diskord.ahmertezcan.com/api`
   - Produces `.dmg` / `.exe` / `.AppImage` in `frontend/src-tauri/target/release/bundle/`
4. Share the installer with friends directly (iMessage, Drive, etc.)

---

## Test Plan

### Server health (curl from anywhere)
```bash
curl https://diskord.ahmertezcan.com/api/health
# expects: {"data":"ok"}
```

### Auth flow
```bash
# Register
curl -X POST https://diskord.ahmertezcan.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@test.com","password":"Test1234!"}'

# Login
curl -X POST https://diskord.ahmertezcan.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!"}'
```

### WebSocket gateway
```bash
# Install wscat: npm install -g wscat
TOKEN="<access_token_from_login>"
wscat -c "wss://diskord.ahmertezcan.com/gateway?token=$TOKEN"
# expects: {"op":"HELLO","d":{"heartbeatInterval":30000},"s":0}
```

### Voice (WebRTC)
- Join a voice channel in the app → check browser devtools Network tab for `wss://` LiveKit connection
- Check coturn logs: `docker compose -f infra/docker-compose.prod.yml logs coturn`

### Tauri app locally (before VPS)
```bash
cd frontend
npm run tauri:dev
# App opens pointing to localhost — verify login/messaging works
```

---

## Secrets to generate before deploy

```bash
openssl rand -hex 32  # JWT_ACCESS_SECRET
openssl rand -hex 32  # JWT_REFRESH_SECRET
openssl rand -hex 16  # LIVEKIT_API_KEY
openssl rand -hex 32  # LIVEKIT_API_SECRET
openssl rand -hex 16  # TURN_PASSWORD
openssl rand -hex 16  # REDIS_PASSWORD
openssl rand -hex 16  # DB_PASSWORD
```

---

## Known Limitations (acceptable for friend group)

- No Tauri code signing — friends get a one-time OS warning (right-click → Open on macOS)
- Single VPS, no redundancy — acceptable for personal use
- `DB_SSLMODE=disable` — postgres and backend are on the same Docker network, no external exposure
