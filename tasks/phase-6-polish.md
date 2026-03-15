# Phase 6 — Notifications & Polish

> Prerequisite: Phase 5 complete (voice working)

## Dependency Graph

```
6.1 (unread tracking)
6.2 (mentions)          ← all independent, run any combination in parallel
6.3 (reactions)
6.4 (role management)
6.5 (message search)
6.6 (UI polish)
```

**All tasks in this phase are independent.** They touch different tables, different packages, and different UI components. Run as many in parallel as you have agents available.

**Suggested parallel groups:**
- Backend agents: 6.1 + 6.3 + 6.4 + 6.5 (each writes to separate packages/migrations)
- Frontend agent: 6.2 + 6.6 (UI work)

---

## Task 6.1: Unread Tracking

Writes to: `backend/internal/message/` (add unread logic), `frontend/src/`

**Goal:** Track unread messages per user per channel.

**Implementation:**
- Redis key: `unread:{userId}:{channelId}` → count
- Increment on MESSAGE_CREATE for all guild members not currently viewing that channel
- Reset to 0 when user opens a channel (client sends `CHANNEL_VIEWED` via gateway)
- Show unread badge (count) on channel list in frontend

**Acceptance criteria:**
- Unread count increments for offline/away users
- Opening a channel clears its unread count
- Badge displays on channel list

---

## Task 6.2: Mentions

Writes to: `backend/internal/message/` (parsing), `frontend/src/features/message/`

**Goal:** Parse @username mentions in messages.

**Implementation:**
- Parse `@username` in message content server-side during MESSAGE_CREATE
- Store mentioned user IDs in a `message_mentions` join table or JSONB column
- Highlight mentions in frontend MessageItem component
- Mentioned users get stronger unread indicator (different badge color/style)

**Acceptance criteria:**
- `@username` parsed and stored correctly
- Mentions render as highlighted spans in frontend
- Mentioned users see distinct notification

---

## Task 6.3: Message Reactions

Writes to: `backend/migrations/`, `backend/internal/reaction/`, `frontend/src/features/message/`

**Schema:**
```sql
CREATE TABLE message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);
```

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | /messages/:id/reactions/:emoji | Yes | Add reaction |
| DELETE | /messages/:id/reactions/:emoji | Yes | Remove reaction |

**Gateway events:** `REACTION_ADD`, `REACTION_REMOVE`

**Acceptance criteria:**
- Can add/remove emoji reactions
- Reactions display on messages with count
- Real-time reaction updates via gateway

---

## Task 6.4: Role Management

Writes to: `backend/internal/guild/` (add role logic), `backend/migrations/`

**Goal:** Admin, moderator, member roles with permission checks.

**Implementation:**
- `guild_members.role` already supports varchar — add CHECK constraint for: `owner`, `admin`, `moderator`, `member`
- Create `pkg/middleware/permission.go` — generic permission checker
- `PATCH /guilds/:id/members/:userId/role` — change member role (owner/admin only)
- Permission hierarchy: owner > admin > moderator > member

**Acceptance criteria:**
- Owner can promote/demote members
- Admins can promote to moderator but not admin
- Permission checks enforce hierarchy across all guild endpoints

---

## Task 6.5: Message Search

Writes to: `backend/migrations/`, `backend/internal/search/`, `frontend/src/features/search/`

**Goal:** Full-text search within a guild.

**Implementation:**
- Migration: add `search_vector TSVECTOR` column to messages, GIN index, trigger to auto-update
- `internal/search/` package — service.go, handler.go, routes.go
- `GET /guilds/:id/search?q=<query>&limit=25` endpoint
- Frontend: `features/search/SearchModal.tsx` — Ctrl+K to open, results list with message previews

**Acceptance criteria:**
- Search returns relevant messages ranked by relevance
- Results include message context (author, channel, timestamp)
- Frontend search modal works with keyboard shortcut

---

## Task 6.6: UI Polish

Writes to: `frontend/src/`

**Goal:** Visual refinement pass.

- Dark theme (Discord-style dark mode as default)
- Loading skeletons for message list, channel list, member list
- Error toasts for API failures (use a toast library or custom component)
- Keyboard shortcuts (Ctrl+K search, Escape close modals)
- Responsive layout basics (collapse sidebars on small screens)
- Smooth transitions and hover states

**Acceptance criteria:**
- App looks polished with consistent dark theme
- Loading states prevent layout shift
- Errors surface clearly without blocking the UI
