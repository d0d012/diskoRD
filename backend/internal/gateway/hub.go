package gateway

import (
	"context"
	"encoding/json"
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
			if client.guilds[event.GuildID] {
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
	if err := json.Unmarshal(event.D, &d); err != nil || d.GuildID == "" {
		return
	}
	if !c.guilds[d.GuildID] {
		return // client not in that guild
	}

	var username string
	h.db.QueryRow(context.Background(),
		`SELECT username FROM users WHERE id = $1`, c.userID,
	).Scan(&username)

	h.PublishToGuild(d.GuildID, OpTypingStart, map[string]string{
		"channelId": d.ChannelID,
		"userId":    c.userID,
		"username":  username,
	})
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
		client.guilds[guildID] = true
	}
}

// notifyUser sends an event payload directly to all connections for a given user.
// Does not go through Redis — single-instance delivery only.
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

// broadcastPresence sends a PRESENCE_UPDATE event to all guild members and DM partners of the given user.
func (h *Hub) broadcastPresence(userID, status string) {
	// Collect which guilds this user belongs to
	h.mu.RLock()
	conns := h.clients[userID]
	var guilds []string
	for client := range conns {
		for guildID := range client.guilds {
			guilds = append(guilds, guildID)
		}
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
