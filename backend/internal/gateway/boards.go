package gateway

import (
	"context"
	"encoding/json"
	"sort"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
)

// BoardReader is implemented by whiteboard.Service, without importing that
// package into gateway. It checks channel type + database membership and reads
// the current board sequence (zero for a board not yet materialised).
type BoardReader interface {
	BoardSubscription(ctx context.Context, userID, channelID string) (guildID string, seq int64, err error)
}

// SetBoardReader is called once during server wiring, before serving sockets.
func (h *Hub) SetBoardReader(reader BoardReader) {
	h.mu.Lock()
	h.boards = reader
	h.mu.Unlock()
}

type boardParticipant struct {
	UserID      string `json:"userId"`
	Name        string `json:"name"`
	ColourIndex int    `json:"colourIndex"`
}

type boardRoom struct {
	guildID      string
	connections  map[*Client]bool
	participants map[string]boardParticipant
}

// boardSubscription is an in-flight authorization, guarded by h.mu. Lifecycle
// events invalidate it even when no room has been installed yet.
type boardSubscription struct {
	client    *Client
	channelID string
	cancelled bool
}

func (h *Hub) handleBoardSubscribe(c *Client, raw json.RawMessage) {
	var d struct {
		ChannelID string `json:"channelId"`
	}
	if json.Unmarshal(raw, &d) != nil || d.ChannelID == "" {
		return
	}

	h.mu.Lock()
	reader := h.boards
	if reader == nil || c.boardClosed {
		h.mu.Unlock()
		return
	}
	attempt := &boardSubscription{client: c, channelID: d.ChannelID}
	if h.boardSubscriptions == nil {
		h.boardSubscriptions = make(map[*boardSubscription]bool)
	}
	h.boardSubscriptions[attempt] = true
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.boardSubscriptions, attempt)
		h.mu.Unlock()
	}()

	// All database IO runs outside the hub lock. One timeout bounds the entire
	// lookup, not three serial timeout windows blocking every gateway client.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	guildID, seq, err := reader.BoardSubscription(ctx, c.userID, d.ChannelID)
	if err != nil || !c.HasGuild(guildID) {
		log.Warn().Err(err).Str("userID", c.userID).Str("channelID", d.ChannelID).
			Msg("gateway: board subscription denied")
		return
	}
	var name string
	if err := h.db.QueryRow(ctx,
		`SELECT COALESCE(NULLIF(display_name, ''), username) FROM users WHERE id = $1`, c.userID,
	).Scan(&name); err != nil {
		log.Warn().Err(err).Str("userID", c.userID).Msg("gateway: board participant lookup")
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	// A disconnect, unsubscribe, deletion, or guild removal may have happened
	// during IO. Never resurrect that subscription using a stale DB result.
	if c.boardClosed || attempt.cancelled || !c.HasGuild(guildID) {
		return
	}
	r := h.rooms[d.ChannelID]
	if r == nil {
		r = &boardRoom{guildID: guildID, connections: make(map[*Client]bool), participants: make(map[string]boardParticipant)}
	}
	if r.guildID != guildID {
		return
	}
	p, present := r.participants[c.userID]
	if !present {
		used := [8]bool{}
		for _, member := range r.participants {
			used[member.ColourIndex] = true
		}
		colour := 0
		for colour < 8 && used[colour] {
			colour++
		}
		if colour == 8 {
			colour = len(r.participants) % 8
		}
		p = boardParticipant{UserID: c.userID, Name: name, ColourIndex: colour}
		r.participants[c.userID] = p
	}
	h.rooms[d.ChannelID] = r
	r.connections[c] = true
	c.AddRoom(d.ChannelID)

	participants := make([]boardParticipant, 0, len(r.participants))
	for _, member := range r.participants {
		participants = append(participants, member)
	}
	sort.Slice(participants, func(i, j int) bool { return participants[i].UserID < participants[j].UserID })
	h.sendBoardLocked(c, guildID, d.ChannelID, OpBoardSubscribed, struct {
		ChannelID    string             `json:"channelId"`
		Seq          int64              `json:"seq"`
		Participants []boardParticipant `json:"participants"`
	}{d.ChannelID, seq, participants})
	if !present {
		h.roomEventLocked(d.ChannelID, OpBoardJoin, struct {
			ChannelID string `json:"channelId"`
			boardParticipant
		}{d.ChannelID, p})
	}
}

func (h *Hub) handleBoardUnsubscribe(c *Client, raw json.RawMessage) {
	var d struct {
		ChannelID string `json:"channelId"`
	}
	if json.Unmarshal(raw, &d) != nil || d.ChannelID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.leaveBoardLocked(c, d.ChannelID)
}

