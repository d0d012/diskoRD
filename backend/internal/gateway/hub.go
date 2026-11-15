package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/presence"
)

const redisPubSubChannel = "gateway:events"

// Small database boundary; pgxpool.Pool implements it.
type gatewayDB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type eventPublisher interface {
	Publish(context.Context, string, interface{}) *redis.IntCmd
}

// Hub maintains the set of active clients and broadcasts messages.
type Hub struct {
	// clients maps userID → set of connections (one user may have multiple tabs)
	clients map[string]map[*Client]bool
	mu      sync.RWMutex
	// rooms and connection lifecycle are guarded by mu. Lock order is hub → client.
	rooms  map[string]*boardRoom
	boards BoardReader
	// Only in-flight lookups are tracked; deletion invalidation needs no
	// permanent channel tombstones and never holds mu during database IO.
	boardSubscriptions map[*boardSubscription]bool
	publisher          eventPublisher

	register   chan *Client
	unregister chan *Client
	// touch is a non-blocking liveness signal from client read loops. The Redis
	// write happens in the hub goroutine so a read loop never blocks on Redis.
	touchCh chan *Client
	// presenceCh carries status changes so they are ordered against connect /
	// disconnect lifecycle events in the hub goroutine.
	presenceCh chan presenceUpdate
	done       chan struct{}

	// preferred holds each locally connected user's chosen status, so a touch can
	// recreate an expired key with the right value without hitting the database.
	prefMu    sync.RWMutex
	preferred map[string]string

	rdb            *redis.Client
	db             gatewayDB
	presence       *presence.Service
	seq            int64 // monotonically increasing sequence number
	typingChannels typingCache
}

type presenceUpdate struct {
	userID string
	status string
}

func NewHub(rdb *redis.Client, db gatewayDB, presenceSvc *presence.Service) *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]bool),
		rooms:      make(map[string]*boardRoom),
		publisher:  rdb,
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
		touchCh:    make(chan *Client, 1024),
		presenceCh: make(chan presenceUpdate, 256),
		done:       make(chan struct{}),
		preferred:  make(map[string]string),
		rdb:        rdb,
		db:         db,
		presence:   presenceSvc,
	}
}

// Run starts the hub's event loop and Redis subscriber. Blocks until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
	go h.subscribeRedis(ctx)

	for {
		select {
		case <-ctx.Done():
			close(h.done)
			return

		case client := <-h.register:
			h.mu.Lock()
			firstConn := h.clients[client.userID] == nil
			if firstConn {
				h.clients[client.userID] = make(map[*Client]bool)
			}
			h.clients[client.userID][client] = true
			h.mu.Unlock()
			close(client.registered)
			if firstConn {
				preferred, ok := h.lookupPreferredStatus(context.Background(), client.userID)
				if !ok {
					preferred = "online"
				}
				h.setPreferred(client.userID, preferred)
				if err := h.presence.Set(context.Background(), client.userID, preferred); err == nil {
					h.broadcastPresence(client.userID, presence.Visible(preferred))
				}
			}
			log.Debug().Str("userID", client.userID).Msg("gateway: client connected")

		case client := <-h.unregister:
			h.mu.Lock()
			h.disconnectBoardsLocked(client)
			lastConn := false
			if conns, ok := h.clients[client.userID]; ok {
				if _, exists := conns[client]; exists {
					delete(conns, client)
					close(client.send)
					if len(conns) == 0 {
						delete(h.clients, client.userID)
						lastConn = true
					}
				}
			}
			h.mu.Unlock()
			if lastConn {
				h.clearPreferred(client.userID)
				if err := h.presence.SetOffline(context.Background(), client.userID); err == nil {
					h.broadcastPresence(client.userID, "offline")
				}
			}
			log.Debug().Str("userID", client.userID).Msg("gateway: client disconnected")

		case client := <-h.touchCh:
			h.handleTouch(client)

		case upd := <-h.presenceCh:
			h.applyPresenceChange(upd.userID, upd.status)
		}
	}
}

