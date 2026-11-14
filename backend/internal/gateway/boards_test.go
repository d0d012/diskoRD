package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type boardReaderStub struct {
	read func(context.Context, string, string) (string, int64, error)
}

func (r boardReaderStub) BoardSubscription(ctx context.Context, u, c string) (string, int64, error) {
	return r.read(ctx, u, c)
}

type rowStub func(...any) error

func (r rowStub) Scan(dest ...any) error { return r(dest...) }

type dbStub struct{ row func(string, ...any) pgx.Row }

func (d dbStub) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	return d.row(sql, args...)
}
func (d dbStub) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}

type publishStub struct {
	mu     sync.Mutex
	events []routableEvent
	topics []string
}

func (p *publishStub) Publish(ctx context.Context, topic string, value interface{}) *redis.IntCmd {
	p.mu.Lock()
	defer p.mu.Unlock()
	var event routableEvent
	_ = json.Unmarshal(value.([]byte), &event)
	p.events = append(p.events, event)
	p.topics = append(p.topics, topic)
	return redis.NewIntResult(1, nil)
}

func boardTestHub() *Hub {
	h := NewHub(nil, dbStub{row: func(_ string, args ...any) pgx.Row {
		return rowStub(func(dest ...any) error { *dest[0].(*string) = "Name " + args[0].(string); return nil })
	}}, nil)
	h.publisher = &publishStub{}
	h.SetBoardReader(boardReaderStub{read: func(_ context.Context, _, room string) (string, int64, error) {
		if room != "A" && room != "B" {
			return "", 0, errors.New("not a board")
		}
		return "guild", 17, nil
	}})
	return h
}

func boardTestClient(h *Hub, user string, inGuild bool) *Client {
	c := newClient(h, nil, user, map[string]bool{"guild": inGuild})
	if h.clients[user] == nil {
		h.clients[user] = make(map[*Client]bool)
	}
	h.clients[user][c] = true
	return c
}

func subscribe(h *Hub, c *Client, room string) {
	h.handleClientMessage(c, mustMarshal(Event{Op: OpBoardSubscribe, D: mustMarshal(map[string]string{"channelId": room})}))
}
func boardEvents(t *testing.T, c *Client) []Event {
	t.Helper()
	var events []Event
	for {
		raw, overflow := c.nextBoard()
		require.False(t, overflow)
		if raw == nil {
			break
		}
		var e Event
		require.NoError(t, json.Unmarshal(raw, &e))
		events = append(events, e)
	}
	return events
}
func (c *Client) takeBoardPresence(now time.Time) [][]byte {
	var out [][]byte
	for {
		payload := c.nextBoardPresence(now)
		if payload == nil {
			return out
		}
		out = append(out, payload)
	}
}

func clearEvents(t *testing.T, h *Hub) {
	for _, clients := range h.clients {
		for c := range clients {
			boardEvents(t, c)
		}
	}
}
func dataMap(t *testing.T, event Event) map[string]any {
	t.Helper()
	var d map[string]any
	require.NoError(t, json.Unmarshal(event.D, &d))
	return d
}
func commitEvent(room string, seq int) routableEvent {
	return routableEvent{Op: OpBoardCommit, GuildID: "guild", RoomID: room,
		D: mustMarshal(map[string]any{"channelId": room, "seq": seq, "userId": "author", "opId": "op", "changes": []any{}})}
}

func TestBoardSubscribeAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name, room string
		guild      bool
		denied     bool
	}{
		{"board member", "A", true, false},
		{"not in routing guild", "A", false, true},
		{"text or missing channel", "text", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := boardTestHub()
			c := boardTestClient(h, "u", tc.guild)
			subscribe(h, c, tc.room)
			events := boardEvents(t, c)
			if tc.denied {
				assert.Empty(t, events)
				assert.Empty(t, h.rooms)
				assert.Empty(t, c.RoomIDs())
				return
			}
			require.Len(t, events, 2)
			assert.Equal(t, OpBoardSubscribed, events[0].Op)
			assert.Equal(t, map[string]any{"channelId": "A", "seq": float64(17), "participants": []any{
				map[string]any{"userId": "u", "name": "Name u", "colourIndex": float64(0)},
			}}, dataMap(t, events[0]))
			assert.Equal(t, OpBoardJoin, events[1].Op)
			assert.Equal(t, map[string]any{"channelId": "A", "userId": "u", "name": "Name u", "colourIndex": float64(0)}, dataMap(t, events[1]))
		})
	}
	t.Run("database revocation despite stale guild cache", func(t *testing.T) {
		h := boardTestHub()
		h.SetBoardReader(boardReaderStub{read: func(context.Context, string, string) (string, int64, error) {
			return "", 0, errors.New("no longer a member")
		}})
		c := boardTestClient(h, "u", true)
		subscribe(h, c, "A")
		assert.Empty(t, boardEvents(t, c))
		assert.Empty(t, h.rooms)
	})
}

