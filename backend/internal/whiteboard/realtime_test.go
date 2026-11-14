package whiteboard

import (
	"context"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBoardSubscriptionAuthorizesWithoutLoadingObjects(t *testing.T) {
	for _, tc := range []struct {
		name, kind     string
		member, exists bool
		status         int
	}{
		{"board", ChannelTypeWhiteboard, true, true, 0},
		{"text", "text", true, true, 404},
		{"voice", "voice", true, true, 404},
		{"nonmember", ChannelTypeWhiteboard, false, true, 403},
		{"missing", ChannelTypeWhiteboard, true, false, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness()
			h.repo.seq = 29
			h.repo.channels[chID].Type = tc.kind
			if !tc.exists {
				delete(h.repo.channels, chID)
			}
			svc := NewService(h.repo, fakeMembers{member: tc.member}, h.ops)
			g, seq, err := svc.BoardSubscription(context.Background(), userID, chID)
			if tc.status != 0 {
				var fe *fiber.Error
				require.ErrorAs(t, err, &fe)
				assert.Equal(t, tc.status, fe.Code)
				assert.Empty(t, g)
			} else {
				require.NoError(t, err)
				assert.Equal(t, guild, g)
				assert.EqualValues(t, 29, seq)
			}
			assert.Zero(t, h.repo.commits)
		})
	}
}

type roomRecorder struct {
	mu       sync.Mutex
	payloads []CommitPayload
	entered  chan int64
	release  chan struct{}
}

func (r *roomRecorder) PublishToRoom(_ context.Context, guildID, roomID, op string, data any) {
	if guildID != guild || roomID != chID || op != "BOARD_COMMIT" {
		panic("wrong routing")
	}
	payload := data.(CommitPayload)
	r.entered <- payload.Seq
	if payload.Seq == 1 {
		<-r.release
	}
	r.mu.Lock()
	r.payloads = append(r.payloads, payload)
	r.mu.Unlock()
}

func TestGatewayPublisherStaysInsideBoardCommitLock(t *testing.T) {
	h := newHarness()
	rooms := &roomRecorder{entered: make(chan int64, 2), release: make(chan struct{})}
	h.svc.SetPublisher(NewGatewayPublisher(rooms))
	id1, id2 := h.uuid(), h.uuid()
	req1 := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id1, rectBody(id1))}}
	req2 := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id2, rectBody(id2))}}
	done := make(chan error, 2)
	go func() { _, err := h.svc.Execute(context.Background(), userID, chID, req1); done <- err }()
	require.EqualValues(t, 1, <-rooms.entered)
	go func() { _, err := h.svc.Execute(context.Background(), userID, chID, req2); done <- err }()
	select {
	case <-rooms.entered:
		t.Fatal("second publish overtook blocked first publish")
	case <-time.After(20 * time.Millisecond):
	}
	close(rooms.release)
	require.NoError(t, <-done)
	require.NoError(t, <-done)
	require.EqualValues(t, 2, <-rooms.entered)
	require.Len(t, rooms.payloads, 2)
	assert.EqualValues(t, 1, rooms.payloads[0].Seq)
	assert.EqualValues(t, 2, rooms.payloads[1].Seq)
	assert.Equal(t, req1.OpID, rooms.payloads[0].OpID)
	// Resending returns the original HTTP result without another room event.
	_, err := h.svc.Execute(context.Background(), userID, chID, req1)
	require.NoError(t, err)
	assert.Len(t, rooms.payloads, 2)
}

func TestCommandLimiterUserScopeRefillAndExpiry(t *testing.T) {
	l := newCommandLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	for i := 0; i < CommandBurst; i++ {
		require.True(t, l.allow("u"))
	}
	assert.False(t, l.allow("u"))
	assert.True(t, l.allow("other"))
	now = now.Add(99 * time.Millisecond)
	assert.False(t, l.allow("u"))
	now = now.Add(time.Millisecond)
	assert.True(t, l.allow("u"))
	assert.False(t, l.allow("u"))
	now = now.Add(time.Second)
	for i := 0; i < 10; i++ {
		require.True(t, l.allow("u"))
	}
	assert.False(t, l.allow("u"))
	now = now.Add(time.Minute)
	assert.True(t, l.allow("fresh"))
	assert.NotContains(t, l.users, "u")
	assert.NotContains(t, l.users, "other")
}

func TestCommandLimiterConcurrentBurst(t *testing.T) {
	l := newCommandLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	var wg sync.WaitGroup
	results := make(chan bool, 100)
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- l.allow("u") }()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for ok := range results {
		if ok {
			accepted++
		}
	}
	assert.Equal(t, CommandBurst, accepted)
}

func TestOpsRateLimitRouteAndStandardEnvelope(t *testing.T) {
	app := testApp(newHarness(), true)
	// Invalid attempts also consume capacity, before body parsing or DB access.
	for i := 0; i < CommandBurst; i++ {
		status, _ := do(t, app, "POST", "/channels/"+chID+"/board/ops", `{}`)
		require.Equal(t, 400, status)
	}
	status, body := do(t, app, "POST", "/channels/44444444-4444-4444-8444-444444444444/board/ops", `{}`)
	assert.Equal(t, 429, status, "switching boards cannot bypass the user bucket")
	assert.Equal(t, map[string]any{"error": "too many board commands"}, body)
	status, _ = do(t, app, "GET", "/channels/"+chID+"/board", "")
	assert.Equal(t, 200, status, "GET recovery snapshots are not command-limited")
}

func TestOpsLimiterIndependentOfIPAndPath(t *testing.T) {
	l := newCommandLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	app := fiber.New()
	auth := func(c *fiber.Ctx) error { c.Locals("userID", c.Get("X-Test-User")); return c.Next() }
	app.Post("/channels/:id/board/ops", auth, l.middleware, func(c *fiber.Ctx) error { return c.SendStatus(204) })
	request := func(user string, i int) int {
		req := httptest.NewRequest("POST", fmt.Sprintf("/channels/%d/board/ops", i), nil)
		req.Header.Set("X-Test-User", user)
		req.RemoteAddr = fmt.Sprintf("10.0.0.%d:1234", i+1)
		resp, err := app.Test(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		return resp.StatusCode
	}
	for i := 0; i < CommandBurst; i++ {
		require.Equal(t, 204, request("a", i))
	}
	assert.Equal(t, 429, request("a", 100))
	assert.Equal(t, 204, request("b", 100), "same IP does not share another user's budget")
	now = now.Add(100 * time.Millisecond)
	assert.Equal(t, 204, request("a", 101))
}
