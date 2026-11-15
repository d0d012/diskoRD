package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadyCachesTypingUsername(t *testing.T) {
	h := boardTestHub()
	h.db = dbStub{row: func(sql string, args ...any) pgx.Row {
		assert.Contains(t, sql, "preferred_status, username")
		return rowStub(func(dest ...any) error {
			*dest[0].(*string) = "invisible"
			*dest[1].(*string) = "name"
			return nil
		})
	}}
	c := newClient(h, nil, "u", nil)
	h.sendReadyEvent(context.Background(), c)
	assert.Equal(t, "name", c.Username())
	var ready Event
	require.NoError(t, json.Unmarshal(<-c.send, &ready))
	assert.Equal(t, "READY", ready.Op)
	var data struct {
		Me map[string]string `json:"me"`
	}
	require.NoError(t, json.Unmarshal(ready.D, &data))
	assert.Equal(t, map[string]string{"preferredStatus": "invisible"}, data.Me)
}

func TestTypingCacheTTLBoundAndInvalidation(t *testing.T) {
	var c typingCache
	now := time.Now()
	_, ok, generation := c.get("channel", false, now)
	require.False(t, ok)
	c.put("channel", typingChannel{guildID: "guild", kind: "text"}, generation, now)
	entry, ok, _ := c.get("channel", false, now.Add(typingCacheTTL-time.Nanosecond))
	require.True(t, ok)
	assert.Equal(t, "guild", entry.guildID)
	_, ok, _ = c.get("channel", true, now)
	assert.False(t, ok, "guild channels must not be accepted as DMs")
	_, ok, _ = c.get("channel", false, now.Add(typingCacheTTL))
	assert.False(t, ok)
	for i := 0; i < typingCacheMax+1; i++ {
		c.put(fmt.Sprint(i), typingChannel{}, generation, now)
	}
	assert.Len(t, c.entries, typingCacheMax)
	c.put("channel", typingChannel{}, generation, now)
	c.invalidate("channel")
	c.put("channel", typingChannel{}, generation, now)
	_, ok, _ = c.get("channel", false, now)
	assert.False(t, ok, "an in-flight lookup must not refill a deleted channel")
}

func TestTypingCachesDMAndChecksParticipants(t *testing.T) {
	h := boardTestHub()
	queries := 0
	h.db = dbStub{row: func(sql string, args ...any) pgx.Row {
		queries++
		return rowStub(func(dest ...any) error { *dest[0].(*string) = "a"; *dest[1].(*string) = "b"; return nil })
	}}
	a := boardTestClient(h, "a", true)
	b := boardTestClient(h, "b", true)
	outsider := boardTestClient(h, "outsider", true)
	a.username.Store("old")
	event := Event{D: mustMarshal(map[string]string{"channelId": "dm"})}
	h.handleTyping(a, event)
	h.handleTyping(a, event)
	h.handleTyping(outsider, event)
	require.Equal(t, 1, queries)
	require.Len(t, b.send, 2)
	var delivered Event
	require.NoError(t, json.Unmarshal(<-b.send, &delivered))
	assert.JSONEq(t, `{"channelId":"dm","userId":"a","username":"old"}`, string(delivered.D))
	<-b.send
	h.PublishUserUpdate("a", map[string]string{"username": "new"}, nil)
	assert.Equal(t, "new", a.Username())
	h.handleTyping(a, event)
	require.NoError(t, json.Unmarshal(<-b.send, &delivered))
	assert.JSONEq(t, `{"channelId":"dm","userId":"a","username":"new"}`, string(delivered.D))
	h.broadcastToGuild(routableEvent{Op: OpChannelDelete, GuildID: "guild", D: mustMarshal(map[string]string{"id": "dm"})})
	h.handleTyping(a, event)
	assert.Equal(t, 2, queries, "channel deletion must invalidate typing metadata")
}
