package gateway

import (
	"bytes"
	"encoding/json"
	"math"
	"sync/atomic"
	"time"
)

const (
	maxBoardPresenceBytes = 2 * 1024 // full d, including server-stamped userId
	maxBoardLaserPoints   = 32
	maxBoardCoordinate    = 10_000_000
	boardPresenceRate     = 20
	boardPresenceBurst    = 20
	boardPresenceTTL      = 10 * time.Second
)

type presenceBucket struct {
	last   time.Time
	tokens float64
}

func (b *presenceBucket) allow(now time.Time) bool {
	if b.last.IsZero() {
		b.tokens = boardPresenceBurst
	} else {
		b.tokens = math.Min(boardPresenceBurst, b.tokens+math.Max(0, now.Sub(b.last).Seconds())*boardPresenceRate)
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type presenceKey struct{ roomID, userID string }
type pendingPresence struct {
	guildID string
	fields  map[string]json.RawMessage
	updated time.Time
}

func (h *Hub) handleBoardPresence(c *Client, raw json.RawMessage) {
	h.handleBoardPresenceAt(c, raw, time.Now())
}

func (h *Hub) handleBoardPresenceAt(c *Client, raw json.RawMessage, now time.Time) {
	if len(raw) > maxBoardPresenceBytes {
		return
	}
	c.roomMu.Lock()
	allowed := c.presenceBucket.allow(now)
	c.roomMu.Unlock()
	if !allowed {
		return
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return
	}
	var roomID string
	if json.Unmarshal(fields["channelId"], &roomID) != nil || roomID == "" {
		return
	}
	// Only the contract fields survive. In particular an inbound userId cannot
	// impersonate another connection, even if supplied by a malicious client.
	clean := map[string]json.RawMessage{"channelId": mustMarshal(roomID), "userId": mustMarshal(c.userID)}
	for _, key := range []string{"cursor", "selectedIds", "editingId", "drag", "viewport", "laser"} {
		if value, ok := fields[key]; ok {
			if !validPresenceField(key, value) {
				return
			}
			clean[key] = value
		}
	}
	encoded, err := json.Marshal(clean)
	if err != nil || len(encoded) > maxBoardPresenceBytes {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	r := h.rooms[roomID]
	if c.boardClosed || r == nil || !r.connections[c] || !c.HasRoom(roomID) || !c.HasGuild(r.guildID) {
		return
	}
	for other := range r.connections {
		if other != c && other.HasGuild(r.guildID) {
			other.coalesceBoardPresence(presenceKey{roomID, c.userID}, r.guildID, clean, now)
		}
	}
}

func validPresenceField(key string, value json.RawMessage) bool {
	isNull := bytes.Equal(bytes.TrimSpace(value), []byte("null"))
	if isNull {
		return key != "selectedIds"
	}
	switch key {
	case "editingId":
		var id string
		return json.Unmarshal(value, &id) == nil && id != ""
	case "selectedIds":
		return validPresenceIDs(value)
	case "laser":
		var pts []map[string]json.RawMessage
		if json.Unmarshal(value, &pts) != nil || len(pts) == 0 || len(pts) > maxBoardLaserPoints {
			return false
		}
		for _, pt := range pts {
			if len(pt) != 2 {
				return false
			}
			for _, name := range []string{"x", "y"} {
				var n float64
				v := pt[name]
				if len(v) == 0 || bytes.Equal(bytes.TrimSpace(v), []byte("null")) || json.Unmarshal(v, &n) != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > maxBoardCoordinate {
					return false
				}
			}
		}
		return true
	case "cursor", "viewport", "drag":
		var obj map[string]json.RawMessage
		if json.Unmarshal(value, &obj) != nil || obj == nil {
			return false
		}
		keys := []string{"x", "y"}
		if key == "viewport" {
			keys = append(keys, "w", "h")
		}
		if key == "drag" {
			if !validPresenceIDs(obj["ids"]) {
				return false
			}
			keys = []string{"dx", "dy"}
		}
		for _, name := range keys {
			var n float64
			v := obj[name]
			if len(v) == 0 || bytes.Equal(bytes.TrimSpace(v), []byte("null")) || json.Unmarshal(v, &n) != nil || math.IsNaN(n) || math.IsInf(n, 0) {
				return false
			}
			if (name == "w" || name == "h") && n < 0 {
				return false
			}
		}
		return true
	}
	return false
}

func validPresenceIDs(raw json.RawMessage) bool {
	var ids []string
	if json.Unmarshal(raw, &ids) != nil || ids == nil {
		return false
	}
	for _, id := range ids {
		if id == "" {
			return false
		}
	}
	return true
}

// Called with roomMu held. Reliable board backlog also takes precedence over
// presence; the legacy send buffer's strictly-over-half threshold is preserved.
func (c *Client) presenceBackpressureLocked() bool {
	return len(c.send) > cap(c.send)/2 || len(c.boardQueue) > 0 || c.boardOverflow
}

func (c *Client) coalesceBoardPresence(key presenceKey, guildID string, fields map[string]json.RawMessage, now time.Time) {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	if !c.rooms[key.roomID] {
		return
	}
	if c.presenceBackpressureLocked() {
		delete(c.boardPresence, key)
		return
	}
	pending := c.boardPresence[key]
	if pending == nil || now.Sub(pending.updated) >= boardPresenceTTL {
		pending = &pendingPresence{guildID: guildID, fields: make(map[string]json.RawMessage)}
		c.boardPresence[key] = pending
	}
	// Merge fields, not payloads: omission is unchanged and explicit null clears.
	for name, value := range fields {
		pending.fields[name] = value
	}
	if raw, _ := json.Marshal(pending.fields); len(raw) > maxBoardPresenceBytes {
		// Two individually legal updates can exceed the cap when merged. Keep
		// the newest legal update rather than emit an oversized presence frame.
		pending.fields = make(map[string]json.RawMessage, len(fields))
		for name, value := range fields {
			pending.fields[name] = value
		}
	}
	pending.updated = now
}

func (c *Client) clearBoardPresence(roomID, userID string) {
	c.roomMu.Lock()
	delete(c.boardPresence, presenceKey{roomID, userID})
	c.roomMu.Unlock()
}

// The socket writer flushes every 50ms, taking just one current payload at a
// time. No presence frames ever enter send or the reliable FIFO, so a blocked
// socket does not freeze a batch of other users' obsolete cursors.
func (c *Client) nextBoardPresence(now time.Time) []byte {
	c.roomMu.Lock()
	defer c.roomMu.Unlock()
	blocked := c.presenceBackpressureLocked()
	for key, pending := range c.boardPresence {
		delete(c.boardPresence, key)
		if blocked || !c.rooms[key.roomID] || !c.HasGuild(pending.guildID) || now.Sub(pending.updated) >= boardPresenceTTL {
			continue
		}
		raw, _ := json.Marshal(pending.fields)
		payload, err := json.Marshal(Event{Op: OpBoardPresence, D: raw, S: atomic.AddInt64(&c.hub.seq, 1)})
		if err == nil {
			return payload
		}
	}
	return nil
}