// PublishToGuild serialises an event and pushes it to Redis for fan-out.
func (h *Hub) PublishToGuild(guildID, op string, data interface{}) {
	seq := atomic.AddInt64(&h.seq, 1)

	raw, err := json.Marshal(data)
	if err != nil {
		log.Error().Err(err).Msg("gateway: marshal event data")
		return
	}

	routable := routableEvent{Op: op, D: raw, S: seq, GuildID: guildID}
	payload, err := json.Marshal(routable)
	if err != nil {
		log.Error().Err(err).Msg("gateway: marshal routable event")
		return
	}

	// Clear local subscriptions even if Redis is unavailable.
	h.cleanupBoardEvent(routable)
	if err := h.publisher.Publish(context.Background(), redisPubSubChannel, payload).Err(); err != nil {
		log.Error().Err(err).Msg("gateway: redis publish")
	}
}

// subscribeRedis listens for events on Redis and delivers them to local clients.
func (h *Hub) subscribeRedis(ctx context.Context) {
	sub := h.rdb.Subscribe(ctx, redisPubSubChannel)
	defer sub.Close()

	ch := sub.Channel(redis.WithChannelSize(4096))
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var event routableEvent
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Error().Err(err).Msg("gateway: unmarshal redis event")
				continue
			}
			h.broadcastToGuild(event)
		}
	}
}

// broadcastToGuild sends an event to all connected clients that are members of guildID.
func (h *Hub) broadcastToGuild(event routableEvent) {
	h.cleanupBoardEvent(event)
	if event.RoomID != "" {
		h.broadcastToRoom(event)
		return
	}
	// Re-serialise as a plain Event (without routing metadata) for clients
	clientEvent := Event{Op: event.Op, D: event.D, S: event.S}
	payload, err := json.Marshal(clientEvent)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, conns := range h.clients {
		for client := range conns {
			if client.HasGuild(event.GuildID) {
				select {
				case client.send <- payload:
				default:
					// client buffer full — skip rather than block
				}
			}
		}
	}
}

// handleClientMessage processes an incoming WebSocket message from a client.
func (h *Hub) handleClientMessage(c *Client, msg []byte) {
	var event Event
	if err := json.Unmarshal(msg, &event); err != nil {
		return
	}

	// Cursor-rate traffic must not cause a Redis round trip per frame. Pongs
	// and heartbeats still maintain account presence while drawing.
	if event.Op != OpBoardPresence {
		h.touch(c)
	}

	switch event.Op {
	case OpBoardSubscribe:
		h.handleBoardSubscribe(c, event.D)
	case OpBoardUnsubscribe:
		h.handleBoardUnsubscribe(c, event.D)
	case OpBoardPresence:
		h.handleBoardPresence(c, event.D)
	case OpHeartbeat:
		// The presence refresh already happened via touch above; just ack.
		seq := atomic.LoadInt64(&h.seq)
		ack, _ := json.Marshal(Event{Op: OpHeartbeatAck, S: seq})
		select {
		case c.send <- ack:
		default:
		}

	case OpTypingStart:
		h.handleTyping(c, event)
	}
}

// handleTyping broadcasts a TYPING_START event to other guild members.
func (h *Hub) handleTyping(c *Client, event Event) {
	var d struct {
		ChannelID string `json:"channelId"`
		GuildID   string `json:"guildId"`
	}
	if err := json.Unmarshal(event.D, &d); err != nil || d.ChannelID == "" {
		return
	}

	if d.GuildID != "" {
		if !c.HasGuild(d.GuildID) {
			return
		}
		channel, ok := h.typingChannel(d.ChannelID, false)
		if !ok || channel.guildID != d.GuildID || channel.kind != "text" {
			return
		}
	}

	payload := map[string]string{
		"channelId": d.ChannelID,
		"userId":    c.userID,
		"username":  c.Username(),
	}

	if d.GuildID != "" {
		if !c.HasGuild(d.GuildID) {
			return // client not in that guild
		}
		h.PublishToGuild(d.GuildID, OpTypingStart, payload)
		return
	}

	channel, ok := h.typingChannel(d.ChannelID, true)
	if !ok {
		return
	}
	userA, userB := channel.userA, channel.userB
	if c.userID != userA && c.userID != userB {
		return
	}
	if c.userID == userA {
		h.notifyUser(userB, OpTypingStart, payload)
	} else {
		h.notifyUser(userA, OpTypingStart, payload)
	}
}

