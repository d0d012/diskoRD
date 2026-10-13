package presence

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVisible(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{"online", "online"},
		{"idle", "idle"},
		{"dnd", "dnd"},
		{"invisible", "offline"},
		{"offline", "offline"},
		{"", "offline"},
		{"garbage", "offline"},
	}
	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			assert.Equal(t, tc.want, Visible(tc.status))
		})
	}
}

func newTestService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return NewService(rdb), mr
}

func TestTouchCreatesMissingKey(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	recreated, err := svc.Touch(ctx, "u1", "dnd")
	require.NoError(t, err)
	assert.True(t, recreated, "first touch should report the key was created")
	assert.Equal(t, "dnd", svc.GetStatus(ctx, "u1"))
	assert.Positive(t, mr.TTL("presence:u1"))

	recreated, err = svc.Touch(ctx, "u1", "dnd")
	require.NoError(t, err)
	assert.False(t, recreated, "second touch should report the key already existed")
}

func TestTouchRecreatesExpiredKey(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	require.NoError(t, svc.Set(ctx, "u1", "idle"))
	mr.Del("presence:u1") // simulate the key expiring while the socket stays open

	recreated, err := svc.Touch(ctx, "u1", "idle")
	require.NoError(t, err)
	assert.True(t, recreated, "touch after expiry should report the user came back")
	assert.Equal(t, "idle", svc.GetStatus(ctx, "u1"))
}

func TestTouchDoesNotOverwriteExistingValue(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	require.NoError(t, svc.Set(ctx, "u1", "dnd"))

	recreated, err := svc.Touch(ctx, "u1", "online")
	require.NoError(t, err)
	assert.False(t, recreated)
	assert.Equal(t, "dnd", svc.GetStatus(ctx, "u1"), "a touch must not clobber another instance's status")
}

func TestTouchRefreshesTTL(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	require.NoError(t, svc.Set(ctx, "u1", "dnd"))
	mr.FastForward(60 * time.Second)
	require.Equal(t, 30*time.Second, mr.TTL("presence:u1"), "sanity: TTL should have decayed")

	recreated, err := svc.Touch(ctx, "u1", "dnd")
	require.NoError(t, err)
	assert.False(t, recreated)
	assert.Equal(t, 90*time.Second, mr.TTL("presence:u1"), "touch must extend the TTL back to the full window")
}

func TestRestoreOnlyOverwritesUnchangedValue(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	require.NoError(t, svc.Set(ctx, "u1", "online"))

	ok, err := svc.Restore(ctx, "u1", "online", "invisible")
	require.NoError(t, err)
	assert.True(t, ok)
	stored, err := mr.Get("presence:u1")
	require.NoError(t, err)
	assert.Equal(t, "invisible", stored)

	// The key now holds a newer value; a stale recovery expecting "online" must not win.
	ok, err = svc.Restore(ctx, "u1", "online", "dnd")
	require.NoError(t, err)
	assert.False(t, ok)
	stored, err = mr.Get("presence:u1")
	require.NoError(t, err)
	assert.Equal(t, "invisible", stored)
}

func TestSetIfOnlineIgnoresMissingKeyAndKeepsTTL(t *testing.T) {
	svc, mr := newTestService(t)
	ctx := context.Background()

	online, err := svc.SetIfOnline(ctx, "missing", "dnd")
	require.NoError(t, err)
	assert.False(t, online, "SetIfOnline must not create a key")

	require.NoError(t, svc.Set(ctx, "u1", "online"))
	mr.SetTTL("presence:u1", 30*time.Second)

	online, err = svc.SetIfOnline(ctx, "u1", "dnd")
	require.NoError(t, err)
	assert.True(t, online)
	assert.Equal(t, "dnd", svc.GetStatus(ctx, "u1"))
	assert.Equal(t, 30*time.Second, mr.TTL("presence:u1"), "TTL must be preserved exactly")
}
