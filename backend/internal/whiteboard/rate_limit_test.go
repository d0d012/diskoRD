package whiteboard

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestByteLimiterRefillScopeAndExpiry(t *testing.T) {
	l := newCommandByteLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	assert.Zero(t, l.take("a", CommandByteBurst))
	assert.Equal(t, 4, l.take("a", MaxCommandBytes))
	assert.Zero(t, l.take("b", CommandByteBurst))
	now = now.Add(3 * time.Second)
	assert.Equal(t, 1, l.take("a", MaxCommandBytes))
	now = now.Add(time.Second)
	assert.Zero(t, l.take("a", MaxCommandBytes))
	assert.Equal(t, 1, l.take("a", 1))
	now = now.Add(time.Minute)
	assert.Zero(t, l.take("fresh", 1))
	assert.NotContains(t, l.users, "a")
	assert.NotContains(t, l.users, "b")
	assert.Zero(t, l.take("a", CommandByteBurst))
}

func TestByteLimiterRejectsCostAboveBurst(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(strconv.FormatBool(existing), func(t *testing.T) {
			l := newCommandByteLimiter()
			now := time.Now()
			l.now = func() time.Time { return now }
			if existing {
				require.Zero(t, l.take(userID, 1))
			}
			before := l.users[userID]
			app := testApp(newHarness(), true)
			app.Post("/byte-limit", func(c *fiber.Ctx) error {
				c.Locals("userID", userID)
				return c.Next()
			}, l.middleware, func(c *fiber.Ctx) error {
				t.Fatal("oversized request reached handler")
				return nil
			})
			status, body, headers := doWithHeaders(t, app, "POST", "/byte-limit", strings.Repeat(" ", CommandByteBurst+1))
			assert.Equal(t, http.StatusRequestEntityTooLarge, status)
			assert.Equal(t, map[string]any{"error": "board command exceeds byte burst limit"}, body)
			assert.Empty(t, headers.Get("Retry-After"))
			assert.Equal(t, before, l.users[userID], "rejection must not change tokens")
			_, found := l.users[userID]
			assert.Equal(t, existing, found, "rejection must not create a bucket")
		})
	}
}

func TestByteLimiterConcurrentBurst(t *testing.T) {
	l := newCommandByteLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	var wg sync.WaitGroup
	results := make(chan int, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- l.take("a", MaxCommandBytes) }()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for retry := range results {
		if retry == 0 {
			accepted++
		}
	}
	assert.Equal(t, 2, accepted)
}

func TestSnapshotLimiterRefillScopeAndExpiry(t *testing.T) {
	l := newSnapshotLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	for i := 0; i < SnapshotBurst; i++ {
		require.True(t, l.allow("a"))
	}
	assert.Equal(t, 2, l.take("a", 1))
	assert.True(t, l.allow("b"))
	now = now.Add(time.Second)
	assert.Equal(t, 1, l.take("a", 1))
	now = now.Add(time.Second)
	assert.True(t, l.allow("a"))
	assert.Equal(t, 2, l.take("a", 1))
	now = now.Add(time.Minute)
	assert.True(t, l.allow("fresh"))
	assert.NotContains(t, l.users, "a")
	assert.NotContains(t, l.users, "b")
}

func TestOpsByteBudgetRouteIncludingCachedRetries(t *testing.T) {
	h := newHarness()
	app := testApp(h, true)
	id := h.uuid()
	req := string(raw(CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}))
	// Envelope whitespace is charged too, even though the body cap is small.
	req = req[:1] + strings.Repeat(" ", 900*1024-len(req)) + req[1:]
	for i := 0; i < 2; i++ {
		status, _ := do(t, app, "POST", "/channels/"+chID+"/board/ops", req)
		require.Equal(t, http.StatusOK, status)
	}
	status, body, headers := doWithHeaders(t, app, "POST", "/channels/"+chID+"/board/ops", req)
	assert.Equal(t, http.StatusTooManyRequests, status)
	assert.Equal(t, map[string]any{"error": "board command byte budget exceeded"}, body)
	retry, err := strconv.Atoi(headers.Get("Retry-After"))
	require.NoError(t, err)
	assert.GreaterOrEqual(t, retry, 1)
	assert.Equal(t, 1, h.repo.commitCalls, "cached retry does not write")
	assert.Len(t, h.pub.payloads, 1, "cached retry does not fan out")
	status, _ = do(t, app, "GET", "/channels/"+chID+"/board", "")
	assert.Equal(t, http.StatusOK, status, "snapshot uses an independent bucket")
}

func TestSnapshotRateLimitRoute(t *testing.T) {
	h := newHarness()
	app := testApp(h, true)
	for i := 0; i < SnapshotBurst; i++ {
		status, _ := do(t, app, "GET", "/channels/"+chID+"/board", "")
		require.Equal(t, http.StatusOK, status)
	}
	status, body, headers := doWithHeaders(t, app, "GET", "/channels/44444444-4444-4444-8444-444444444444/board", "")
	assert.Equal(t, http.StatusTooManyRequests, status, "switching boards does not bypass the bucket")
	assert.Equal(t, map[string]any{"error": "too many board snapshots"}, body)
	assert.Equal(t, "2", headers.Get("Retry-After"))
	assert.Equal(t, SnapshotBurst, h.repo.snapshots, "rejected GET does not load a snapshot")
	id := h.uuid()
	req := string(raw(CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}))
	status, _ = do(t, app, "POST", "/channels/"+chID+"/board/ops", req)
	assert.Equal(t, http.StatusOK, status, "commands use independent buckets")
}

func TestNewLimitersRequireAuthentication(t *testing.T) {
	for _, l := range []*userLimiter{newCommandByteLimiter(), newSnapshotLimiter()} {
		app := fiber.New()
		app.Get("/", l.middleware, func(c *fiber.Ctx) error { return c.SendStatus(204) })
		resp, err := app.Test(httptest.NewRequest("GET", "/", nil))
		require.NoError(t, err)
		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		resp.Body.Close()
	}
}

func TestHandlerOversizedCommand(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	change := createChange(id, rectBody(id))
	// Construct valid JSON with a raw body exactly one byte above the cap.
	padding := MaxCommandBytes + 1 - len(change.Body)
	body := string(change.Body)
	body = body[:1] + strings.Repeat(" ", padding) + body[1:]
	req := `{"opId":"` + h.uuid() + `","changes":[{"id":"` + id + `","action":"create","expectedVersion":0,"body":` + body + `}]}`
	status, response := do(t, testApp(h, true), "POST", "/channels/"+chID+"/board/ops", req)
	assert.Equal(t, http.StatusRequestEntityTooLarge, status)
	assert.Equal(t, map[string]any{"error": "command bodies and patches exceed 1048576 bytes"}, response)
	assert.Zero(t, h.repo.commitCalls)
}
