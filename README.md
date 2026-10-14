# diskoRD

Self-hosted Discord-style chat and voice application for private communities.

## Current architecture

- **Backend:** Go + Fiber monolith in `backend/`
- **Database:** PostgreSQL via `pgxpool`
- **Cache / realtime state:** Redis for refresh sessions, rate limiting, presence, Pub/Sub, and voice state
- **Realtime gateway:** WebSocket endpoint at `/gateway`
- **Voice:** LiveKit token generation and voice-state tracking
- **Frontend:** React + Vite + TypeScript + Tailwind in `frontend/`
- **Desktop shell:** Tauri v2 project under `frontend/src-tauri/`
- **Infrastructure:** Docker Compose for local Postgres, Redis, LiveKit, and Nginx; production compose also defines backend and coturn

## Implemented capabilities

- User registration, login, refresh, logout, and JWT auth middleware
- Redis-backed auth rate limiting and persistent refresh-token sessions (1-year sliding lifetime, "Keep me logged in", rotation with 30 s grace window)
- User profile/search/update endpoints
- Guild creation, listing, update (`PATCH /guilds/:id`), deletion, membership, invites, and member management
- Text/voice channel CRUD
- Guild roles and member-role assignment endpoints/events
- Messages with cursor pagination, edit/delete, uploads, and reactions
- WebSocket gateway with heartbeat/ping-pong and events for messages, typing, presence, voice state, reactions, roles, channels, guild update/delete/membership, friends, and DM calls
- Realtime sync for channels, guilds, membership, friend removal, DM typing/edits/reactions
- Online/offline presence backed by Redis TTL keys
- Friend requests, friends list, DM channel creation/listing
- LiveKit voice token endpoint and Redis-backed voice participant state
- In-voice soundboard: compact searchable popover, rapid retriggering, local previews, listener volume, and member-uploaded guild sounds (15 seconds, 48 sounds per guild; requires migrations `000016` and `000019`)
- DM voice/video calls (ring, accept/decline, camera, soundboard) with recovery from dropped clients
- Desktop call window: a separate, draggable, always-on-top window for DM calls and guild voice, with call controls and soundboard
- User settings: input/output/camera devices, mic test, permissions with shortcuts to the OS privacy settings
- Desktop shell: tray icon and close-to-tray, external links open in the default browser, auto-updater
- Link preview endpoint (bare domains such as `example.com` are linkified too)
- React UI for auth, guilds/channels, messaging, friends/DMs, roles, voice, notifications, and desktop updater/noise-cancellation integration

## Local development

### 1. Start local services

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:

- Postgres on `localhost:5433`
- Redis on `localhost:6380`
- LiveKit on `localhost:7880`
- Nginx on `localhost:80`

Local LiveKit carries media over ICE/TCP on `7881`; its UDP range is not forwarded, because forwarding it through Docker Desktop on macOS stops all port forwarding as soon as a call starts.

Local database defaults:

```txt
DB user:     diskord
DB password: diskord
DB name:     diskord
```

### 2. Apply database migrations

Install `golang-migrate`, then run:

```bash
migrate -path backend/migrations \
  -database "postgres://diskord:diskord@localhost:5433/diskord?sslmode=disable" \
  up
```

### 3. Run the backend

```bash
cd backend
go run ./cmd/server
```

Backend health check:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"data":"ok"}
```

### 4. Run the frontend

For local backend access, override the production values in `frontend/.env`:

```bash
cd frontend
VITE_API_URL=http://localhost:8080 \
VITE_WS_URL=ws://localhost:8080/gateway \
npm run dev
```

Or put the two variables in `frontend/.env.development.local` (gitignored, dev only) and run `npm run dev`.

Open http://localhost:5173.

## Useful commands

### Backend

```bash
cd backend
go test ./...
go build ./cmd/server
```

### Frontend

```bash
cd frontend
npm run build
npm run lint
npm run test
```

Current known test state: backend tests pass; frontend build/lint run, but the voice layout test file currently has failing expectations against the implemented layout behavior.

## Releases and deployment

- **Desktop release:** bump the version in `frontend/package.json`, `frontend/src-tauri/Cargo.toml` and `frontend/src-tauri/tauri.conf.json`, then push a `v*` tag. The release workflow builds and signs the **Windows** installer and publishes `latest.json`; installed Windows apps update themselves. macOS builds are not produced by CI.
- **Backend + web deploy** to an already provisioned server: upload the code, then run `scripts/update.sh`. It backs up the backend image, web build and database, rebuilds, runs migrations and prints a rollback command. Deploy the backend before a release reaches users when new clients depend on new endpoints.

```bash
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude target --exclude .pi-logs --exclude .claude --exclude '.env*' --exclude DEV_CREDENTIALS.md --exclude backend/server ./ root@204.168.224.53:/opt/diskord/
ssh root@204.168.224.53 "bash /opt/diskord/scripts/update.sh"
```

- `scripts/deploy.sh` provisions a fresh VPS (packages, firewall, TLS); don't use it on a running server.

## Notes

- Sessions: set `JWT_REFRESH_EXPIRY=8760h` (default) for persistent login. Redis must run with `--appendonly yes` (already set in the compose files) or restarts will log everyone out.

- No seeded backend dev account is defined. Register a local account through the UI/API.
- File uploads are implemented with local disk storage. MinIO is not implemented in the current backend.
- Local Docker Compose does not include coturn. Coturn is present in the production compose file.
- pgBouncer is not configured in the current repository.
