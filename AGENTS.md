# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) and Cursor agents when working with code in this repository.

Note: `AGENTS.md` and `CLAUDE.md` intentionally duplicate project guidance for different coding agents. Keep them in sync when changing shared architecture, commands, or conventions.

## Project Overview

**diskoRD (Concord)** is a self-hosted Discord alternative built for privacy-first communities. High-performance, low-latency chat and voice platform.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go + Fiber |
| Realtime / Voice | LiveKit (self-hosted SFU) |
| NAT Traversal | Coturn (TURN/STUN) in production compose |
| Primary DB | PostgreSQL |
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

Go module: `github.com/d0d012/diskord`. Go + Fiber monolith organized by domain under `internal/`. Most domain packages follow this layout where applicable:

```
internal/<domain>/
  handler.go      # Fiber route handlers
  service.go      # Business logic
  repository.go   # Database queries, when the domain owns DB access
  models.go       # Request/response structs, domain types
  routes.go       # Route registration
  <domain>_test.go # present for selected packages
```

Domains:
- `internal/auth/` — JWT access + refresh token flow, bcrypt password hashing, auth middleware
- `internal/gateway/` — WebSocket hub, connection management per user, Redis Pub/Sub fanout for guild-scoped messaging
- `internal/guild/` — guilds, members, guild roles, permission checks
- `internal/channel/` — text and voice channel CRUD
- `internal/invite/` — invite creation and join flow
- `internal/message/` — message CRUD, cursor-based pagination, soft delete, upload endpoint
- `internal/presence/` — Redis-backed online/offline presence heartbeats (`presence:{userId}` key with TTL), broadcast via gateway
- `internal/voice/` — LiveKit JWT token generation, voice state in Redis (`voice_state:{channelId}`)
- `internal/friend/` — friend requests, friendships, DM channel creation
- `internal/call/` — DM call signaling
- `internal/reaction/` — message reactions
- `internal/role/` — guild roles and member-role assignments
- `internal/storage/` — local disk file uploads
- `internal/linkpreview/` — link preview endpoint
- `pkg/db/` — PostgreSQL connection helper
- `pkg/redis/` — Redis client wrapper
- `pkg/config/` — Viper config loader from `.env`

### WebSocket Gateway

Single `/gateway` endpoint handles real-time events. Redis Pub/Sub fans out guild-scoped events across backend instances; direct user and DM notifications are delivered by the local hub. Implemented event categories include message create/update/delete, typing, presence, voice state, reactions, guild member updates, role updates, and DM call signaling. Includes heartbeat/ping-pong; session resume is not implemented. Guild/channel/membership events: `GUILD_UPDATE`, `GUILD_DELETE`, `GUILD_MEMBER_ADD/UPDATE/REMOVE`, `CHANNEL_CREATE/UPDATE/DELETE`; friends: `FRIEND_REMOVE`. Guild routing sets on each client are mutex-guarded (`Client.HasGuild/AddGuild/RemoveGuild`).

