# Phase 4 — Presence & Friend System

> Prerequisite: Phase 3 complete (messaging + WebSocket gateway working)

## Dependency Graph

```
4.1 (presence) ─────────────────────────────────┐
                                                 ├──→ 4.5 (frontend)
4.2 (friendship migration) → 4.3 (friend API) → 4.4 (DMs) ──┘
```

**Can run in parallel:**
- 4.1 + 4.2 (completely separate: presence is Redis-only in `internal/presence/`, migrations are SQL files)
- 4.1 + 4.3 (presence writes to `internal/presence/`, friends writes to `internal/friend/`)

**Must be sequential:**
- 4.2 → 4.3 (friend endpoints need friendship tables)
- 4.3 → 4.4 (DMs depend on friend relationships)
- 4.5 after 4.1 + 4.4 (frontend needs all backend APIs)

---

## Task 4.1: Presence System

**Parallel group: E** | Writes to: `backend/internal/presence/`

**Goal:** Track online/offline/idle/dnd status via Redis with real-time broadcast.

**Redis keys:**
- `presence:{userId}` → `"online"` with 60s TTL
- Client sends heartbeat every 30s which resets the TTL
- When TTL expires → user is offline

**Implementation:**
- `internal/presence/` — service.go, models.go
- On WebSocket connect: set presence to `online`
- On heartbeat: refresh TTL
- On disconnect: delete key (immediate offline)
- Presence changes broadcast via `PRESENCE_UPDATE` gateway event to guild members
- `GET /guilds/:id/members` includes each member's presence status (read from Redis)

**Acceptance criteria:**
- User shows online after connecting
- User shows offline after disconnecting
- Presence updates propagate to guild members in real-time

---

## Task 4.2: Friendship Migrations

**Parallel group: E** | Writes to: `backend/migrations/`

**Schema:**
```sql
-- 000007_create_friendships.up.sql
CREATE TABLE friendships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sender_id, receiver_id)
);
CREATE INDEX idx_friendships_receiver_id ON friendships(receiver_id);

-- 000008_create_dm_channels.up.sql
CREATE TABLE dm_channels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_a_id, user_b_id)
);
```

**Acceptance criteria:**
- Migrations run cleanly up and down
- Constraints enforce uniqueness

---

## Task 4.3: Friend System Endpoints

**Depends on: 4.2** | Writes to: `backend/internal/friend/`

**Files:** `internal/friend/` — models.go, repository.go, service.go, handler.go, routes.go

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /users/:id/friend-request | Yes | Send friend request |
| POST | /friend-requests/:id/accept | Yes | Accept friend request |
| POST | /friend-requests/:id/decline | Yes | Decline friend request |
| DELETE | /friends/:id | Yes | Remove friend |
| GET | /users/me/friends | Yes | List friends |
| GET | /users/me/friend-requests | Yes | List pending requests |

**State machine:** pending → accepted (or declined/deleted)

**Acceptance criteria:**
- Can send, accept, decline friend requests
- Cannot send duplicate requests
- Blocked users cannot send requests
- Friend list returns only accepted friendships

---

## Task 4.4: DM Channels

**Depends on: 4.3** | Writes to: `backend/internal/friend/dm_handler.go`, `backend/internal/friend/dm_repository.go`

**Goal:** Direct message channels between friends.

**Implementation:**
- DM channel created on first message between two users
- DMs reuse the same message table (messages.channel_id → dm_channels.id)
- `GET /users/me/dms` lists DM channels with last message preview
- DM messages flow through the same gateway as guild messages

**Acceptance criteria:**
- Can send DMs to friends
- DM channel persists across sessions
- DM messages appear in real-time via WebSocket

---

## Task 4.5: Presence & Friends Frontend

**Depends on: 4.1 + 4.4** | Writes to: `frontend/src/`

**Components:**
- `features/friend/FriendList.tsx` — friends with presence indicators
- `features/friend/FriendRequestList.tsx` — pending requests with accept/decline
- `features/friend/DMList.tsx` — DM conversations sidebar
- `hooks/usePresence.ts` — subscribe to presence updates via gateway
- Online indicator (green dot) on user avatars throughout the app

**Acceptance criteria:**
- Friends list shows online/offline status
- Can manage friend requests from UI
- DM conversations accessible from sidebar
