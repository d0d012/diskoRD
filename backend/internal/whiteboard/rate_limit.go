package whiteboard

import (
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	MaxCommandsPerSecond     = 10
	CommandBurst             = 20
	MaxCommandBytesPerSecond = 256 * 1024
	CommandByteBurst         = 2 * 1024 * 1024
	SnapshotRefillInterval   = 2 * time.Second
	SnapshotBurst            = 6
	PurgeRefillInterval      = 2 * time.Second
	PurgeBurst               = 3
)

type userBucket struct {
	tokens float64
	last   time.Time
}

type userLimiter struct {
	mu        sync.Mutex
	users     map[string]userBucket
	now       func() time.Time
	nextSweep time.Time
	rate      float64
	burst     float64
	message   string
	cost      func(*fiber.Ctx) int // nil means one token per request
}

func newCommandLimiter() *userLimiter {
	return &userLimiter{
		users: make(map[string]userBucket), now: time.Now,
		rate: MaxCommandsPerSecond, burst: CommandBurst, message: "too many board commands",
	}
}

func newCommandByteLimiter() *userLimiter {
	return &userLimiter{
		users: make(map[string]userBucket), now: time.Now,
		rate: MaxCommandBytesPerSecond, burst: CommandByteBurst, message: "board command byte budget exceeded",
		// Charge the entire request, including envelope/whitespace and cached
		// resends, before parsing or DB access. Resends still avoid writes/fanout.
		cost: func(c *fiber.Ctx) int { return len(c.Body()) },
	}
}

func newSnapshotLimiter() *userLimiter {
	return &userLimiter{
		users: make(map[string]userBucket), now: time.Now,
		rate: 1 / SnapshotRefillInterval.Seconds(), burst: SnapshotBurst, message: "too many board snapshots",
	}
}

func newPurgeLimiter() *userLimiter {
	return &userLimiter{
		users: make(map[string]userBucket), now: time.Now,
		rate: 1 / PurgeRefillInterval.Seconds(), burst: PurgeBurst, message: "too many board purges",
	}
}

func (l *userLimiter) allow(userID string) bool { return l.take(userID, 1) == 0 }

// take returns zero on success, otherwise the refill delay in whole seconds.
func (l *userLimiter) take(userID string, cost int) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	// No maintenance goroutine and no permanent entry per user. All buckets
	// refill fully within a minute; expiry cannot increase their burst.
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
		bucket.tokens = l.burst
	} else {
		bucket.tokens = math.Min(l.burst, bucket.tokens+math.Max(0, now.Sub(bucket.last).Seconds())*l.rate)
	}
	bucket.last = now
	retry := 0
	if bucket.tokens >= float64(cost) {
		bucket.tokens -= float64(cost)
	} else {
		retry = max(1, int(math.Ceil((float64(cost)-bucket.tokens)/l.rate)))
	}
	// Fiber locals may refer to reusable request buffers, including on updates
	// of existing map keys. Keep our own immutable key storage.
	l.users[strings.Clone(userID)] = bucket
	return retry
}

// Must run after authentication. One bucket per user across all boards and IPs.
func (l *userLimiter) middleware(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	}
	cost := 1
	if l.cost != nil {
		cost = l.cost(c)
	}
	if float64(cost) > l.burst {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "board command exceeds byte burst limit")
	}
	if retry := l.take(userID, cost); retry > 0 {
		c.Set(fiber.HeaderRetryAfter, strconv.Itoa(retry))
		return fiber.NewError(fiber.StatusTooManyRequests, l.message)
	}
	return c.Next()
}
