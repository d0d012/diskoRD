package call

import (
	"context"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/d0d012/diskord/pkg/config"
)

type notice struct{ user, op string }

type fakeNotifier struct {
	mu   sync.Mutex
	sent []notice
}

func (f *fakeNotifier) NotifyUser(userID, op string, _ interface{}) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, notice{userID, op})
}

func (f *fakeNotifier) has(user, op string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, n := range f.sent {
		if n.user == user && n.op == op {
			return true
		}
	}
	return false
}

// newTestService needs a local Redis (dev compose, port 6380); the test is
// skipped when it is unreachable. DB 15 is used and flushed.
func newTestService(t *testing.T) (*Service, *fakeNotifier) {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6380", DB: 15})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skip("redis not available:", err)
	}
	rdb.FlushDB(context.Background())
	t.Cleanup(func() { rdb.FlushDB(context.Background()); rdb.Close() })

	n := &fakeNotifier{}
	s := &Service{rdb: rdb, notifier: n, cfg: config.LiveKitConfig{APIKey: "k", APISecret: "secretsecretsecretsecretsecret32", Host: "localhost", Port: 7880}}
	s.lookupDM = func(_ context.Context, channelID, userID string) (string, string, error) {
		if channelID != "dm1" || (userID != "alice" && userID != "bob") {
			return "", "", fiber.NewError(fiber.StatusNotFound, "DM channel not found")
		}
		return "alice", "bob", nil
	}
	s.lookupName = func(_ context.Context, id string) string { return id }
	return s, n
}

func statusOf(err error) int {
	if fe, ok := err.(*fiber.Error); ok {
		return fe.Code
	}
	return 0
}

func TestCallLifecycle(t *testing.T) {
	ctx := context.Background()

	t.Run("initiate rings the recipient", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		assert.True(t, n.has("bob", "CALL_INVITE"))
	})

	t.Run("non-participant cannot initiate", func(t *testing.T) {
		s, _ := newTestService(t)
		assert.Equal(t, 404, statusOf(s.Initiate(ctx, "dm1", "mallory")))
	})

	t.Run("second initiate is rejected, including glare", func(t *testing.T) {
		s, _ := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		assert.Equal(t, 409, statusOf(s.Initiate(ctx, "dm1", "alice")))
		assert.Equal(t, 409, statusOf(s.Initiate(ctx, "dm1", "bob")))
	})

	t.Run("busy user in another call", func(t *testing.T) {
		s, _ := newTestService(t)
		require.NoError(t, s.rdb.Set(ctx, userCallKey("bob"), "other", 0).Err())
		assert.Equal(t, 409, statusOf(s.Initiate(ctx, "dm1", "alice")))
	})

	t.Run("caller cannot accept own call", func(t *testing.T) {
		s, _ := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		assert.Equal(t, 403, statusOf(s.Accept(ctx, "dm1", "alice")))
	})

	t.Run("accept notifies both and makes call active", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		require.NoError(t, s.Accept(ctx, "dm1", "bob"))
		assert.True(t, n.has("alice", "CALL_ACCEPT"))
		assert.True(t, n.has("bob", "CALL_ACCEPT"))
		assert.Equal(t, 409, statusOf(s.Initiate(ctx, "dm1", "bob")), "active call blocks a new ring")
		assert.NoError(t, s.Keepalive(ctx, "dm1", "alice"))
	})

	t.Run("accept after the call is gone returns 410", func(t *testing.T) {
		s, _ := newTestService(t)
		assert.Equal(t, 410, statusOf(s.Accept(ctx, "dm1", "bob")))
	})

	t.Run("decline notifies the caller and clears state", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		assert.Equal(t, 404, statusOf(s.Decline(ctx, "dm1", "mallory")))
		assert.Equal(t, 403, statusOf(s.Decline(ctx, "dm1", "alice")))
		require.NoError(t, s.Decline(ctx, "dm1", "bob"))
		assert.True(t, n.has("alice", "CALL_DECLINE"))
		assert.NoError(t, s.Initiate(ctx, "dm1", "alice"), "state cleared, can call again")
	})

	t.Run("end notifies both and frees both users", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		require.NoError(t, s.Accept(ctx, "dm1", "bob"))
		require.NoError(t, s.End(ctx, "dm1", "alice"))
		assert.True(t, n.has("alice", "CALL_END"))
		assert.True(t, n.has("bob", "CALL_END"))
		assert.Equal(t, 410, statusOf(s.Keepalive(ctx, "dm1", "bob")))
		assert.NoError(t, s.Initiate(ctx, "dm1", "bob"))
	})

	t.Run("ring timeout notifies both", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		s.expireRing("dm1", "alice")
		assert.True(t, n.has("alice", "CALL_TIMEOUT"))
		assert.True(t, n.has("bob", "CALL_TIMEOUT"))
		assert.Equal(t, 410, statusOf(s.Accept(ctx, "dm1", "bob")))
	})

	t.Run("ring timeout does not touch an accepted call", func(t *testing.T) {
		s, n := newTestService(t)
		require.NoError(t, s.Initiate(ctx, "dm1", "alice"))
		require.NoError(t, s.Accept(ctx, "dm1", "bob"))
		s.expireRing("dm1", "alice")
		assert.False(t, n.has("alice", "CALL_TIMEOUT"))
	})
}
