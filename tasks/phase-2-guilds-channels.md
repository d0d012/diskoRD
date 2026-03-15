# Phase 2 — Guilds & Channels

> Prerequisite: Phase 1 complete (auth working, users table, JWT middleware)

## Dependency Graph

```
2.1 (migrations) ──→ 2.2 (guild CRUD) ──┬──→ 2.3 (channel endpoints)
                                          ├──→ 2.4 (invite system)
                                          ├──→ 2.5 (member management)
                                          └──→ 2.6 (frontend)
```

**Can run in parallel:**
- 2.3 + 2.4 + 2.5 after 2.2 (they add to different handler files within the guild package — see file assignments below)
- 2.6 after 2.2 (frontend can start with basic guild/channel views while 2.3–2.5 complete)

**Must be sequential:**
- 2.1 → 2.2 (guild package needs the tables)

---

## Task 2.1: Guild & Channel Migrations

**Sequential — run first** | Writes to: `backend/migrations/`

**Goal:** Create DB tables for guilds, guild members, channels, and invites.

**Schemas:**

```sql
-- 000002_create_guilds.up.sql
CREATE TABLE guilds (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(100) NOT NULL,
    icon_url   TEXT,
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guilds_owner_id ON guilds(owner_id);

-- 000003_create_guild_members.up.sql
CREATE TABLE guild_members (
    guild_id  UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_guild_members_user_id ON guild_members(user_id);

-- 000004_create_channels.up.sql
CREATE TABLE channels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    type       VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'voice')),
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_channels_guild_id ON channels(guild_id);

-- 000005_create_invites.up.sql
CREATE TABLE invites (
    code       VARCHAR(10) PRIMARY KEY,
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses   INTEGER,
    use_count  INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_guild_id ON invites(guild_id);
```

**Acceptance criteria:**
- All migrations run cleanly up and down
- Foreign keys enforce referential integrity

---

## Task 2.2: Guild Domain Package (Core)

**Depends on: 2.1** | Writes to: `backend/internal/guild/`

**Goal:** Core guild CRUD with membership — the base that 2.3–2.5 extend.

**Files:**
- `models.go` — Guild, GuildMember, CreateGuildRequest, GuildResponse
- `repository.go` — CreateGuild, GetGuild, DeleteGuild, AddMember, IsMember
- `service.go` — Create (with default #general channel + owner as member), Get, Delete
- `handler.go` — handlers for guild CRUD
- `routes.go` — route registration
- `guild_test.go`

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /guilds | Yes | Create guild (creator becomes owner + member) |
| GET | /guilds/:id | Yes | Get guild info (must be member) |
| DELETE | /guilds/:id | Yes | Delete guild (owner only) |
| GET | /users/me/guilds | Yes | List guilds the current user belongs to |

**Business rules:**
- Creating a guild auto-creates a `#general` text channel
- Creator is added as owner to `guild_members`
- Only members can view guild details
- Only owner can delete

**Acceptance criteria:**
- Create guild returns guild with default channel
- Non-member gets 403 on guild endpoints
- Owner delete cascades to members and channels

---

## Task 2.3: Channel Endpoints

**Parallel group: C** (after 2.2) | Writes to: `backend/internal/channel/`

**Goal:** Channel CRUD as a separate `internal/channel/` package.

**Files:** `internal/channel/` — models.go, repository.go, service.go, handler.go, routes.go

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /guilds/:id/channels | Yes | Create channel (owner/admin) |
| GET | /guilds/:id/channels | Yes | List channels (member) |
| PATCH | /channels/:id | Yes | Update channel (owner/admin) |
| DELETE | /channels/:id | Yes | Delete channel (owner/admin) |

**Note:** Use the guild repository's `IsMember`/`GetMemberRole` functions for permission checks. Import from the guild package — do not duplicate.

**Acceptance criteria:**
- Only admins/owners can create/update/delete channels
- Members can list channels
- Cannot delete the last text channel in a guild

---

## Task 2.4: Invite System

**Parallel group: C** (after 2.2) | Writes to: `backend/internal/invite/`

**Goal:** Invite generation and redemption as `internal/invite/` package.

**Files:** `internal/invite/` — models.go, repository.go, service.go, handler.go, routes.go

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /guilds/:id/invites | Yes | Create invite (member) |
| POST | /invites/:code/join | Yes | Join guild via invite |

**Business rules:**
- Invite codes are 8-char alphanumeric random strings
- Optional: max uses and expiry
- Cannot join a guild you're already in (return 409)
- Joining adds user to `guild_members` (use guild repository's `AddMember`)

**Acceptance criteria:**
- Invite code creation and redemption works end-to-end
- Expired/exhausted invites return 410
- Duplicate join returns 409

---

## Task 2.5: Member Management

**Parallel group: C** (after 2.2) | Writes to: `backend/internal/guild/member_handler.go`

**Goal:** Additional member endpoints added to the guild package.

**Files:** Add `member_handler.go` and `member_repository.go` inside `internal/guild/`

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /guilds/:id/members | Yes | List members |
| DELETE | /guilds/:id/members/:userId | Yes | Kick member (owner only) |

**Acceptance criteria:**
- Member list returns users with roles
- Owner can kick members
- Cannot kick the guild owner
- Kicked user no longer has access

---

## Task 2.6: Guild Frontend

**Parallel group: C** (after 2.2) | Writes to: `frontend/src/`

**Goal:** UI for guild list sidebar, guild creation, channel list, and invite flow.

**Components:**
- `features/guild/GuildSidebar.tsx` — vertical guild icon list (Discord-style)
- `features/guild/CreateGuildModal.tsx` — modal form for new guild
- `features/channel/ChannelList.tsx` — channel sidebar within a guild
- `features/guild/InviteModal.tsx` — generate + copy invite link
- `stores/guildStore.ts` — guilds, selected guild, members
- `stores/channelStore.ts` — channels for selected guild, selected channel
- `components/layout/AppLayout.tsx` — three-column layout shell

**Layout:**
```
[Guild Icons | Channel List | Main Content Area]
```

**Acceptance criteria:**
- Can create a guild and see it in the sidebar
- Can browse channels within a guild
- Can generate an invite and join from another account
- Selecting a channel updates the main content area (placeholder for messages)