// A 10s coalescing window leaves ample margin within the 90s presence TTL;
// protocol pongs and application heartbeats arrive every 30s.
const touchInterval = 10 * time.Second

// touch queues a non-blocking liveness signal. Drops when the buffer is full:
// the next ping is only 30s away.
func (h *Hub) touch(c *Client) {
	if recentTouch(c, time.Now()) {
		return
	}
	select {
	case h.touchCh <- c:
	default:
	}
}

func recentTouch(c *Client, now time.Time) bool {
	last := c.lastTouch.Load()
	return last != 0 && now.Sub(time.Unix(0, last)) < touchInterval
}

// handleTouch recreates or refreshes the user's presence key. When the key was
// missing, the user is broadcast as back online. Runs in the hub goroutine.
func (h *Hub) handleTouch(c *Client) {
	if recentTouch(c, time.Now()) {
		return
	}
	userID := c.userID
	h.mu.RLock()
	connected := h.clients[userID][c]
	h.mu.RUnlock()
	if !connected {
		return // a queued touch from a connection that has since closed
	}

	preferred := h.getPreferred(userID)
	recreated, err := h.presence.Touch(context.Background(), userID, preferred)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: touch presence")
		return
	}
	c.lastTouch.Store(time.Now().UnixNano())
	if !recreated {
		return
	}

	// The key had expired. The in-memory value may be stale if the status was
	// changed through another instance, so reconcile with the source of truth.
	dbPreferred, ok := h.lookupPreferredStatus(context.Background(), userID)
	if !ok {
		// Database unavailable: keep the value Touch already created (the cached
		// one) rather than clobbering an Invisible user with a default.
		h.broadcastPresence(userID, presence.Visible(preferred))
		return
	}

	// Only overwrite if no other instance changed the key since we recreated it.
	restored, err := h.presence.Restore(context.Background(), userID, preferred, dbPreferred)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: restore presence")
		return
	}
	if !restored {
		// A newer value won; whoever wrote it owns the broadcast.
		return
	}

	h.setPreferred(userID, dbPreferred)
	h.broadcastPresence(userID, presence.Visible(dbPreferred))
}

func (h *Hub) setPreferred(userID, status string) {
	h.prefMu.Lock()
	h.preferred[userID] = status
	h.prefMu.Unlock()
}

func (h *Hub) getPreferred(userID string) string {
	h.prefMu.RLock()
	status := h.preferred[userID]
	h.prefMu.RUnlock()
	if status == "" {
		return "online"
	}
	return status
}

func (h *Hub) clearPreferred(userID string) {
	h.prefMu.Lock()
	delete(h.preferred, userID)
	h.prefMu.Unlock()
}

// lookupPreferredStatus reads the user's stored status. ok is false when the user
// is unknown or the query failed, so callers never silently fall back to online.
func (h *Hub) lookupPreferredStatus(ctx context.Context, userID string) (status string, ok bool) {
	if err := h.db.QueryRow(ctx, `SELECT preferred_status FROM users WHERE id = $1`, userID).Scan(&status); err != nil || status == "" {
		return "", false
	}
	return status, true
}

// PublishUserUpdate fans a public profile change out to every guild the user
// belongs to and every DM partner, then sends the self copy (which carries the
// preferred status) back to the user's own connections.
func (h *Hub) PublishUserUpdate(userID string, public any, self any) {
	// Keep typing names current on all local tabs without another database query.
	raw, err := json.Marshal(public)
	var profile struct {
		Username *string `json:"username"`
	}
	if err == nil && json.Unmarshal(raw, &profile) == nil && profile.Username != nil {
		h.mu.RLock()
		for c := range h.clients[userID] {
			c.username.Store(*profile.Username)
		}
		h.mu.RUnlock()
	}
	ctx := context.Background()
	for _, guildID := range h.guildIDsForUser(ctx, userID) {
		h.PublishToGuild(guildID, OpUserUpdate, public)
	}
	for _, partnerID := range h.dmPartnersForUser(ctx, userID) {
		h.notifyUser(partnerID, OpUserUpdate, public)
	}
	h.notifyUser(userID, OpUserUpdate, self)
}

