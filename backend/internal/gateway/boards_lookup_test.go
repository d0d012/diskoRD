package gateway

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Block each database boundary separately, not just the initial permission
// check. Existing clients must keep receiving both guild and board traffic.
func TestSlowBoardLookupDoesNotBlockOtherClients(t *testing.T) {
	for _, stage := range []string{"authorization and seq", "participant name"} {
		t.Run(stage, func(t *testing.T) {
			h := boardTestHub()
			existing := boardTestClient(h, "existing", true)
			joining := boardTestClient(h, "joining", true)
			subscribe(h, existing, "A")
			clearEvents(t, h)
			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			if stage == "authorization and seq" {
				h.SetBoardReader(boardReaderStub{read: func(context.Context, string, string) (string, int64, error) {
					close(entered)
					<-release
					return "guild", 17, nil
				}})
			} else {
				h.db = dbStub{row: func(string, ...any) pgx.Row {
					return rowStub(func(dest ...any) error {
						close(entered)
						<-release
						*dest[0].(*string) = "Joining"
						return nil
					})
				}}
			}
			go func() { subscribe(h, joining, "B"); close(done) }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("lookup never started")
			}
			traffic := make(chan struct{})
			go func() {
				h.broadcastToGuild(routableEvent{Op: OpTypingStart, GuildID: "guild", D: json.RawMessage(`{"channelId":"text"}`)})
				h.broadcastToGuild(commitEvent("A", 18))
				close(traffic)
			}()
			select {
			case <-traffic:
			case <-time.After(time.Second):
				t.Fatal("slow subscription blocked unrelated gateway traffic")
			}
			select {
			case raw := <-existing.send:
				var event Event
				require.NoError(t, json.Unmarshal(raw, &event))
				assert.Equal(t, OpTypingStart, event.Op)
			default:
				t.Fatal("guild traffic not delivered")
			}
			commits := boardEvents(t, existing)
			require.Len(t, commits, 1)
			assert.Equal(t, OpBoardCommit, commits[0].Op)
			unblock()
			<-done
			joined := boardEvents(t, joining)
			require.Len(t, joined, 2)
			assert.Equal(t, OpBoardSubscribed, joined[0].Op)
			assert.Equal(t, OpBoardJoin, joined[1].Op)
			assert.Empty(t, h.boardSubscriptions)
		})
	}
}

func TestBoardLookupLifecycleRacesDoNotResurrectRooms(t *testing.T) {
	for _, lifecycle := range []string{"disconnect", "channel delete", "guild delete", "guild remove and re-add", "unsubscribe"} {
		t.Run(lifecycle, func(t *testing.T) {
			h := boardTestHub()
			c := boardTestClient(h, "joining", true)
			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			h.SetBoardReader(boardReaderStub{read: func(context.Context, string, string) (string, int64, error) {
				close(entered)
				<-release
				return "guild", 17, nil // stale success, e.g. before concurrent deletion
			}})
			go func() { subscribe(h, c, "A"); close(done) }()
			<-entered
			changed := make(chan struct{})
			go func() {
				switch lifecycle {
				case "disconnect":
					h.mu.Lock()
					h.disconnectBoardsLocked(c)
					h.mu.Unlock()
				case "channel delete":
					h.cleanupBoardEvent(routableEvent{Op: OpChannelDelete, GuildID: "guild", D: mustMarshal(map[string]string{"id": "A"})})
				case "guild delete":
					h.cleanupBoardEvent(routableEvent{Op: OpGuildDelete, GuildID: "guild", D: mustMarshal(map[string]string{"id": "guild"})})
				case "guild remove and re-add":
					h.RemoveClientGuild(c.userID, "guild")
					c.AddGuild("guild")
				case "unsubscribe":
					h.handleBoardUnsubscribe(c, mustMarshal(map[string]string{"channelId": "A"}))
				}
				close(changed)
			}()
			select {
			case <-changed:
			case <-time.After(time.Second):
				t.Fatal("lookup blocks room lifecycle")
			}
			unblock()
			<-done
			assert.Empty(t, h.rooms)
			assert.Empty(t, c.RoomIDs())
			assert.Empty(t, boardEvents(t, c))
			assert.Empty(t, h.boardSubscriptions)
		})
	}
}

func TestConcurrentRepeatedSubscribeIsIdempotent(t *testing.T) {
	h := boardTestHub()
	c := boardTestClient(h, "joining", true)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); subscribe(h, c, "A") }()
	}
	wg.Wait()
	events := boardEvents(t, c)
	require.Len(t, events, 9)
	assert.Equal(t, OpBoardSubscribed, events[0].Op)
	assert.Equal(t, OpBoardJoin, events[1].Op)
	for _, event := range events[2:] {
		assert.Equal(t, OpBoardSubscribed, event.Op)
	}
	assert.Len(t, h.rooms["A"].connections, 1)
	assert.Len(t, h.rooms["A"].participants, 1)
	assert.Empty(t, h.boardSubscriptions)
}