func TestBoardParticipantsMultipleConnectionsAndColours(t *testing.T) {
	h := boardTestHub()
	a := boardTestClient(h, "alice", true)
	b := boardTestClient(h, "bob", true)
	a2 := boardTestClient(h, "alice", true)
	subscribe(h, a, "A")
	clearEvents(t, h)
	subscribe(h, b, "A")
	join := boardEvents(t, a)
	require.Len(t, join, 1)
	assert.EqualValues(t, 1, dataMap(t, join[0])["colourIndex"])
	clearEvents(t, h)
	subscribe(h, a2, "A")
	assert.Empty(t, boardEvents(t, a))
	assert.Empty(t, boardEvents(t, b))
	ack := boardEvents(t, a2)
	require.Len(t, ack, 1)
	assert.Len(t, dataMap(t, ack[0])["participants"], 2)
	assert.Equal(t, 0, h.rooms["A"].participants["alice"].ColourIndex)
	// Duplicate subscribe acknowledges again, never creates a second JOIN.
	subscribe(h, a2, "A")
	require.Len(t, boardEvents(t, a2), 1)
	assert.Empty(t, boardEvents(t, b))
	h.handleBoardUnsubscribe(a, mustMarshal(map[string]string{"channelId": "A"}))
	assert.Empty(t, boardEvents(t, b))
	h.handleBoardUnsubscribe(a2, mustMarshal(map[string]string{"channelId": "A"}))
	leave := boardEvents(t, b)
	require.Len(t, leave, 1)
	assert.Equal(t, OpBoardLeave, leave[0].Op)
	assert.Equal(t, map[string]any{"channelId": "A", "userId": "alice"}, dataMap(t, leave[0]))
	charlie := boardTestClient(h, "charlie", true)
	subscribe(h, charlie, "A")
	assert.Equal(t, 0, h.rooms["A"].participants["charlie"].ColourIndex, "reuse the lowest free colour")
	for i := 2; i < 10; i++ {
		id := fmt.Sprintf("extra%d", i)
		c := boardTestClient(h, id, true)
		subscribe(h, c, "A")
		assert.Equal(t, i%8, h.rooms["A"].participants[id].ColourIndex)
	}
	// Colours are independent between rooms.
	subscribe(h, b, "B")
	assert.Equal(t, 0, h.rooms["B"].participants["bob"].ColourIndex)
}

func TestBoardCommitIsolationAndOrdering(t *testing.T) {
	h := boardTestHub()
	a := boardTestClient(h, "a", true)
	b := boardTestClient(h, "b", true)
	outsider := boardTestClient(h, "outside", true)
	unsubscribed := boardTestClient(h, "unsubscribed", true)
	subscribe(h, a, "A")
	subscribe(h, b, "B")
	subscribe(h, outsider, "A")
	clearEvents(t, h)
	outsider.RemoveGuild("guild") // fanout must check guild membership independently
	for seq := 1; seq <= 300; seq++ {
		h.broadcastToGuild(commitEvent("A", seq))
	}
	got := boardEvents(t, a)
	require.Len(t, got, 300, "reliable queue must not use the legacy 256-frame drop path")
	for i, e := range got {
		assert.Equal(t, OpBoardCommit, e.Op)
		assert.EqualValues(t, i+1, dataMap(t, e)["seq"])
		var wire map[string]any
		require.NoError(t, json.Unmarshal(mustMarshal(e), &wire))
		assert.NotContains(t, wire, "roomId")
		assert.NotContains(t, wire, "guildId")
	}
	assert.Empty(t, boardEvents(t, b))
	assert.Empty(t, boardEvents(t, outsider))
	assert.Empty(t, boardEvents(t, unsubscribed))
}