// All room lifecycle helpers require h.mu. Remove queued data as well as the
// routing entry: a former member must not drain old board traffic afterwards.
func (h *Hub) leaveBoardLocked(c *Client, roomID string) {
	for attempt := range h.boardSubscriptions {
		if attempt.client == c && attempt.channelID == roomID {
			attempt.cancelled = true
		}
	}
	c.RemoveRoom(roomID)
	r := h.rooms[roomID]
	if r == nil || !r.connections[c] {
		return
	}
	delete(r.connections, c)
	for other := range r.connections {
		if other.userID == c.userID {
			return
		}
	}
	delete(r.participants, c.userID)
	for other := range r.connections {
		other.clearBoardPresence(roomID, c.userID)
	}
	if len(r.connections) == 0 {
		delete(h.rooms, roomID)
		return
	}
	h.roomEventLocked(roomID, OpBoardLeave, map[string]string{"channelId": roomID, "userId": c.userID})
}

func (h *Hub) disconnectBoardsLocked(c *Client) {
	c.boardClosed = true
	for _, roomID := range c.RoomIDs() {
		h.leaveBoardLocked(c, roomID)
	}
}

func (h *Hub) removeClientGuildLocked(userID, guildID string) {
	for attempt := range h.boardSubscriptions {
		if attempt.client.userID == userID && attempt.client.HasGuild(guildID) {
			attempt.cancelled = true
		}
	}
	for c := range h.clients[userID] {
		c.RemoveGuild(guildID)
		for _, roomID := range c.RoomIDs() {
			if r := h.rooms[roomID]; r != nil && r.guildID == guildID {
				h.leaveBoardLocked(c, roomID)
			}
		}
	}
}

func (h *Hub) cleanupBoardEvent(event routableEvent) {
	if event.Op != OpChannelDelete && event.Op != OpGuildMemberRemove && event.Op != OpGuildDelete {
		return
	}
	var d struct {
		ID     string `json:"id"`
		UserID string `json:"userId"`
	}
	if json.Unmarshal(event.D, &d) != nil {
		return
	}
	if event.Op == OpChannelDelete {
		h.typingChannels.invalidate(d.ID)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if event.Op == OpGuildMemberRemove {
		h.removeClientGuildLocked(d.UserID, event.GuildID)
		return
	}
	for attempt := range h.boardSubscriptions {
		if (event.Op == OpChannelDelete && attempt.channelID == d.ID) ||
			(event.Op == OpGuildDelete && attempt.client.HasGuild(event.GuildID)) {
			attempt.cancelled = true
		}
	}
	for roomID, r := range h.rooms {
		if r.guildID == event.GuildID && (event.Op == OpGuildDelete || roomID == d.ID) {
			for c := range r.connections {
				c.RemoveRoom(roomID)
			}
			delete(h.rooms, roomID)
		}
	}
}

func (h *Hub) sendBoardLocked(c *Client, guildID, roomID, op string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	payload, err := json.Marshal(Event{Op: op, D: raw, S: atomic.AddInt64(&h.seq, 1)})
	if err == nil && c.HasGuild(guildID) {
		c.enqueueBoard(roomID, guildID, payload)
	}
}

func (h *Hub) roomEventLocked(roomID, op string, data any) {
	r := h.rooms[roomID]
	if r == nil {
		return
	}
	for c := range r.connections {
		h.sendBoardLocked(c, r.guildID, roomID, op, data)
	}
}

// PublishToRoom uses the same Redis topic as guild events. Synchronous publish
// is essential: whiteboard holds its per-board mutex until this returns.
func (h *Hub) PublishToRoom(ctx context.Context, guildID, roomID, op string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		log.Error().Err(err).Msg("gateway: marshal room data")
		return
	}
	payload, err := json.Marshal(routableEvent{
		Op: op, D: raw, S: atomic.AddInt64(&h.seq, 1), GuildID: guildID, RoomID: roomID,
	})
	if err != nil {
		return
	}
	if err := h.publisher.Publish(ctx, redisPubSubChannel, payload).Err(); err != nil {
		log.Error().Err(err).Str("roomID", roomID).Msg("gateway: publish room event")
	}
}

func (h *Hub) broadcastToRoom(event routableEvent) {
	payload, err := json.Marshal(Event{Op: event.Op, D: event.D, S: event.S})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	r := h.rooms[event.RoomID]
	if r == nil || r.guildID != event.GuildID {
		return
	}
	// The single Redis reader calls this synchronously, preserving board order.
	for c := range r.connections {
		if c.HasGuild(event.GuildID) {
			c.enqueueBoard(event.RoomID, event.GuildID, payload)
		}
	}
}
