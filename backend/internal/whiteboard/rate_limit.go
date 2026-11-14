package whiteboard

import (
	"math"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	MaxCommandsPerSecond = 10
	CommandBurst         = 20
)

type commandBucket struct {
	tokens float64
	last   time.Time
}

type commandLimiter struct {
	mu        sync.Mutex
	users     map[string]commandBucket
	now       func() time.Time
	nextSweep time.Time
}

func newCommandLimiter() *commandLimiter {
	return &commandLimiter{users: make(map[string]commandBucket), now: time.Now}
}

func (l *commandLimiter) allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	// No maintenance goroutine and no permanent entry per user. An idle bucket
	// would already be full after two seconds; expiry cannot increase its burst.
	if !now.Before(l.nextSweep) {
		for id, bucket := range l.users {
			if now.Sub(bucket.last) >= time.Minute {
				delete(l.users, id)
			}
		}
		l.nextSweep = now.Add(time.Minute)
	}
	bucket, found := l.users[userID]
	if !found {
		bucket.tokens = CommandBurst
	} else {
		bucket.tokens = math.Min(CommandBurst, bucket.tokens+math.Max(0, now.Sub(bucket.last).Seconds())*MaxCommandsPerSecond)
	}
	bucket.last = now
	allowed := bucket.tokens >= 1
	if allowed {
		bucket.tokens--
	}
	// Fiber locals may refer to reusable request buffers, including on updates
	// of existing map keys. Keep our own immutable key storage.
	l.users[strings.Clone(userID)] = bucket
	return allowed
}

// Must run after authentication. One bucket per user across all boards and IPs.
func (l *commandLimiter) middleware(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	}
	if !l.allow(userID) {
		return fiber.NewError(fiber.StatusTooManyRequests, "too many board commands")
	}
	return c.Next()
}