func TestBoardPublishUsesSingleRedisTopic(t *testing.T) {
	h := boardTestHub()
	p := h.publisher.(*publishStub)
	for i := 1; i <= 3; i++ {
		h.PublishToRoom(context.Background(), "guild", "A", OpBoardCommit, map[string]int{"seq": i})
	}
	h.PublishToGuild("guild", OpTypingStart, map[string]string{"channelId": "text"})
	require.Len(t, p.events, 4)
	for _, topic := range p.topics {
		assert.Equal(t, "gateway:events", topic)
	}
	for i, e := range p.events[:3] {
		assert.Equal(t, "A", e.RoomID)
		assert.Equal(t, "guild", e.GuildID)
		assert.EqualValues(t, i+1, dataMap(t, Event{D: e.D})["seq"])
	}
	assert.Empty(t, p.events[3].RoomID)
}

func TestBoardPresenceRelayCoalescingAndLimits(t *testing.T) {
	h := boardTestHub()
	a := boardTestClient(h, "a", true)
	b := boardTestClient(h, "b", true)
	a2 := boardTestClient(h, "a", true)
	otherRoom := boardTestClient(h, "other", true)
	for _, c := range []*Client{a, b, a2} {
		subscribe(h, c, "A")
	}
	subscribe(h, otherRoom, "B")
	clearEvents(t, h)
	now := time.Now()
	send := func(raw string) { h.handleBoardPresenceAt(a, json.RawMessage(raw), now) }
	send(`{"channelId":"A","userId":"forged","cursor":{"x":1,"y":2},"selectedIds":["object"],"drag":{"ids":["object"],"dx":1,"dy":2}}`)
	send(`{"channelId":"A","cursor":{"x":4,"y":5},"drag":null}`)
	assert.Empty(t, a.takeBoardPresence(now))
	assert.Empty(t, otherRoom.takeBoardPresence(now))
	for _, c := range []*Client{b, a2} {
		frames := c.takeBoardPresence(now)
		require.Len(t, frames, 1, "latest per user, including another tab of the sender")
		var e Event
		require.NoError(t, json.Unmarshal(frames[0], &e))
		assert.Equal(t, OpBoardPresence, e.Op)
		assert.Equal(t, map[string]any{"channelId": "A", "userId": "a", "cursor": map[string]any{"x": float64(4), "y": float64(5)}, "selectedIds": []any{"object"}, "drag": nil}, dataMap(t, e))
	}
	// Count all 20 tokens at one fixed instant (the two above have spent two).
	for i := 0; i < 18; i++ {
		send(`{"channelId":"A","cursor":{"x":6,"y":7}}`)
	}
	assert.Len(t, b.takeBoardPresence(now), 1)
	send(`{"channelId":"A","cursor":{"x":8,"y":9}}`)
	assert.Empty(t, b.takeBoardPresence(now))
	now = now.Add(50 * time.Millisecond)
	send(`{"channelId":"A","cursor":null}`)
	assert.Len(t, b.takeBoardPresence(now), 1, "one token refills per 50ms")
	// The inbound limit is checked before parsing, including unknown fields.
	now = now.Add(time.Second)
	send(`{"channelId":"A","extra":"` + strings.Repeat("x", 2048) + `"}`)
	assert.Empty(t, b.takeBoardPresence(now))
	// Payload fits inbound, but must also fit after server userId stamping.
	large := `{"channelId":"A","selectedIds":["` + strings.Repeat("x", 2005) + `"]}`
	require.LessOrEqual(t, len(large), maxBoardPresenceBytes)
	send(large)
	assert.Empty(t, b.takeBoardPresence(now))
	for _, bad := range []string{
		`{"channelId":"A","cursor":{"x":null,"y":1}}`,
		`{"channelId":"A","cursor":{"x":1e999,"y":1}}`,
		`{"channelId":"A","selectedIds":null}`,
		`{"channelId":"A","viewport":{"x":0,"y":0,"w":-1,"h":1}}`,
		`{"channelId":"A","laser":[]}`,
		`{"channelId":"A","laser":[{"x":null,"y":1}]}`,
	} {
		send(bad)
	}
	assert.Empty(t, b.takeBoardPresence(now))
	now = now.Add(time.Second)
	send(`{"channelId":"A","laser":[{"x":10,"y":20},{"x":30,"y":40}]}`)
	laserFrames := b.takeBoardPresence(now)
	require.Len(t, laserFrames, 1)
	var laserEvt Event
	require.NoError(t, json.Unmarshal(laserFrames[0], &laserEvt))
	assert.Equal(t, []any{map[string]any{"x": float64(10), "y": float64(20)}, map[string]any{"x": float64(30), "y": float64(40)}}, dataMap(t, laserEvt)["laser"])
	send(`{"channelId":"A","cursor":{"x":0,"y":0}}`)
	assert.Empty(t, b.takeBoardPresence(now.Add(10*time.Second)), "stale queued presence expires")
	// No subscription and no guild are independently rejected.
	h.handleBoardPresenceAt(otherRoom, json.RawMessage(`{"channelId":"A","cursor":null}`), now)
	assert.Empty(t, b.takeBoardPresence(now))
	a.RemoveGuild("guild")
	send(`{"channelId":"A","cursor":null}`)
	assert.Empty(t, b.takeBoardPresence(now))
}

