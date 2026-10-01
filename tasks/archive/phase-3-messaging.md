# Phase 3 — Real-Time Messaging

> Prerequisite: Phase 2 complete (guilds, channels, members working)

## Dependency Graph

```
3.1 (migration) ──┬──→ 3.2 (message REST) ──┐
                   │                          ├──→ 3.4 (wire to gateway) ──→ 3.6 (frontend)
                   └──→ 3.3 (WS gateway) ────┘            │
                                                 3.5 (typing) ←─┘
```

**Can run in parallel:**
- 3.2 + 3.3 (message REST endpoints + WebSocket gateway core — completely separate packages)
- 3.5 can be done alongside 3.6 if 3.4 is complete

**Must be sequential:**
- 3.1 first (migration)
- 3.4 after both 3.2 + 3.3 (wires message service to gateway hub)
- 3.6 after 3.4 (frontend needs both REST + WS working)

---

## Task 3.1: Messages Table Migration

**Sequential — run first** | Writes to: `backend/migrations/`

**Schema:**
```sql
-- 000006_create_messages.up.sql
CREATE TABLE messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at  TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_channel_id_created_at ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_author_id ON messages(author_id);
```

**Acceptance criteria:**
- Migration runs cleanly
- Composite index on (channel_id, created_at DESC) for efficient pagination

---

## Task 3.2: Message REST Endpoints

**Parallel group: D** (after 3.1) | Writes to: `backend/internal/message/`

**Goal:** CRUD for messages with cursor-based pagination.

**Files:** `internal/message/` — models.go, repository.go, service.go, handler.go, routes.go

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /channels/:id/messages | Yes | Send message (must be guild member) |
| GET | /channels/:id/messages?before=&limit= | Yes | Get message history |
| PATCH | /messages/:id | Yes | Edit message (author only) |
| DELETE | /messages/:id | Yes | Soft delete (author or guild owner) |

**Pagination:**
- Default limit: 50, max: 100
- `before` cursor is a message ID
- Response: `{ "data": { "items": [...], "hasMore": true } }`
- Messages ordered by `created_at DESC`

**Important:** The service should accept an optional `EventPublisher` interface for broadcasting events. For now, implement the REST layer only — Task 3.4 will inject the gateway publisher.

**Acceptance criteria:**
- Can send, retrieve, edit, and soft-delete messages
- Pagination returns correct pages
- Only author can edit, author or owner can delete
- Deleted messages excluded from queries (WHERE deleted_at IS NULL)

---

## Task 3.3: WebSocket Gateway Core

**Parallel group: D** (after 3.1) | Writes to: `backend/internal/gateway/`

**Goal:** WebSocket hub with connection management, heartbeat, and Redis Pub/Sub.

**Files:**
- `hub.go` — connection registry (map[userID][]*Client), broadcast methods, subscribe to Redis
- `client.go` — per-connection read/write pump goroutines
- `events.go` — event type constants, Event struct, marshal/unmarshal
- `handler.go` — Fiber WebSocket upgrade handler at `GET /gateway`
- `gateway_test.go`

**Connection lifecycle:**
1. Client connects to `/gateway` with JWT in query param or header
2. Server authenticates, registers connection in hub (keyed by userID)
3. Server sends `HELLO` event with heartbeat interval
4. Client sends `HEARTBEAT` every 30s; server responds with `HEARTBEAT_ACK`
5. If no heartbeat for 60s, server closes connection
6. On disconnect, clean up from hub

**Redis Pub/Sub:**
- Backend publishes events to Redis channel `gateway:events`
- All backend instances subscribe and fan out to local connections
- Publish method: `hub.Publish(event Event)` — serializes and pushes to Redis
- Subscribe loop: receives from Redis, deserializes, routes to correct clients based on guild membership

**Event format:**
```json
{ "op": "MESSAGE_CREATE", "d": { ... }, "s": 42 }
```

**Event types:**
```
HELLO, HEARTBEAT, HEARTBEAT_ACK,
MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE,
TYPING_START,
GUILD_MEMBER_ADD, GUILD_MEMBER_REMOVE,
VOICE_STATE_UPDATE, PRESENCE_UPDATE
```

**Acceptance criteria:**
- WebSocket connects with valid JWT
- Heartbeat/pong keeps connection alive
- Connection closes after missed heartbeats
- Events published to Redis are received by all connected clients in the target guild

---

## Task 3.4: Wire Messages to Gateway

**Depends on: 3.2 + 3.3** | Writes to: `backend/internal/message/handler.go` (minor), `backend/cmd/server/main.go` (wiring)

**Goal:** When a message is sent via REST, broadcast it to all connected guild members.

**Flow:**
1. `POST /channels/:id/messages` saves to DB
2. Handler calls `hub.Publish(MESSAGE_CREATE, event)` with channel_id + guild_id
3. Gateway hub receives from Redis, looks up all connections for guild members
4. Sends event to each connected member in that guild

Same for `MESSAGE_UPDATE` and `MESSAGE_DELETE`.

**Changes:**
- Inject gateway hub into message handler (via constructor or interface)
- Add publish calls after successful DB writes in message handler
- Wire both in `main.go`

**Acceptance criteria:**
- Send a message via REST → all WebSocket-connected guild members receive it in real-time
- Edit/delete also propagates
- Users not in the guild receive nothing

---

## Task 3.5: Typing Indicator

**Depends on: 3.3** | Writes to: `backend/internal/gateway/` (add handler for TYPING_START)

**Goal:** Broadcast typing status to channel members.

**Implementation:**
- Client sends `TYPING_START` event via WebSocket with `channelId`
- Gateway broadcasts to other members in the same guild
- No persistence — purely ephemeral
- Frontend shows "User is typing..." for 5 seconds after last `TYPING_START`

**Acceptance criteria:**
- Typing indicator appears for other users
- Indicator disappears after 5 seconds of no typing events

---

## Task 3.6: Message Frontend

**Depends on: 3.4** | Writes to: `frontend/src/`

**Goal:** Complete messaging UI with real-time updates.

**Components:**
- `features/message/MessageList.tsx` — message list
- `features/message/MessageItem.tsx` — single message with author, timestamp, content
- `features/message/MessageInput.tsx` — input bar with send button
- `hooks/useGateway.ts` — WebSocket connection management hook
- `stores/messageStore.ts` — messages by channel, optimistic sends

**Behavior:**
- On channel select: fetch last 50 messages via REST
- New messages arrive via WebSocket and append to list
- Scroll up to load more (infinite scroll with cursor pagination)
- Optimistic send: show message immediately, confirm on server ACK
- Typing indicator below message list

**Acceptance criteria:**
- Messages load on channel select
- Real-time messages appear without refresh
- Infinite scroll loads history
- Typing indicator works between two users
- Optimistic send provides instant feedback
