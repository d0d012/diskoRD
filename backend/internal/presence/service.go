package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const ttl = 65 * time.Second // heartbeat every 30s, TTL 65s gives 2 missed beats before offline

type Service struct {
	rdb *redis.Client
}

func NewService(rdb *redis.Client) *Service {
	return &Service{rdb: rdb}
}

func key(userID string) string {
	return fmt.Sprintf("presence:%s", userID)
}

func (s *Service) SetOnline(ctx context.Context, userID string) error {
	return s.rdb.Set(ctx, key(userID), "online", ttl).Err()
}

func (s *Service) Refresh(ctx context.Context, userID string) error {
	return s.rdb.Expire(ctx, key(userID), ttl).Err()
}

func (s *Service) SetOffline(ctx context.Context, userID string) error {
	return s.rdb.Del(ctx, key(userID)).Err()
}

// GetStatus returns "online" or "offline".
func (s *Service) GetStatus(ctx context.Context, userID string) string {
	val, err := s.rdb.Get(ctx, key(userID)).Result()
	if err != nil {
		return "offline"
	}
	return val
}

// GetStatuses returns a map of userID → status for the given IDs.
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
			result[id] = vals[i].(string)
		} else {
			result[id] = "offline"
		}
	}
	return result
}
