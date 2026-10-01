package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/presence"
)

const redisPubSubChannel = "gateway:events"

// Hub maintains the set of active clients and broadcasts messages.
type Hub struct {
	// clients maps userID → set of connections (one user may have multiple tabs)
	clients map[string]map[*Client]bool
	mu      sync.RWMutex

	register   chan *Client
	unregister chan *Client

	rdb      *redis.Client
	db       *pgxpool.Pool
	presence *presence.Service
	seq      int64 // monotonically increasing sequence number
}

func NewHub(rdb *redis.Client, db *pgxpool.Pool, presenceSvc *presence.Service) *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]bool),
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
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
			return

		case client := <-h.register:
			h.mu.Lock()
			firstConn := h.clients[client.userID] == nil
			if firstConn {
				h.clients[client.userID] = make(map[*Client]bool)
			}
			h.clients[client.userID][client] = true
			h.mu.Unlock()
			if firstConn {
				if err := h.presence.SetOnline(context.Background(), client.userID); err == nil {
					h.broadcastPresence(client.userID, "online")
				}
			}
			log.Debug().Str("userID", client.userID).Msg("gateway: client connected")

		case client := <-h.unregister:
			h.mu.Lock()
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
				if err := h.presence.SetOffline(context.Background(), client.userID); err == nil {
					h.broadcastPresence(client.userID, "offline")
				}
			}
			log.Debug().Str("userID", client.userID).Msg("gateway: client disconnected")
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

	if err := h.rdb.Publish(context.Background(), redisPubSubChannel, payload).Err(); err != nil {
		log.Error().Err(err).Msg("gateway: redis publish")
	}
}

// subscribeRedis listens for events on Redis and delivers them to local clients.
func (h *Hub) subscribeRedis(ctx context.Context) {
	sub := h.rdb.Subscribe(ctx, redisPubSubChannel)
	defer sub.Close()

	ch := sub.Channel()
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

	switch event.Op {
	case OpHeartbeat:
		h.presence.Refresh(context.Background(), c.userID)
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

	var username string
	h.db.QueryRow(context.Background(),
		`SELECT username FROM users WHERE id = $1`, c.userID,
	).Scan(&username)

	payload := map[string]string{
		"channelId": d.ChannelID,
		"userId":    c.userID,
		"username":  username,
	}

	if d.GuildID != "" {
		if !c.HasGuild(d.GuildID) {
			return // client not in that guild
		}
		h.PublishToGuild(d.GuildID, OpTypingStart, payload)
		return
	}

	var userA, userB string
	if err := h.db.QueryRow(context.Background(),
		`SELECT user_a_id, user_b_id FROM dm_channels WHERE id = $1`, d.ChannelID,
	).Scan(&userA, &userB); err != nil {
		return
	}
	if c.userID != userA && c.userID != userB {
		return
	}
	if c.userID == userA {
		h.notifyUser(userB, OpTypingStart, payload)
	} else {
		h.notifyUser(userA, OpTypingStart, payload)
	}
}

// loadUserGuilds queries the DB for all guild IDs the user belongs to.
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
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients[userID] {
		client.RemoveGuild(guildID)
	}
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
	if len(guildIDs) == 0 {
		return
	}

	// 1. Get all member user IDs across the client's guilds
	rows, err := h.db.Query(ctx,
		`SELECT DISTINCT user_id FROM guild_members WHERE guild_id = ANY($1)`,
		guildIDs)
	if err != nil {
		return
	}
	var memberIDs []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			memberIDs = append(memberIDs, id)
		}
	}
	rows.Close()

	// 2. Batch-fetch presence statuses
	presences := h.presence.GetStatuses(ctx, memberIDs)

	// 3. Get all voice channels in the client's guilds
	rows2, err := h.db.Query(ctx,
		`SELECT id FROM channels WHERE guild_id = ANY($1) AND type = 'voice'`,
		guildIDs)
	if err != nil {
		return
	}
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

	type VoiceStateEntry struct {
		UserID    string `json:"userId"`
		Username  string `json:"username"`
		ChannelID string `json:"channelId"`
		Joined    bool   `json:"joined"`
	}
	var voiceStates []VoiceStateEntry

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

	if voiceStates == nil {
		voiceStates = []VoiceStateEntry{}
	}

	// 5. Send READY event
	seq := atomic.LoadInt64(&h.seq)
	raw, err := json.Marshal(map[string]interface{}{
		"presences":   presences,
		"voiceStates": voiceStates,
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

// broadcastPresence sends a PRESENCE_UPDATE event to all guild members and DM partners of the given user.
func (h *Hub) broadcastPresence(userID, status string) {
	// Collect which guilds this user belongs to
	h.mu.RLock()
	conns := h.clients[userID]
	var guilds []string
	for client := range conns {
		guilds = client.GuildIDs()
		break // all connections share the same guild set
	}
	h.mu.RUnlock()

	for _, guildID := range guilds {
		h.PublishToGuild(guildID, OpPresenceUpdate, map[string]string{
			"userId": userID,
			"status": status,
		})
	}

	// Also notify DM partners who may not share any guild
	presenceData := map[string]string{"userId": userID, "status": status}
	rows, err := h.db.Query(context.Background(),
		`SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
		 FROM dm_channels WHERE user_a_id = $1 OR user_b_id = $1`,
		userID,
	)
	if err != nil {
		log.Error().Err(err).Msg("gateway: broadcastPresence: query DM partners")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var partnerID string
		if err := rows.Scan(&partnerID); err == nil {
			h.notifyUser(partnerID, OpPresenceUpdate, presenceData)
		}
	}
}
