package gateway

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/d0d012/diskord/internal/presence"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
)

func TestPreferredMapRoundTrip(t *testing.T) {
	h := NewHub(nil, nil, nil)

	assert.Equal(t, "online", h.getPreferred("u1"), "unknown users default to online")

	h.setPreferred("u1", "dnd")
	assert.Equal(t, "dnd", h.getPreferred("u1"))

	h.clearPreferred("u1")
	assert.Equal(t, "online", h.getPreferred("u1"))
}

func TestTouchIsNonBlockingWhenFull(t *testing.T) {
	h := NewHub(nil, nil, nil)

	// Enqueue well past capacity; touch must drop instead of blocking a read loop.
	c := newClient(h, nil, "u1", nil)
	for i := 0; i < cap(h.touchCh)+32; i++ {
		h.touch(c)
	}

	assert.Len(t, h.touchCh, cap(h.touchCh))
}

func TestTouchCoalescesOnlySuccessfulRefreshes(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr(), MaxRetries: -1})
	t.Cleanup(func() { rdb.Close() })
	h := NewHub(rdb, nil, presence.NewService(rdb))
	c := newClient(h, nil, "u1", nil)
	h.clients[c.userID] = map[*Client]bool{c: true}
	h.setPreferred(c.userID, "invisible")
	require.NoError(t, h.presence.Set(context.Background(), c.userID, "invisible"))
	h.touch(c)
	h.touch(c) // already-queued messages must also coalesce in the hub
	h.handleTouch(<-h.touchCh)
	require.NotZero(t, c.lastTouch.Load())
	mr.FastForward(5 * time.Second)
	h.handleTouch(<-h.touchCh)
	assert.Equal(t, 85*time.Second, mr.TTL("presence:u1"))
	h.touch(c)
	assert.Empty(t, h.touchCh)
	c.lastTouch.Store(time.Now().Add(-touchInterval).UnixNano())
	h.touch(c)
	h.handleTouch(<-h.touchCh)
	assert.Equal(t, 90*time.Second, mr.TTL("presence:u1"))
	value, err := mr.Get("presence:u1")
	require.NoError(t, err)
	assert.Equal(t, "invisible", value)
	c.lastTouch.Store(0)
	require.NoError(t, rdb.Close())
	h.handleTouch(c)
	assert.Zero(t, c.lastTouch.Load(), "failed writes must remain retryable")
	h.touch(c)
	assert.Len(t, h.touchCh, 1)
}

func TestRecentTouchBoundary(t *testing.T) {
	c := &Client{}
	now := time.Now()
	assert.False(t, recentTouch(c, now))
	c.lastTouch.Store(now.UnixNano())
	assert.True(t, recentTouch(c, now.Add(touchInterval-time.Nanosecond)))
	assert.False(t, recentTouch(c, now.Add(touchInterval)))
}
