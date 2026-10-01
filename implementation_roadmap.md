# Concord — Self-Hosted Discord Alternative

> Current implementation status and original phase roadmap. This file reflects the code that exists today; it is not a deployment guide.

---

## Tech Stack

| Layer | Technology | Current repository state |
|---|---|---|
| Backend | Go + Fiber | Implemented in `backend/` |
| Realtime / Voice | LiveKit self-hosted server | Local and production compose include LiveKit |
| NAT Traversal | Coturn | Defined in production compose only |
| Primary DB | PostgreSQL | Local/prod compose use Postgres; pgBouncer is not configured |
| Cache / Ephemeral | Redis | Presence, sessions, rate limiting, Pub/Sub, voice/call state |
| Frontend | React + Vite + TypeScript + Tailwind | Implemented in `frontend/` |
| Desktop | Tauri | Implemented under `frontend/src-tauri/` |
| Infrastructure | Docker Compose + Nginx | Local compose starts Postgres, Redis, LiveKit, Nginx; production compose adds backend and coturn |

---

## Current Implementation State by Phase

### Phase 0 — Foundation

Current state: implemented.

- [x] Go module and backend folder structure
- [x] React + Vite frontend with TypeScript
- [x] Docker Compose local services: Postgres, Redis, LiveKit, Nginx
- [x] Environment config management with Viper/defaults
- [x] Basic CI pipeline
- [x] Nginx reverse proxy config for local and production

### Phase 1 — Auth & User System

Current state: implemented, except MinIO storage is not implemented.

- [x] PostgreSQL `users` table
- [x] bcrypt password hashing
- [x] JWT access token + refresh token flow
- [x] `POST /auth/register`
- [x] `POST /auth/login`
- [x] `POST /auth/refresh`
- [x] `POST /auth/logout`
- [x] Auth middleware
- [x] Redis refresh-token session store (rotation with grace window, 1-year sliding lifetime, `rememberMe`)
- [x] Frontend session keeper: background refresh, focus revalidation, no logout on transient errors
- [x] Redis-backed rate limiting on auth endpoints
- [x] User profile endpoints (`GET /users/:id`, `PATCH /users/me`)
- [x] Local upload storage

### Phase 2 — Guilds & Channels

Current state: implemented.

- [x] Guild, guild member, channel, and invite schemas
- [x] Guild create/get/update/delete/list endpoints
- [x] Invite create/join endpoints
- [x] Member list, kick, and role update endpoints
- [x] Channel create/list/update/delete endpoints
- [x] Permission middleware and role checks

### Phase 3 — Real-Time Messaging

Current state: implemented, with heartbeat/ping-pong but no session-resume implementation.

- [x] WebSocket gateway at `GET /gateway`
- [x] Connection hub for active user connections
- [x] Redis Pub/Sub for guild-scoped fanout
- [x] Message and typing gateway events
- [x] Channel create/update/delete gateway events
- [x] Guild update/delete/member gateway events
- [x] Friend request/accept/decline/remove gateway events
- [x] Heartbeat / ping-pong mechanism
- [x] REST message create/list/edit/delete endpoints
- [x] File/image upload endpoint using local storage
- [x] Frontend gateway hook and message UI

### Phase 4 — Presence & Friend System

Current state: implemented/partially implemented.

- [x] Redis online/offline presence with TTL
- [x] Presence broadcast via gateway
- [x] Friend request endpoints
- [x] Friend list endpoint
- [x] DM channel creation/listing
- [x] DM UI and gateway handling

Presence currently stores online/offline state; idle/dnd is not implemented.

### Phase 5 — Voice & Video (LiveKit)

Current state: implemented/partially implemented.

- [x] LiveKit server in Docker Compose
- [x] Production coturn service in Docker Compose
- [x] LiveKit API config in env files
- [x] `POST /channels/:id/voice/token`
- [x] Room naming: `guild:{guildId}:channel:{channelId}`
- [x] Redis voice state tracking (`voice_state:{channelId}`)
- [x] `VOICE_STATE_UPDATE` gateway events
- [x] Frontend voice UI using `livekit-client`
- [x] Mute/deafen, camera, screen share, participant layout UI

Local Docker Compose does not include coturn.

### Phase 6 — Notifications & Polish

Current state: partially implemented.

Implemented pieces include message reactions, guild role management, notification UI, link previews, and desktop updater/noise-cancellation integration. Unread tracking, server-side mention persistence, audit log, and full-text message search are not implemented as standalone backend features.

### Phase 7 — Desktop App (Tauri)

Current state: partially implemented under `frontend/src-tauri/`.

- [x] Tauri project wrapping the Vite frontend
- [x] Tauri store/updater-related code and release workflow pieces

System tray integration is not present in the current codebase.

### Phase 8 — Hardening & Self-Host Docs

Current state: partially implemented.

- [x] Production Docker Compose config
- [x] Production Nginx config
- [x] Structured logging with zerolog

A standalone self-hosting guide file is not present. Prometheus/Grafana metrics and backup automation are not present in the current codebase.

---

## Current Folder Structure

```txt
.
├── backend/
│   ├── cmd/server/          # main.go entrypoint
│   ├── internal/
│   │   ├── auth/
│   │   ├── call/
│   │   ├── channel/
│   │   ├── friend/
│   │   ├── gateway/
│   │   ├── guild/
│   │   ├── invite/
│   │   ├── linkpreview/
│   │   ├── message/
│   │   ├── presence/
│   │   ├── reaction/
│   │   ├── role/
│   │   ├── storage/
│   │   ├── user/
│   │   └── voice/
│   ├── pkg/
│   │   ├── config/
│   │   ├── db/
│   │   ├── middleware/
│   │   └── redis/
│   └── migrations/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── types/
│   ├── src-tauri/
│   └── vite.config.ts
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── livekit/
│   └── nginx/
├── tasks/
├── README.md
└── AGENTS.md
```

---

## Key Design Decisions

**Why not Rust?**
Go delivers sufficient performance for this scale with significantly faster development velocity. Rust's borrow checker introduces friction that slows feature development without measurable benefit at non-million-user scale.

**Why not Next.js?**
The app is entirely client-side behind an auth wall. SSR and SSG provide no benefit here. React + Vite gives faster builds, simpler deployment, and no server runtime overhead.

**Why not ScyllaDB/Cassandra?**
Horizontal scaling arguments are compelling at massive scale but add operational complexity without benefit for small-to-medium deployments. PostgreSQL with proper indexing handles tens of millions of messages comfortably. Migrate only when PostgreSQL becomes a proven bottleneck.

**Why LiveKit over raw Pion?**
LiveKit is production-grade SFU built on Pion. It handles room management, participant signaling, SFU forwarding, and provides first-party SDKs. Building equivalent functionality on raw Pion would take months.

**Why Tauri over Electron?**
Electron bundles a full Chromium + Node.js runtime (~150MB baseline). Tauri uses the OS's native WebView and a Rust backend, resulting in smaller binaries and significantly lower memory usage at runtime.
