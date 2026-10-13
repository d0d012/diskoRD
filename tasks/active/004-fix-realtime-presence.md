# Task: Make presence reliably realtime (online / away / DND / offline)

## Goal

The member list, DM list, friends page and profile cards always show the user's real status within a few seconds — including Away and Do Not Disturb — and a connected user never shows as Offline.

## Root cause (verified on the local stack)

- Presence lives in Redis at `presence:{userId}` with a 65s TTL (`backend/internal/presence/service.go`). The only thing that extends it is the **client-side JS heartbeat** (`HEARTBEAT` every 30s → `presence.Refresh` → Redis `EXPIRE`, `backend/internal/gateway/hub.go` `handleClientMessage`).
- Browsers throttle timers in background tabs and hidden windows (Chrome/WebView2 can delay `setInterval` to ≥ 1 minute). One late heartbeat and the key expires.
- `Refresh` uses `EXPIRE`, which is a no-op on a missing key, so **once the key has expired it is never recreated** while the socket stays open. The user stays "offline" for everyone until they fully disconnect and reconnect.
- Nobody broadcasts when the key expires, so other clients keep stale state either way.
- `PUT /users/me/presence` calls `presence.SetIfOnline` (`SET ... XX`). With the key gone this returns false, so a DND/Away change is saved to the DB but **never broadcast** — that's why DND "doesn't work" in the member list.
- Observed: `manual1` (preferred `dnd`) and `manual2` both had open gateway connections in the backend log while `presence:*` keys were missing in Redis.

Meanwhile the server already sends a WebSocket **ping every 30s** (`backend/internal/gateway/client.go` `WritePump`, `pingPeriod`) and the browser answers with a protocol-level **pong** automatically — that is not throttled. Liveness should be driven from there, not from JS timers.

## Scope

### Backend

1. **Server-driven presence refresh.**
   - In `Client.ReadPump`'s pong handler (and on every received client message), notify the hub that the user is alive: e.g. `c.hub.touch(c.userID)` (non-blocking; a buffered channel or a direct call that does the Redis write in the hub goroutine — do not block the read loop on Redis).
   - Hub keeps an in-memory `preferred map[userID]string` for locally connected users, filled on first connection (DB read already exists: `preferredStatus`) and updated by `PublishPresenceChange`.
   - `touch` does `SET presence:{id} <preferred> EX <ttl>` (create-or-refresh, not `EXPIRE`). If the key **did not exist** before (use `SET ... GET` or a small Lua script / `SETNX` + `EXPIRE` so it is one round trip), broadcast `PRESENCE_UPDATE` with `presence.Visible(preferred)` — the user just came back.
   - Raise TTL to 90s (3 missed pings). Keep `HEARTBEAT` handling for compatibility but route it through the same `touch`.
2. **`PUT /users/me/presence`** — if the user has a live connection on this instance (`h.clients[userID]` non-empty), always `SET` (not `SET XX`) and broadcast. Keep `SetIfOnline` only as the fallback for users not connected to this instance (multi-instance safety).
3. **Expiry broadcast (crash case only).** With 1–2 in place, a key can only expire when the backend instance holding the socket died without running the disconnect path (normal disconnects already broadcast `offline`). Do **not** build a scanner for this. It is acceptable that, after a backend crash, other clients see the user offline only after they reconnect or the user's next status change. If you want to cover it, use Redis keyspace notifications (`notify-keyspace-events Ex`, subscribe to `__keyevent@0__:expired`, broadcast `offline` for `presence:*`) — but only if it needs no infra change beyond a `CONFIG SET` at startup; otherwise note it in "Open questions".
4. Unit tests (miniredis if it is already a dependency, otherwise add it as a test-only dependency): `touch` recreates a missing key and reports "came back"; `SetPreferred` on a connected user broadcasts even when the key had expired; `Visible` mapping unchanged.

### Frontend

5. On `visibilitychange` → visible and on `window.focus`, send one `HEARTBEAT` immediately (cheap, makes coming back to the tab feel instant). Keep the interval as is.
6. On gateway reconnect, the `READY` snapshot already replaces presences — make sure `presenceStore.setStatuses` **replaces** entries for users included in the snapshot (it currently merges, which is fine) and that users missing from the snapshot but present in the store for the same guilds are set to `offline` (stale entries from before a disconnect).
7. Member list (`components/layout/MembersPanel.tsx`): status changes must move members between Online/Offline sections without a refresh, and `idle`/`dnd` stay in the online sections (already true — keep it).
8. Self status: when `PUT /users/me/presence` fails, revert the picker (already implemented in `notificationStore`) and show a small error toast.

## Out of scope

- Auto-Away after inactivity.
- Per-device statuses (mobile/desktop icons).
- Custom status text.

## Acceptance

- Open user A in a tab, switch to another tab for 5+ minutes: user B keeps seeing A as Online (or A's chosen status) the whole time. `redis-cli TTL presence:<A>` stays positive.
- Manually `redis-cli DEL presence:<A>` while A is connected: within ~30s A is back to their status in B's member list, without A doing anything.
- A sets Do Not Disturb → B's member list shows the red DND indicator within 2s; Away → yellow; Invisible → A moves to Offline for B; back to Online → green. All without refresh, in guild member list, DM list, friends page and profile card.
- A closes all clients → B sees A Offline within a few seconds (disconnect path) or ≤ TTL after a server crash.
- `go test ./...`, `npm run lint`, `npm run test` pass.

## Open questions

(Implementer: add anything here that blocks you instead of changing scope or the schema.)

- Expiry broadcast for the crash-only case (item 3) is **not** implemented. With server-driven touches and the disconnect path, a key can only expire when the instance holding the socket died. After such a crash the user is only re-shown correctly when they reconnect (or a peer's own reconnect refreshes the snapshot); a status change issued through an instance with no local connection cannot resurrect the missing key because it uses `SetIfOnline`. This matches scope item 3, but it means the Acceptance line about peers going Offline "≤ TTL after a server crash" holds only once a reconnect happens, not at expiry. Covering expiry needs Redis keyspace notifications (`CONFIG SET notify-keyspace-events Ex` + a `__keyevent@0__:expired` subscriber) and was left out.
- `presence.Refresh` (the old `EXPIRE`-only heartbeat) was removed; all liveness now goes through `presence.Touch`, which refreshes an existing key's TTL without overwriting its value and re-creates a missing key.
- TTL is 90s. The hub keeps an in-memory `preferred` map for **locally connected** users only, and status changes are applied in the hub goroutine (`presenceCh`) so they are ordered against connect/disconnect and cannot resurrect presence after the last disconnect.
- An expired key is restored with the database value only via `presence.Restore`, a compare-and-set that no-ops if another instance wrote a newer value meanwhile. A database read failure during recovery keeps the cached value instead of defaulting to online, so an Invisible user is never exposed.
- `READY` carries `audience` (the member IDs the snapshot covers); the client offlines only entries that dropped out of the previous audience, so DM/friend-only users are never forced offline by an unloaded list.
- Tests are unit-level (miniredis): Lua touch/restore semantics, exact TTL refresh/preservation, generation-guarded status picker. Cross-instance propagation and live two-client timing were not exercised end-to-end.
