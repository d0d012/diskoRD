package gateway

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBoardConcurrentRoomLifecycle(t *testing.T) {
	h := boardTestHub()
	clients := make([]*Client, 6)
	for i := range clients {
		clients[i] = boardTestClient(h, fmt.Sprintf("user%d", i/2), true)
	}
	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Add(1)
		go func(c *Client) {
			defer wg.Done()
			for i := 0; i < 25; i++ {
				subscribe(h, c, "A")
				h.handleBoardPresence(c, mustMarshal(map[string]any{"channelId": "A", "cursor": nil}))
				c.nextBoard()
				c.nextBoardPresence(time.Now())
				h.handleBoardUnsubscribe(c, mustMarshal(map[string]string{"channelId": "A"}))
			}
		}(c)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for seq := 1; seq <= 100; seq++ {
			h.broadcastToGuild(commitEvent("A", seq))
		}
	}()
	wg.Wait()
	assert.Empty(t, h.rooms)
	for _, c := range clients {
		assert.Empty(t, c.RoomIDs())
		assert.Empty(t, boardEvents(t, c))
		assert.Empty(t, c.takeBoardPresence(time.Now()))
	}
}

func TestBoardPresenceCoalescedSizeStillBounded(t *testing.T) {
	h := boardTestHub()
	a, b := boardTestClient(h, "a", true), boardTestClient(h, "b", true)
	subscribe(h, a, "A")
	subscribe(h, b, "A")
	clearEvents(t, h)
	first := mustMarshal(map[string]any{"channelId": "A", "selectedIds": []string{strings.Repeat("x", 1100)}})
	second := mustMarshal(map[string]any{"channelId": "A", "editingId": strings.Repeat("y", 1100)})
	h.handleBoardPresence(a, first)
	h.handleBoardPresence(a, second)
	frames := b.takeBoardPresence(time.Now())
	require.Len(t, frames, 1)
	var event Event
	require.NoError(t, json.Unmarshal(frames[0], &event))
	assert.LessOrEqual(t, len(event.D), maxBoardPresenceBytes)
	d := dataMap(t, event)
	assert.Equal(t, strings.Repeat("y", 1100), d["editingId"])
	assert.NotContains(t, d, "selectedIds", "keep newest legal update if the union exceeds the cap")
}

func TestBoardGuildRemovalClearsAllTabsWithOneLeave(t *testing.T) {
	h := boardTestHub()
	a, a2, b := boardTestClient(h, "a", true), boardTestClient(h, "a", true), boardTestClient(h, "b", true)
	for _, c := range []*Client{a, a2, b} {
		subscribe(h, c, "A")
	}
	clearEvents(t, h)
	h.handleBoardPresence(a, mustMarshal(map[string]any{"channelId": "A", "cursor": nil}))
	require.Len(t, b.boardPresence, 1)
	h.RemoveClientGuild("a", "guild")
	assert.False(t, a.HasGuild("guild"))
	assert.False(t, a2.HasGuild("guild"))
	assert.Empty(t, a.RoomIDs())
	assert.Empty(t, a2.RoomIDs())
	assert.Empty(t, b.boardPresence, "last connection's departure purges its queued presence")
	got := boardEvents(t, b)
	require.Len(t, got, 1)
	assert.Equal(t, OpBoardLeave, got[0].Op)
}