// PublishToUserAudience sends op to everyone who sees the user's profile updates:
// their guilds, DM partners and their own connections (the USER_UPDATE audience).
func (h *Hub) PublishToUserAudience(userID, op string, data any) {
	ctx := context.Background()
	for _, guildID := range h.guildIDsForUser(ctx, userID) {
		h.PublishToGuild(guildID, op, data)
	}
	for _, partnerID := range h.dmPartnersForUser(ctx, userID) {
		h.notifyUser(partnerID, op, data)
	}
	h.notifyUser(userID, op, data)
}

// PublishPresenceChange hands the status change to the hub goroutine so it is
// ordered against connect/disconnect lifecycle events, then echoes the self copy
// to the user's own sessions.
func (h *Hub) PublishPresenceChange(userID, status string, self any) {
	select {
	case h.presenceCh <- presenceUpdate{userID: userID, status: status}:
	case <-h.done:
	}

	// Always echo the self copy so the user's other sessions update their picker.
	h.notifyUser(userID, OpUserUpdate, self)
}

// applyPresenceChange runs in the hub goroutine. A user connected on this
// instance is always written with SET (their key may have expired); for users
// connected elsewhere, SetIfOnline avoids resurrecting a presence nobody is
// maintaining. The cache is only kept for locally connected users.
func (h *Hub) applyPresenceChange(userID, status string) {
	h.mu.RLock()
	connected := len(h.clients[userID]) > 0
	h.mu.RUnlock()

	if connected {
		h.setPreferred(userID, status)
		if err := h.presence.Set(context.Background(), userID, status); err != nil {
			log.Error().Err(err).Str("userID", userID).Msg("gateway: update presence")
		}
		h.broadcastPresence(userID, presence.Visible(status))
		return
	}

	online, err := h.presence.SetIfOnline(context.Background(), userID, status)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: update presence")
	}
	if online {
		h.broadcastPresence(userID, presence.Visible(status))
	}
}