func TestBoardPresenceDoesNotTouchRedisAndBackpressureKeepsCommits(t *testing.T) {
	h := boardTestHub()
	a, b := boardTestClient(h, "a", true), boardTestClient(h, "b", true)
	subscribe(h, a, "A")
	subscribe(h, b, "A")
	clearEvents(t, h)
	for len(h.touchCh) > 0 {
		<-h.touchCh
	}
	presence := mustMarshal(Event{Op: OpBoardPresence, D: mustMarshal(map[string]any{"channelId": "A", "cursor": nil})})
	for i := 0; i < cap(b.send)/2; i++ {
		b.send <- []byte("legacy")
	}
	h.handleClientMessage(a, presence)
	assert.Len(t, b.takeBoardPresence(time.Now()), 1, "exactly half full is allowed")
	b.send <- []byte("legacy")
	h.handleClientMessage(a, presence)
	assert.Empty(t, b.takeBoardPresence(time.Now()))
	assert.Empty(t, h.touchCh)
	for len(b.send) < cap(b.send) {
		b.send <- []byte("legacy")
	}
	h.broadcastToGuild(commitEvent("A", 1))
	got := boardEvents(t, b)
	require.Len(t, got, 1)
	assert.Equal(t, OpBoardCommit, got[0].Op)
	assert.Len(t, b.send, cap(b.send))
	// Presence already pending is also dropped when pressure develops later.
	for len(b.send) > 0 {
		<-b.send
	}
	h.handleClientMessage(a, presence)
	h.broadcastToGuild(commitEvent("A", 2))
	assert.Empty(t, b.takeBoardPresence(time.Now()))
	require.Len(t, boardEvents(t, b), 1)
}

