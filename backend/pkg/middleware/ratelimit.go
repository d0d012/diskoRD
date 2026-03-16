package middleware

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

type RateLimitConfig struct {
	Max    int
	Window time.Duration
}

func RateLimit(rdb *redis.Client, cfg RateLimitConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		path := c.Path()
		key := fmt.Sprintf("ratelimit:%s:%s", ip, path)

		ctx := context.Background()

		count, err := rdb.Incr(ctx, key).Result()
		if err != nil {
			return c.Next()
		}

		if count == 1 {
			rdb.Expire(ctx, key, cfg.Window)
		}

		ttl, _ := rdb.TTL(ctx, key).Result()

		if count > int64(cfg.Max) {
			retryAfter := int(ttl.Seconds())
			if retryAfter <= 0 {
				retryAfter = int(cfg.Window.Seconds())
			}
			c.Set("Retry-After", fmt.Sprintf("%d", retryAfter))
			return fiber.NewError(fiber.StatusTooManyRequests, "rate limit exceeded")
		}

		c.Set("X-RateLimit-Limit", fmt.Sprintf("%d", cfg.Max))
		c.Set("X-RateLimit-Remaining", fmt.Sprintf("%d", int64(cfg.Max)-count))
		return c.Next()
	}
}
