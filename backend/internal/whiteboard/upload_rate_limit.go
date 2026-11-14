package whiteboard

import (
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Sliding window, rather than a token bucket: at most ten accepted upload
// attempts in ANY minute, across boards/IPs. State is in-process (single server).
type uploadLimiter struct {
	mu        sync.Mutex
	users     map[string][]time.Time
	now       func() time.Time
	nextSweep time.Time
}

func newUploadLimiter() *uploadLimiter {
	return &uploadLimiter{users: make(map[string][]time.Time), now: time.Now}
}

func (l *uploadLimiter) allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	cutoff := now.Add(-UploadRateWindow)
	if !now.Before(l.nextSweep) {
		for id, attempts := range l.users {
			if !attempts[len(attempts)-1].After(cutoff) {
				delete(l.users, id)
			}
		}
		l.nextSweep = now.Add(UploadRateWindow)
	}
	attempts := l.users[userID]
	for len(attempts) > 0 && !attempts[0].After(cutoff) {
		attempts = attempts[1:]
	}
	if len(attempts) >= MaxUploadsPerMinute {
		return false
	}
	l.users[strings.Clone(userID)] = append(attempts, now)
	return true
}

func (l *uploadLimiter) middleware(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	}
	if !l.allow(userID) {
		return fiber.NewError(fiber.StatusTooManyRequests, "too many board image uploads; try again in a minute")
	}
	return c.Next()
}