func TestBoardCleanup(t *testing.T) {
	for _, mode := range []string{"disconnect", "unsubscribe", "channel delete", "guild removal", "redis guild removal", "guild delete"} {
		t.Run(mode, func(t *testing.T) {
			h := boardTestHub()
			a, b := boardTestClient(h, "a", true), boardTestClient(h, "b", true)
			subscribe(h, a, "A")
			subscribe(h, b, "A")
			subscribe(h, a, "B")
			clearEvents(t, h)
			h.handleBoardPresence(a, mustMarshal(map[string]any{"channelId": "A", "cursor": nil}))
			h.handleBoardPresence(b, mustMarshal(map[string]any{"channelId": "A", "cursor": nil}))
			h.broadcastToGuild(commitEvent("A", 1)) // queued commits must be purged too
			switch mode {
			case "disconnect":
				h.mu.Lock()
				h.disconnectBoardsLocked(a)
				h.mu.Unlock()
			case "unsubscribe":
				h.handleBoardUnsubscribe(a, mustMarshal(map[string]string{"channelId": "A"}))
			case "channel delete":
				h.broadcastToGuild(routableEvent{Op: OpChannelDelete, GuildID: "guild", D: mustMarshal(map[string]string{"id": "A"})})
			case "guild removal":
				h.RemoveClientGuild("a", "guild")
			case "redis guild removal":
				h.broadcastToGuild(routableEvent{Op: OpGuildMemberRemove, GuildID: "guild", D: mustMarshal(map[string]string{"userId": "a"})})
			case "guild delete":
				h.broadcastToGuild(routableEvent{Op: OpGuildDelete, GuildID: "guild", D: mustMarshal(map[string]string{"id": "guild"})})
			}
			assert.False(t, a.HasRoom("A"))
			assert.Empty(t, boardEvents(t, a))
			assert.Empty(t, a.takeBoardPresence(time.Now()))
			assert.Empty(t, b.takeBoardPresence(time.Now()))
			h.broadcastToGuild(commitEvent("A", 2))
			assert.Empty(t, boardEvents(t, a))
			if mode == "channel delete" || mode == "guild delete" {
				assert.NotContains(t, h.rooms, "A")
				assert.False(t, b.HasRoom("A"))
			} else {
				assert.NotContains(t, h.rooms["A"].participants, "a")
				got := boardEvents(t, b)
				require.Len(t, got, 3) // first commit, LEAVE, second commit
				assert.Equal(t, OpBoardLeave, got[1].Op)
			}
			if mode == "unsubscribe" || mode == "channel delete" {
				assert.True(t, a.HasRoom("B"))
			} else {
				assert.False(t, a.HasRoom("B"))
			}
		})
	}
}

func TestBoardDisconnectLastConnectionOnly(t *testing.T) {
	h := boardTestHub()
	a, a2, b := boardTestClient(h, "a", true), boardTestClient(h, "a", true), boardTestClient(h, "b", true)
	for _, c := range []*Client{a, a2, b} {
		subscribe(h, c, "A")
	}
	clearEvents(t, h)
	h.mu.Lock()
	h.disconnectBoardsLocked(a)
	h.mu.Unlock()
	assert.Empty(t, boardEvents(t, b))
	h.mu.Lock()
	h.disconnectBoardsLocked(a2)
	h.mu.Unlock()
	got := boardEvents(t, b)
	require.Len(t, got, 1)
	assert.Equal(t, OpBoardLeave, got[0].Op)
	subscribe(h, a, "A")
	assert.False(t, a.HasRoom("A"), "late work cannot resubscribe a disconnected socket")
}

func TestTypingRequiresActualTextChannelInGuild(t *testing.T) {
	for _, tc := range []struct {
		kind, actualGuild, claimedGuild string
		allowed                         bool
	}{
		{"text", "guild", "guild", true},
		{"whiteboard", "guild", "guild", false},
		{"voice", "guild", "guild", false},
		{"text", "other", "guild", false},
		{"text", "guild", "other", false},
	} {
		t.Run(tc.kind+tc.actualGuild+tc.claimedGuild, func(t *testing.T) {
			h := boardTestHub()
			h.db = dbStub{row: func(sql string, args ...any) pgx.Row {
				return rowStub(func(dest ...any) error {
					if strings.Contains(sql, "FROM channels") {
						*dest[0].(*string) = tc.actualGuild
						*dest[1].(*string) = tc.kind
					} else {
						*dest[0].(*string) = "name"
					}
					return nil
				})
			}}
			c := boardTestClient(h, "u", true)
			h.handleTyping(c, Event{D: mustMarshal(map[string]string{"channelId": "channel", "guildId": tc.claimedGuild})})
			if tc.allowed {
				assert.Len(t, h.publisher.(*publishStub).events, 1)
			} else {
				assert.Empty(t, h.publisher.(*publishStub).events)
			}
		})
	}
}

func TestBoardReliableBacklogExhaustionRequiresDisconnect(t *testing.T) {
	h := boardTestHub()
	c := boardTestClient(h, "u", true)
	subscribe(h, c, "A")
	clearEvents(t, h)
	c.enqueueBoard("A", "guild", make([]byte, maxBoardBacklogBytes))
	c.enqueueBoard("A", "guild", []byte("one more commit"))
	_, overflow := c.nextBoard()
	assert.True(t, overflow, "writer must close for recovery, never continue after losing a commit")
}
