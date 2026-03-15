# Concord — Self-Hosted Discord Alternative
> High-performance, low-latency chat & voice platform built for privacy-first communities.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend | Go + Fiber | Low memory, excellent concurrency, LiveKit ecosystem fit |
| Realtime / Voice | LiveKit (self-hosted) | Production-grade SFU, Opus codec, SDK support |
| NAT Traversal | Coturn | TURN/STUN for WebRTC behind NAT |
| Primary DB | PostgreSQL + pgBouncer | Relational data + connection pooling |
| Cache / Ephemeral | Redis | Presence, sessions, rate limiting, pub/sub |
| Frontend | React + Vite | Fast builds, client-side SPA, no SSR overhead |
| Desktop | Tauri | Lightweight native shell, no Electron bloat |
| Infrastructure | Hetzner VPS + Nginx + Docker | Low cost, self-hosted, full control |

---

## Project Roadmap

### Phase 0 — Foundation
> Goal: Project skeleton, CI/CD, and local dev environment running.

- [ ] Initialize Go module, folder structure (`/cmd`, `/internal`, `/pkg`)
- [ ] Initialize React + Vite frontend with TypeScript
- [ ] Docker Compose setup (Postgres, Redis, LiveKit, Coturn, Nginx)
- [ ] Environment config management (`.env`, Viper)
- [ ] Basic CI pipeline (GitHub Actions — lint, test, build)
- [ ] Nginx reverse proxy config with TLS (self-signed for local, Let's Encrypt for prod)

---

### Phase 1 — Auth & User System
> Goal: Users can register, log in, and maintain sessions.

- [ ] PostgreSQL schema — `users` table
- [ ] Password hashing (bcrypt / argon2id)
- [ ] JWT access token + refresh token flow
- [ ] `POST /auth/register`
- [ ] `POST /auth/login`
- [ ] `POST /auth/refresh`
- [ ] `POST /auth/logout`
- [ ] Auth middleware (JWT validation on protected routes)
- [ ] Redis session store for refresh tokens
- [ ] Rate limiting on auth endpoints (Redis-backed)
- [ ] User profile endpoints (`GET /users/:id`, `PATCH /users/me`)
- [ ] Avatar upload → stored on local disk / MinIO

---

### Phase 2 — Guilds & Channels
> Goal: Users can create servers, join them, and browse channels.

**Database schema:**
- `guilds` — id, name, owner_id, icon, created_at
- `guild_members` — guild_id, user_id, role, joined_at
- `channels` — id, guild_id, name, type (text/voice), position, created_at

**Endpoints:**
- [ ] `POST /guilds` — create guild
- [ ] `GET /guilds/:id` — get guild info
- [ ] `DELETE /guilds/:id` — delete guild (owner only)
- [ ] `POST /guilds/:id/invite` — generate invite link
- [ ] `POST /invites/:code/join` — join via invite
- [ ] `GET /guilds/:id/members` — list members
- [ ] `DELETE /guilds/:id/members/:userId` — kick member
- [ ] `POST /guilds/:id/channels` — create channel
- [ ] `PATCH /channels/:id` — update channel
- [ ] `DELETE /channels/:id` — delete channel
- [ ] Permission middleware (owner / member role checks)

---

### Phase 3 — Real-Time Messaging
> Goal: Users can send and receive messages in real time.

**Database schema:**
- `messages` — id, channel_id, author_id, content, created_at, edited_at, deleted_at

**WebSocket Gateway (Go):**
- [ ] WebSocket upgrade endpoint (`GET /gateway`)
- [ ] Connection hub — manage active connections per user
- [ ] Redis Pub/Sub for cross-instance message fanout
- [ ] Event types: `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `TYPING_START`
- [ ] Heartbeat / ping-pong mechanism
- [ ] Reconnection handling with session resume

**REST fallback:**
- [ ] `POST /channels/:id/messages` — send message
- [ ] `GET /channels/:id/messages` — paginated history (cursor-based)
- [ ] `PATCH /messages/:id` — edit message
- [ ] `DELETE /messages/:id` — soft delete

**Frontend:**
- [ ] WebSocket client hook (`useGateway`)
- [ ] Message list with virtualized scroll (react-virtual)
- [ ] Optimistic message send (show immediately, confirm on ACK)
- [ ] Typing indicator
- [ ] File/image attachment upload

---

### Phase 4 — Presence & Friend System
> Goal: Online/offline status, friends list, DMs.

**Redis keys:**
- `presence:{userId}` → `online | idle | dnd | offline` with TTL

**Database schema:**
- `friendships` — user_id, friend_id, status (pending/accepted/blocked)
- `direct_channels` — id, participant_a, participant_b

**Implementation:**
- [ ] Presence heartbeat from client every 30s
- [ ] Presence broadcast to guild members via Pub/Sub
- [ ] `POST /users/:id/friend-request`
- [ ] `POST /friend-requests/:id/accept`
- [ ] `DELETE /friends/:id`
- [ ] `GET /users/me/friends`
- [ ] DM channel creation on first message
- [ ] DM message flow (same as guild messages, scoped to direct channel)

---

### Phase 5 — Voice & Video (LiveKit)
> Goal: Users can join voice channels and talk.

**Infrastructure:**
- [ ] LiveKit server deployed via Docker
- [ ] Coturn TURN/STUN server configured
- [ ] LiveKit API keys stored in env

**Backend:**
- [ ] `POST /channels/:id/voice/token` — generate LiveKit JWT for the user
- [ ] Room name convention: `guild:{guildId}:channel:{channelId}`
- [ ] Voice state tracking in Redis (`voice_state:{channelId}` → set of userIds)
- [ ] WebSocket events: `VOICE_STATE_UPDATE` (join/leave/mute/deafen)

**Frontend:**
- [ ] LiveKit React SDK integration (`@livekit/components-react`)
- [ ] Voice channel UI — participant list, speaking indicator
- [ ] Mute / deafen controls
- [ ] Camera toggle (video support)
- [ ] Screen share

---

### Phase 6 — Notifications & Polish
> Goal: UX completeness before desktop packaging.

- [ ] Unread message tracking (Redis bitmap or DB counter)
- [ ] Mention detection (`@username` parsing)
- [ ] Browser push notifications (Web Push API)
- [ ] Message reactions (emoji)
- [ ] Message pinning
- [ ] Role management (admin, moderator, member)
- [ ] Channel permission overrides per role
- [ ] Audit log (`audit_logs` table)
- [ ] Search messages (PostgreSQL full-text search)

---

### Phase 7 — Desktop App (Tauri)
> Goal: Native desktop experience wrapping the web frontend.

- [ ] Tauri project setup wrapping the Vite build
- [ ] System tray integration (minimize to tray)
- [ ] Native desktop notifications
- [ ] Auto-updater
- [ ] Build pipelines for Windows, macOS, Linux

---

### Phase 8 — Hardening & Self-Host Docs
> Goal: Anyone can deploy their own instance.

- [ ] Docker Compose production config
- [ ] Automated database migrations (golang-migrate)
- [ ] Backup strategy (pg_dump cron + MinIO)
- [ ] Prometheus + Grafana metrics
- [ ] Structured logging (zerolog)
- [ ] `SELF_HOSTING.md` — step-by-step VPS deployment guide
- [ ] Security audit (OWASP basics — input validation, CSP headers, CORS)

---

## Implementation Order (Agentic Dev Sequence)

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
```

Each phase should be fully functional and tested before moving to the next.
Within each phase, follow this micro-order:

```
DB schema / migrations → Backend endpoints → WebSocket events (if any) → Frontend UI → Integration test
```

---

## Folder Structure

```
concord/
├── backend/
│   ├── cmd/
│   │   └── server/          # main.go entrypoint
│   ├── internal/
│   │   ├── auth/            # JWT, bcrypt, middleware
│   │   ├── gateway/         # WebSocket hub, event dispatcher
│   │   ├── guild/           # guild, channel, member handlers
│   │   ├── message/         # message CRUD, history
│   │   ├── presence/        # Redis presence tracking
│   │   ├── voice/           # LiveKit token generation
│   │   ├── friend/          # friendships, DMs
│   │   └── storage/         # file upload, MinIO client
│   ├── pkg/
│   │   ├── db/              # PostgreSQL connection, migrations
│   │   ├── redis/           # Redis client wrapper
│   │   └── config/          # Viper config loader
│   └── migrations/          # SQL migration files
├── frontend/
│   ├── src/
│   │   ├── components/      # UI components
│   │   ├── hooks/           # useGateway, useVoice, usePresence
│   │   ├── pages/           # route-level components
│   │   ├── stores/          # Zustand stores
│   │   └── lib/             # API client, WS client, utils
│   └── vite.config.ts
├── desktop/                 # Tauri wrapper (Phase 7)
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── nginx/
│   │   └── nginx.conf
│   ├── livekit/
│   │   └── livekit.yaml
│   └── coturn/
│       └── turnserver.conf
├── ROADMAP.md               # this file
├── SELF_HOSTING.md          # deployment guide (Phase 8)
└── .env.example
```

---

## Key Design Decisions

**Why not Rust?**
Go delivers sufficient performance for this scale with significantly faster development velocity. Rust's borrow checker introduces friction that slows feature development without measurable benefit at non-million-user scale.

**Why not Next.js?**
The app is entirely client-side behind an auth wall. SSR and SSG provide no benefit here. React + Vite gives faster builds, simpler deployment, and no server runtime overhead.

**Why not ScyllaDB/Cassandra?**
Horizontal scaling arguments are compelling at massive scale but add operational complexity without benefit for small-to-medium deployments. PostgreSQL with proper indexing and pgBouncer connection pooling handles tens of millions of messages comfortably. Migrate only when PostgreSQL becomes a proven bottleneck.

**Why LiveKit over raw Pion?**
LiveKit is production-grade SFU built on Pion. It handles room management, participant signaling, SFU forwarding, and provides first-party React, Flutter, Swift, and Kotlin SDKs. Building equivalent functionality on raw Pion would take months.

**Why Tauri over Electron?**
Electron bundles a full Chromium + Node.js runtime (~150MB baseline). Tauri uses the OS's native WebView and a Rust backend, resulting in ~5-10MB binaries and significantly lower memory usage at runtime.