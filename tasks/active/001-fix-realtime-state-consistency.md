# Task: Fix realtime state consistency

## Goal

Make existing realtime flows update the UI without requiring a page refresh, especially friends, DMs, and messages.

## Scope

- Audit frontend gateway ownership and ensure the WebSocket connection is centralized instead of opened from multiple components.
- Ensure incoming friend requests appear immediately for the recipient.
- Ensure newly-created or first-ever DM conversations appear in the DM sidebar when a message arrives.
- Ensure active guild channels and active DMs receive new messages live.
- Ensure message edits/deletions update other connected clients without refresh.
- Ensure guild channel create/update/delete updates connected clients without refresh.
- Ensure inactive guild channels and DMs show unread state; DMs should show a red unread count/badge in the DM sidebar.
- Ensure opening a guild channel or DM marks it read.
- Keep existing notification behavior working for messages received outside the current view.
- Add or update focused tests where practical for stores/realtime handlers.

## Out of scope

- Push notifications.
- Notification preferences.
- Major redesign of the friends or DM UI.
- Gateway session resume.

## Progress

- Centralized frontend gateway ownership so only `AppPage` opens the WebSocket connection. Channel and DM message inputs now use the shared `sendGatewayTyping` helper instead of calling `useGateway()` themselves.
- Added DM `MESSAGE_CREATE` handling that refreshes the DM list when an incoming DM message references a DM channel missing from `friendStore.dms`, so first-ever DM rows can appear without refresh.
- Added `unreadCounts` to `messageStore` and wired `FriendsSidebar` to show red unread count badges for inactive DMs.
- Wired DM row clicks to clear the DM unread count via `markRead`.
- Updated unread logic so the current user's own messages do not create unread counts.
- Fixed message delete events to include the real `channelId`; DM message deletes now publish to both DM participants.
- Added gateway events for guild channel create/update/delete and frontend handlers that upsert/remove channels in `guildStore`, covering both text and voice channel sidebar updates.
- Added DM `MESSAGE_UPDATE` routing so edited DM messages publish to both DM participants, not guild-only routing.
- Added DM reaction routing and participant validation for `REACTION_ADD` / `REACTION_REMOVE`.
- Added DM typing support in the gateway by routing `TYPING_START` with an empty `guildId` to the other DM participant.
- Added realtime friend removal notifications and frontend handling for `FRIEND_REMOVE`.
- Added guild update endpoint (`PATCH /guilds/:id`) for server name/icon metadata, owner-only authorization, and `GUILD_UPDATE` gateway publishing.
- Added frontend guild update support in `guildStore`, gateway handling, and Server Settings Overview rename UI.
- Added `RemoveClientGuild` to the hub and use it when a member is kicked so removed users stop receiving guild-routed events without reconnecting.
- Added per-client `guildMu` locking and safe helper methods for gateway client guild membership reads/writes to avoid concurrent map read/write panics.
- Changed member-event frontend handling so only the affected user refetches their guild list; other clients only refresh the active member panel.
- Added guild message-cache cleanup when a guild is removed from the client.
- Added guild delete, member remove, and legacy member role update gateway publishing.
- Added invite-join realtime hooks: the hub now registers the joining user's active connection for the guild and publishes `GUILD_MEMBER_ADD`.
- Added frontend handling for `GUILD_DELETE`, `GUILD_MEMBER_ADD`, `GUILD_MEMBER_UPDATE`, `GUILD_MEMBER_REMOVE`, `MEMBER_ROLE_ADD`, and `MEMBER_ROLE_REMOVE`; member panels refetch when these events target the active guild.
- Updated duplicate `MESSAGE_CREATE` handling to merge payloads instead of ignoring them, so upload messages republished with attachments can update the existing message row.
- Added `.gitignore` entries for `DEV_CREDENTIALS.md` and `.claude/` so local credentials/tooling are not committed.
- Added per-client `guildMu` with `HasGuild/AddGuild/RemoveGuild/GuildIDs` to fix a concurrent-map race on `Client.guilds`.
- Persistent login: single shared refresh with transient-error retry (logout only on explicit 400/401/403), rotated token persisted first, 30 s refresh grace window, 1-year sliding refresh lifetime, `rememberMe`, Redis AOF, gateway reconnect with fresh token/backoff/focus revalidation, mock login removed.
- DM calls: server-side call state machine (busy/glare/ownership checks, ring timeout, active-call keepalive + TTL, `CALL_TIMEOUT`), app-wide call panel with remote audio playback, auto hang-up when the peer disappears, ringtone loop, channel-scoped end events, error notices. Tests: `backend/internal/call/call_test.go` (needs dev Redis; skipped otherwise), `frontend/src/stores/callStore.test.ts`.
- Verified touched frontend code with `cd frontend && npm run build`, `cd frontend && npm run test -- messageStore`, and `cd frontend && npm run lint` (lint has existing warnings, no errors).
- Verified backend with `cd backend && go test ./...`.

## Test coverage note

- Existing backend and frontend tests pass, and existing `messageStore` tests were run.
- No new focused gateway/guild realtime unit tests were added yet, so the original testing scope is only partially satisfied.

## Remaining suspected realtime gaps

- Multi-instance direct-user events still use local hub delivery for some user-specific events; guild-scoped events use Redis pub/sub.
- Kick handling now sends a direct `GUILD_MEMBER_REMOVE` and removes the guild from the local connection, but that direct delivery/removal is local-hub-only. If the kicked user's WebSocket is on another backend instance, a cross-instance direct-user mechanism is still needed.
- `GUILD_DELETE` itself is guild-scoped, but it relies on currently connected clients receiving the pub/sub fanout before their local routing state changes; this should be revisited if gateway routing moves fully out of process.
- Guild icon can be set but not explicitly cleared through the current PATCH semantics/UI.
- DM typing works but still performs DB lookups per typing event; caching DM participants/usernames would be a performance improvement.

## Acceptance

- With two dev accounts, sending a friend request appears for the receiver without refresh.
- With two dev accounts, sending the first-ever DM message causes the receiver to see the DM row without refresh.
- Messages sent to the currently open DM/channel appear without refresh.
- Message edits/deletions update connected clients without refresh.
- Creating, renaming, or deleting text/voice channels updates other guild members without refresh.
- Messages sent to inactive DMs/channels produce visible unread indicators.
- Opening the relevant DM/channel clears the unread indicator.
- Existing message notifications still appear when the user is elsewhere.
- Relevant frontend tests/lint are run, at minimum `cd frontend && npm run lint`; run targeted tests if added or changed.
