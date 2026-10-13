package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ttl is how long a presence key survives without a server-side ping. Pings are
// sent every 30s, so 90s tolerates two missed pings before a key expires.
const ttl = 90 * time.Second

type Service struct {
	rdb *redis.Client
}

func NewService(rdb *redis.Client) *Service {
	return &Service{rdb: rdb}
}

func key(userID string) string {
	return fmt.Sprintf("presence:%s", userID)
}

// touchScript refreshes an existing presence key's TTL without changing its
// value (which another instance may have just written), or creates it with the
// supplied value if it is missing. It returns whether the key already existed,
// so the hub knows when a user "came back".
var touchScript = redis.NewScript(`
local existed = redis.call('EXISTS', KEYS[1])
if existed == 0 then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
else
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return existed
`)

// restoreScript sets the status only while the key still holds expected, so a
// stale recovery cannot clobber a newer value written by another instance.
var restoreScript = redis.NewScript(`
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
return 0
`)

// Visible maps a stored preferred status to the status other users are allowed
// to see. Invisible users read as offline, as does anything unknown.
func Visible(status string) string {
	switch status {
	case "online", "idle", "dnd":
		return status
	default:
		return "offline"
	}
}

// Set stores the user's preferred status and (re)starts the presence TTL.
func (s *Service) Set(ctx context.Context, userID, status string) error {
	return s.rdb.Set(ctx, key(userID), status, ttl).Err()
}

// Touch creates the presence key if missing (with status) or refreshes its TTL
// without changing the existing value, in one round trip. It reports whether the
// key was missing, i.e. the user just came back.
func (s *Service) Touch(ctx context.Context, userID, status string) (recreated bool, err error) {
	existed, err := touchScript.Run(ctx, s.rdb, []string{key(userID)}, status, int(ttl.Seconds())).Int64()
	if err != nil {
		return false, err
	}
	return existed == 0, nil
}

// Restore sets status only if the key still holds expected, returning whether it
// did. Recovering an expired key uses this so a concurrent write from another
// instance is never overwritten.
func (s *Service) Restore(ctx context.Context, userID, expected, status string) (bool, error) {
	ok, err := restoreScript.Run(ctx, s.rdb, []string{key(userID)}, expected, status, int(ttl.Seconds())).Int64()
	if err != nil {
		return false, err
	}
	return ok == 1, nil
}

// SetIfOnline updates the stored status only while the user still has a live
// presence key, preserving its remaining TTL. It reports whether the key
// existed.
func (s *Service) SetIfOnline(ctx context.Context, userID, status string) (bool, error) {
	err := s.rdb.SetArgs(ctx, key(userID), status, redis.SetArgs{
		Mode:    "XX",
		KeepTTL: true,
	}).Err()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) SetOffline(ctx context.Context, userID string) error {
	return s.rdb.Del(ctx, key(userID)).Err()
}

// GetStatus returns the visible status of the user ("online" | "idle" | "dnd" | "offline").
func (s *Service) GetStatus(ctx context.Context, userID string) string {
	val, err := s.rdb.Get(ctx, key(userID)).Result()
	if err != nil {
		return "offline"
	}
	return Visible(val)
}

// GetStatuses returns a map of userID → visible status for the given IDs.
func (s *Service) GetStatuses(ctx context.Context, userIDs []string) map[string]string {
	result := make(map[string]string, len(userIDs))
	if len(userIDs) == 0 {
		return result
	}

	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = key(id)
	}

	vals, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		for _, id := range userIDs {
			result[id] = "offline"
		}
		return result
	}

	for i, id := range userIDs {
		if vals[i] != nil {
			result[id] = Visible(vals[i].(string))
		} else {
			result[id] = "offline"
		}
	}
	return result
}
