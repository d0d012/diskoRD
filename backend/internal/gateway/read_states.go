package gateway

import (
	"context"
	"encoding/json"
	"sync/atomic"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

type readState struct {
	ChannelID    string `json:"channelId"`
	GuildID      string `json:"guildId,omitempty"`
	Unread       bool   `json:"unread"`
	MentionCount int    `json:"mentionCount"`
}

func (h *Hub) loadReadStates(ctx context.Context, userID string) ([]readState, error) {
	states := []readState{}
	rows, err := h.db.Query(ctx, `WITH accessible AS (
 SELECT c.id, c.guild_id::text AS guild_id, COALESCE(r.last_read_at, gm.joined_at) AS last_read_at, COALESCE(r.mention_count, 0) AS mentions
 FROM channels c JOIN guild_members gm ON gm.guild_id = c.guild_id AND gm.user_id = $1
 LEFT JOIN channel_read_states r ON r.channel_id = c.id AND r.user_id = $1 WHERE c.type = 'text'
 UNION ALL
 SELECT d.id, '', COALESCE(r.last_read_at, d.created_at), COALESCE(r.mention_count,
 (SELECT count(*)::integer FROM messages m WHERE m.channel_id = d.id AND m.created_at > d.created_at
 AND m.author_id IS DISTINCT FROM $1::uuid AND m.deleted_at IS NULL))
 FROM dm_channels d LEFT JOIN dm_read_states r ON r.channel_id = d.id AND r.user_id = $1
 WHERE d.user_a_id = $1 OR d.user_b_id = $1
 ) SELECT a.id, a.guild_id, EXISTS (SELECT 1 FROM messages m WHERE m.channel_id = a.id
 AND m.created_at > a.last_read_at AND m.author_id IS DISTINCT FROM $1::uuid AND m.deleted_at IS NULL), a.mentions FROM accessible a`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var state readState
		if err := rows.Scan(&state.ChannelID, &state.GuildID, &state.Unread, &state.MentionCount); err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

func (h *Hub) readyReadStates(ctx context.Context, client *Client) []readState {
	client.readConnectionID.Store(uuid.NewString())
	states, err := h.loadReadStates(ctx, client.userID)
	if err != nil {
		log.Error().Err(err).Msg("gateway: load read states")
	}
	return states
}

func (h *Hub) NotifyReadState(userID, exclude string, data interface{}) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	payload, err := json.Marshal(Event{Op: "READ_STATE_UPDATE", D: raw, S: atomic.AddInt64(&h.seq, 1)})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		if exclude != "" && c.readConnectionID.Load() == exclude {
			continue
		}
		select {
		case c.send <- payload:
		default:
		}
	}
}
