# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and Cursor agents when working with code in this repository.

## Project Overview

**diskoRD (Concord)** is a self-hosted Discord alternative built for privacy-first communities. High-performance, low-latency chat and voice platform.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go + Fiber |
| Realtime / Voice | LiveKit (self-hosted SFU) |
| NAT Traversal | Coturn (TURN/STUN) |
| Primary DB | PostgreSQL + pgBouncer |
| Cache / Ephemeral | Redis (presence, sessions, rate limiting, pub/sub) |
| Frontend | React + Vite + TypeScript + Tailwind |
| Desktop | Tauri |
| Infrastructure | Docker Compose + Nginx |

## Commands

**Backend (Go):**
```bash
cd backend
go run ./cmd/server          # run dev server
go test ./...                # run all tests
go test ./internal/auth/...  # run single package tests
go build ./cmd/server        # build binary
```

**Frontend (React + Vite):**
```bash
cd frontend
npm install
npm run dev                  # dev server
npm run build                # production build
npm run lint                 # ESLint
npm run test                 # tests
```

**Infrastructure:**
```bash
docker compose -f infra/docker-compose.yml up -d        # start local services
docker compose -f infra/docker-compose.prod.yml up -d   # production
```

**Database migrations (golang-migrate):**
```bash
migrate -path backend/migrations -database "$DATABASE_URL" up
migrate -path backend/migrations -database "$DATABASE_URL" down 1
```

## Architecture

### Backend (`backend/`)

Go module: `github.com/d0d012/diskord`. Go + Fiber monolith organized by domain under `internal/`. Each domain package uses this layout:

```
internal/<domain>/
  handler.go      # Fiber route handlers
  service.go      # Business logic
  repository.go   # Database queries
  models.go       # Request/response structs, domain types
  routes.go       # Route registration
  <domain>_test.go
```

Domains:
- `internal/auth/` — JWT access + refresh token flow, bcrypt/argon2id password hashing, auth middleware
- `internal/gateway/` — WebSocket hub, connection management per user, Redis Pub/Sub fanout for cross-instance messaging
- `internal/guild/` — guilds, channels, members, invites, permission checks
- `internal/message/` — message CRUD, cursor-based pagination, soft delete
- `internal/presence/` — Redis-backed presence heartbeats (`presence:{userId}` key with TTL), broadcast via Pub/Sub
- `internal/voice/` — LiveKit JWT token generation, voice state in Redis (`voice_state:{channelId}`)
- `internal/friend/` — friendship state machine, DM channel creation
- `internal/storage/` — file uploads to local disk or MinIO
- `pkg/db/` — PostgreSQL connection + migration runner
- `pkg/redis/` — Redis client wrapper
- `pkg/config/` — Viper config loader from `.env`

### WebSocket Gateway

Single `/gateway` endpoint handles all real-time events. Redis Pub/Sub fans out events across multiple backend instances. Event types: `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `TYPING_START`, `VOICE_STATE_UPDATE`. Includes heartbeat/ping-pong and session resume on reconnect.

Event format:
```json
{ "op": "MESSAGE_CREATE", "d": { ... }, "s": 42 }
```

### Frontend (`frontend/src/`)

- `components/ui/` — reusable primitives (Button, Input, Modal, Avatar)
- `components/layout/` — Sidebar, Header, MainLayout
- `features/<domain>/` — domain-specific components (auth/, guild/, channel/, message/, voice/)
- `hooks/` — `useGateway` (WS connection), `useVoice` (LiveKit), `usePresence`
- `stores/` — Zustand for global state
- `lib/api.ts` — Axios instance with auth interceptor + token refresh
- `types/` — shared TypeScript types
- `pages/` — route-level page components

### Voice (LiveKit)

Backend generates a LiveKit JWT via `POST /channels/:id/voice/token`. Room naming convention: `guild:{guildId}:channel:{channelId}`. Frontend uses `@livekit/components-react`. Coturn handles WebRTC behind NAT.

### Infrastructure (`infra/`)

Docker Compose brings up Postgres, Redis, LiveKit, Coturn, and Nginx. Nginx is the TLS-terminating reverse proxy. `docker-compose.prod.yml` is the production variant.

## Conventions

### API Response Envelope

All endpoints return:
```json
{ "data": { ... } }        // success
{ "error": "message" }     // error
```

Paginated lists:
```json
{ "data": { "items": [...], "hasMore": true } }
```

### Go Error Handling

- Use `fiber.NewError(statusCode, "message")` for HTTP errors
- Wrap internal errors: `fmt.Errorf("guild.Service.Create: %w", err)`
- Log with zerolog: `log.Error().Err(err).Str("userID", id).Msg("description")`
- Never expose internal errors to clients

### Database

- All PKs: `UUID DEFAULT gen_random_uuid()`
- All tables: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Updatable tables also have `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Soft delete where applicable: `deleted_at TIMESTAMPTZ`
- Foreign keys always specify `ON DELETE` behavior
- Parameterized queries only (`$1, $2`) — never string interpolation
- Index all foreign keys and frequently queried fields
- Migration file naming: `000001_create_users.up.sql` / `000001_create_users.down.sql` (6-digit prefix, every up must have a down)

### Frontend

- Named exports only (no default exports)
- Function declarations for components, not arrow const
- Zustand for global state, React state for local
- Tailwind CSS for styling

### Git Workflow

Branch naming: `feature/phase-{N}-{short-description}`, `fix/phase-{N}-{short-description}`, `refactor/{short-description}`

Commit format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`
- Scopes: `auth`, `guild`, `channel`, `message`, `gateway`, `presence`, `voice`, `friend`, `storage`, `infra`, `frontend`
- Example: `feat(auth): add JWT access and refresh token flow`

PR convention: one PR per sub-task, title matches commit format. Run `go test ./...` before committing backend changes and `npm run lint` before frontend commits.

### Testing

- Go: table-driven tests with `t.Run`, `testify/assert`, mock at repository boundary
- React: Vitest + React Testing Library
- Always test: business logic, auth/permission, handler happy path + error paths

## Agent Workflow

### Task Specs

Detailed task specs live in `tasks/phase-{N}-*.md`. Each task is independently completable. When starting a task:

1. Read the task spec file first
2. Read any existing code it depends on (previous phase's code)
3. Follow the conventions in `.cursor/rules/`
4. Run tests before considering the task done

### Task Execution Order

Within each phase: **DB migrations → backend endpoints → WebSocket events → frontend UI → tests**

```
Phase 0 (foundation) → 1 (auth) → 2 (guilds/channels) → 3 (messaging) →
4 (presence/friends) → 5 (voice) → 6 (notifications/polish) →
7 (Tauri desktop) → 8 (hardening/self-host docs)
```

### Pattern Matching

After Phase 1 is complete, use `internal/auth/` as the reference pattern for all subsequent domain packages. The file layout, handler structure, error handling, and test approach should be replicated consistently.

## Key Design Decisions

- **Go over Rust**: sufficient performance, faster development velocity at this scale
- **React + Vite over Next.js**: fully client-side behind auth wall — SSR/SSG provide no benefit
- **PostgreSQL over ScyllaDB**: handles tens of millions of messages with proper indexing + pgBouncer; migrate only when proven bottleneck
- **LiveKit over raw Pion**: production-grade SFU with first-party SDKs; building on raw Pion would take months
- **Tauri over Electron**: ~5–10MB binaries vs ~150MB; uses OS native WebView instead of bundled Chromium