// guildIDsForUser resolves the guilds a user belongs to from the database, so
// the audience is correct even after the user's last connection is removed.
func (h *Hub) guildIDsForUser(ctx context.Context, userID string) []string {
	rows, err := h.db.Query(ctx, `SELECT guild_id FROM guild_members WHERE user_id = $1`, userID)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: query user guilds")
		return nil
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

// dmPartnersForUser resolves everyone who shares a DM channel with the user.
func (h *Hub) dmPartnersForUser(ctx context.Context, userID string) []string {
	rows, err := h.db.Query(ctx,
		`SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
		 FROM dm_channels WHERE user_a_id = $1 OR user_b_id = $1`,
		userID,
	)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: query DM partners")
		return nil
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}
func (h *Hub) loadUserGuilds(ctx context.Context, userID string) (map[string]bool, error) {
	rows, err := h.db.Query(ctx,
		`SELECT guild_id FROM guild_members WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	guilds := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			guilds[id] = true
		}
	}
	return guilds, nil
}

// AddClientGuild updates a connected user's guild set (e.g. after joining via invite).
func (h *Hub) AddClientGuild(userID, guildID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients[userID] {
		client.AddGuild(guildID)
	}
}

// RemoveClientGuild removes a guild from a connected user's in-memory routing set.
func (h *Hub) RemoveClientGuild(userID, guildID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeClientGuildLocked(userID, guildID)
}

// NotifyUser sends an event directly to all connections for a given user.
// Does not go through Redis — single-instance delivery only.
func (h *Hub) NotifyUser(userID, op string, data interface{}) {
	h.notifyUser(userID, op, data)
}

// notifyUser is the internal implementation.
func (h *Hub) notifyUser(userID, op string, data interface{}) {
	seq := atomic.AddInt64(&h.seq, 1)
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	payload, err := json.Marshal(Event{Op: op, D: raw, S: seq})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients[userID] {
		select {
		case client.send <- payload:
		default:
		}
	}
}

// PublishToDM delivers an event to both participants of a DM channel directly.
func (h *Hub) PublishToDM(user1ID, user2ID, op string, data interface{}) {
	h.notifyUser(user1ID, op, data)
	h.notifyUser(user2ID, op, data)
}

// sendReadyEvent sends the current presence and voice state snapshot to a newly connected client.
func (h *Hub) sendReadyEvent(ctx context.Context, client *Client) {
	guildIDs := client.GuildIDs()

	type VoiceStateEntry struct {
		UserID    string `json:"userId"`
		Username  string `json:"username"`
		ChannelID string `json:"channelId"`
		Joined    bool   `json:"joined"`
	}

	presences := map[string]string{}
	voiceStates := []VoiceStateEntry{}
	memberIDs := []string{}

	if len(guildIDs) > 0 {
		// 1. Get all member user IDs across the client's guilds
		rows, err := h.db.Query(ctx,
			`SELECT DISTINCT user_id FROM guild_members WHERE guild_id = ANY($1)`,
			guildIDs)
		if err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					memberIDs = append(memberIDs, id)
				}
			}
			rows.Close()

			// 2. Batch-fetch presence statuses
			presences = h.presence.GetStatuses(ctx, memberIDs)

			// 3. Get all voice channels in the client's guilds
			rows2, err := h.db.Query(ctx,
				`SELECT id FROM channels WHERE guild_id = ANY($1) AND type = 'voice'`,
				guildIDs)
			if err == nil {
				var voiceChannelIDs []string
				for rows2.Next() {
					var id string
					if rows2.Scan(&id) == nil {
						voiceChannelIDs = append(voiceChannelIDs, id)
					}
				}
				rows2.Close()

				// 4. Get active voice participants (userId → channelId) from Redis
				voiceUserChannel := make(map[string]string)
				for _, chID := range voiceChannelIDs {
					members, err := h.rdb.SMembers(ctx, fmt.Sprintf("voice_state:%s", chID)).Result()
					if err != nil {
						continue
					}
					for _, uid := range members {
						voiceUserChannel[uid] = chID
					}
				}

				if len(voiceUserChannel) > 0 {
					ids := make([]string, 0, len(voiceUserChannel))
					for uid := range voiceUserChannel {
						ids = append(ids, uid)
					}
					rows3, err := h.db.Query(ctx,
						`SELECT id, username FROM users WHERE id = ANY($1)`, ids)
					if err == nil {
						for rows3.Next() {
							var uid, uname string
							if rows3.Scan(&uid, &uname) == nil {
								voiceStates = append(voiceStates, VoiceStateEntry{
									UserID:    uid,
									Username:  uname,
									ChannelID: voiceUserChannel[uid],
									Joined:    true,
								})
							}
						}
						rows3.Close()
					}
				}
			}
		}
	}

	// 5. Send READY event. Always sent, even without guilds, so the client
	// learns its own preferred status. `audience` is the set of user IDs the
	// presence snapshot covers, letting the client drop stale guild entries
	// without guessing and without touching DM/friend-only users.
	var myStatus, username string
	err := h.db.QueryRow(ctx, `SELECT preferred_status, username FROM users WHERE id = $1`, client.userID).Scan(&myStatus, &username)
	client.username.Store(username)
	if err != nil || myStatus == "" {
		myStatus = "online"
	}
	readStates := h.readyReadStates(ctx, client)
	me := map[string]string{"preferredStatus": myStatus}
	seq := atomic.LoadInt64(&h.seq)
	raw, err := json.Marshal(map[string]interface{}{
		"readStates":   readStates,
		"connectionId": client.readConnectionID.Load(),
		"presences":    presences,
		"voiceStates":  voiceStates,
		"audience":     memberIDs,
		"me":           me,
	})
	if err != nil {
		return
	}
	payload, err := json.Marshal(Event{Op: "READY", D: raw, S: seq})
	if err != nil {
		return
	}
	select {
	case client.send <- payload:
	default:
	}
}

// broadcastPresence sends a PRESENCE_UPDATE event to all guild members and DM
// partners of the given user. The audience is resolved from the database so it
// still works when the user's own last connection has already been removed.
func (h *Hub) broadcastPresence(userID, status string) {
	ctx := context.Background()
	presenceData := map[string]string{"userId": userID, "status": status}

	for _, guildID := range h.guildIDsForUser(ctx, userID) {
		h.PublishToGuild(guildID, OpPresenceUpdate, presenceData)
	}
	for _, partnerID := range h.dmPartnersForUser(ctx, userID) {
		h.notifyUser(partnerID, OpPresenceUpdate, presenceData)
	}
}
