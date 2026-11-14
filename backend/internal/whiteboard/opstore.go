package whiteboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// RedisOpStore keeps command results under board:op:{opId} for OpTTL.
type RedisOpStore struct {
	rdb *redis.Client
}

func NewRedisOpStore(rdb *redis.Client) *RedisOpStore {
	return &RedisOpStore{rdb: rdb}
}

func opKey(opID string) string { return "board:op:" + opID }

func (s *RedisOpStore) Get(ctx context.Context, opID string) (*OpRecord, error) {
	raw, err := s.rdb.Get(ctx, opKey(opID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("whiteboard.RedisOpStore.Get: %w", err)
	}
	var rec OpRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, fmt.Errorf("whiteboard.RedisOpStore.Get: decode: %w", err)
	}
	return &rec, nil
}

func (s *RedisOpStore) Put(ctx context.Context, opID string, rec OpRecord) error {
	raw, err := json.Marshal(rec)
	if err != nil {
		return fmt.Errorf("whiteboard.RedisOpStore.Put: encode: %w", err)
	}
	if err := s.rdb.Set(ctx, opKey(opID), raw, OpTTL).Err(); err != nil {
		return fmt.Errorf("whiteboard.RedisOpStore.Put: %w", err)
	}
	return nil
}