Common gateway ops include `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `TYPING_START`, `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE`, `GUILD_UPDATE`, `GUILD_DELETE`, `GUILD_MEMBER_ADD`, `GUILD_MEMBER_UPDATE`, `GUILD_MEMBER_REMOVE`, `PRESENCE_UPDATE`, `VOICE_STATE_UPDATE`, `REACTION_ADD`, `REACTION_REMOVE`, `ROLE_CREATE`, `ROLE_UPDATE`, `ROLE_DELETE`, `ROLE_REORDER`, `MEMBER_ROLE_ADD`, `MEMBER_ROLE_REMOVE`, `FRIEND_REQUEST`, `FRIEND_ACCEPT`, `FRIEND_DECLINE`, `FRIEND_REMOVE`, and `CALL_*` events.

Event format:
```json
{ "op": "MESSAGE_CREATE", "d": { ... }, "s": 42 }
```

### Frontend (`frontend/src/`)

- `components/ui/` — shared UI helpers currently including `PresenceDot`
- `components/layout/` — app shell, sidebars, members panel, title bar
- `features/<domain>/` — domain-specific components for guilds, channels, messages, friends/DMs, calls, voice, notifications
- `hooks/` — `useGateway` (WS connection), `useVoice` (LiveKit), `useNoiseCancellation`, `useUpdater`
- `stores/` — Zustand for global state
- `lib/api.ts` — Axios instance, shared token refresh, background session keeper
- `types/` — shared TypeScript types
- `pages/` — route-level page components

### Authentication & sessions

- Access token: JWT, 15 min (`JWT_ACCESS_EXPIRY`). Refresh token: opaque, stored hashed in Redis (`refresh:{sha256}`), `JWT_REFRESH_EXPIRY=8760h` (1 year), renewed on every refresh so active accounts stay signed in until they log out.
- Refresh tokens rotate on use. The old token stays valid for a 30 s grace window so a lost response or two racing clients don't end the session.
- `POST /auth/login` accepts `rememberMe` (default `true`); `false` limits the session to 24 h.
- Redis runs with `appendonly yes` so sessions survive restarts. Wiping Redis or changing `JWT_ACCESS_SECRET` logs everyone out.
- Frontend (`lib/api.ts`): one shared `refreshSession()` (concurrent callers share a request), refreshes ~2 min before expiry and on window focus/visibility/online. Only an explicit 400/401/403 from `/auth/refresh` logs the user out; network errors, 5xx and 429 retry with backoff and keep credentials. The rotated refresh token is persisted before anything else. `useGateway` reconnects with the freshest token (backoff 1–30 s, immediate on focus) and refreshes on close code 4001.

### DM calls

State lives in Redis: `call:{channelId}` hash (`caller`, `callee`, `state` = ringing|active) plus `usercall:{userId}` for busy checks. Rings time out after 30 s (`CALL_TIMEOUT` to both sides); active calls expire after 90 s unless clients ping `POST /dms/:id/call/keepalive` (every 30 s). Initiate returns 409 if either user is busy or the DM already has a call; only the callee can accept/decline. Frontend: `DMCallPanel` is mounted app-wide in `AppPage` (floating card, remote audio via `GlobalVoiceAudio`), hangs up if the other side leaves the LiveKit room, and ends the call on `pagehide`/logout. Joining a DM call leaves any guild voice channel.

### Voice (LiveKit)

Backend generates a LiveKit JWT via `POST /channels/:id/voice/token`. Room naming convention: `guild:{guildId}:channel:{channelId}`. Frontend uses `livekit-client`. Coturn is configured in production Docker Compose for TURN/STUN.

### Infrastructure (`infra/`)

Local Docker Compose brings up Postgres, Redis, LiveKit, and Nginx. Production Docker Compose also defines backend and coturn services; Nginx is the TLS-terminating reverse proxy in production.

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

Branch naming: `feature/{short-description}`, `fix/{short-description}`, `refactor/{short-description}`, or `task/{task-id-short-description}` for active task files

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

Task specs live under `tasks/`:

- `tasks/active/` — tasks ready to implement now
- `tasks/features/` — brand-new user-visible capabilities
- `tasks/backlog/` — grouped future polish, reliability, infrastructure, and desktop work
- `tasks/archive/` — older phase-based specs kept for reference

When starting a task:

1. Read `tasks/README.md` and the task spec first
2. Read any existing code the task depends on
3. Follow the conventions in `.cursor/rules/`
4. Run relevant tests before considering the task done

### Task Execution Order

Within each phase: **DB migrations → backend endpoints → WebSocket events → frontend UI → tests**

```
Phase 0 (foundation) → 1 (auth) → 2 (guilds/channels) → 3 (messaging) →
4 (presence/friends) → 5 (voice) → 6 (notifications/polish) →
7 (Tauri desktop) → 8 (hardening/self-host docs)
```

### Pattern Matching

Use `internal/auth/` as a reference pattern for domain packages where it fits. Keep handler/service/repository separation, error handling, and test approach consistent, while allowing packages without direct DB ownership to omit repositories.

## Key Design Decisions

- **Go over Rust**: sufficient performance, faster development velocity at this scale
- **React + Vite over Next.js**: fully client-side behind auth wall — SSR/SSG provide no benefit
- **PostgreSQL over ScyllaDB**: handles tens of millions of messages with proper indexing; migrate only when proven bottleneck
- **LiveKit over raw Pion**: production-grade SFU with first-party SDKs; building on raw Pion would take months
- **Tauri over Electron**: ~5–10MB binaries vs ~150MB; uses OS native WebView instead of bundled Chromium
