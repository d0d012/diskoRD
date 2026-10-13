package reaction

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// ── mocks ────────────────────────────────────────────────────────────────────

type mockRepo struct{ mock.Mock }

func (m *mockRepo) GetMessageContext(ctx context.Context, messageID string) (string, string, error) {
	args := m.Called(ctx, messageID)
	return args.String(0), args.String(1), args.Error(2)
}

func (m *mockRepo) GetDMParticipants(ctx context.Context, channelID string) (string, string, error) {
	args := m.Called(ctx, channelID)
	return args.String(0), args.String(1), args.Error(2)
}

func (m *mockRepo) Add(ctx context.Context, messageID, userID, emoji string) (bool, error) {
	args := m.Called(ctx, messageID, userID, emoji)
	return args.Bool(0), args.Error(1)
}

func (m *mockRepo) Remove(ctx context.Context, messageID, userID, emoji string) (bool, error) {
	args := m.Called(ctx, messageID, userID, emoji)
	return args.Bool(0), args.Error(1)
}

func (m *mockRepo) CountForEmoji(ctx context.Context, messageID, emoji string) (int, error) {
	args := m.Called(ctx, messageID, emoji)
	return args.Int(0), args.Error(1)
}

type mockMembership struct{ mock.Mock }

func (m *mockMembership) IsMember(ctx context.Context, guildID, userID string) (bool, error) {
	args := m.Called(ctx, guildID, userID)
	return args.Bool(0), args.Error(1)
}

type spyPublisher struct {
	addEvents    []ReactionEvent
	removeEvents []ReactionEvent
}

func (s *spyPublisher) record(op string, data interface{}) {
	ev, _ := data.(ReactionEvent)
	if op == "REACTION_ADD" {
		s.addEvents = append(s.addEvents, ev)
	} else {
		s.removeEvents = append(s.removeEvents, ev)
	}
}

func (s *spyPublisher) PublishToGuild(_ string, op string, data interface{}) { s.record(op, data) }
func (s *spyPublisher) PublishToDM(_, _ string, op string, data interface{}) {
	s.record(op, data)
}

// ── validation ───────────────────────────────────────────────────────────────

func TestValidateEmoji(t *testing.T) {
	valid := []string{
		"💪",
		"👍🏽",    // skin tone modifier
		"👨‍👩‍👧", // ZWJ family
		"1️⃣",   // keycap
		"❤️",    // VS16
		"🇹🇷",    // regional indicators
	}
	for _, emoji := range valid {
		t.Run("valid "+emoji, func(t *testing.T) {
			assert.NoError(t, validateEmoji(emoji))
		})
	}

	invalid := map[string]string{
		"empty":            "",
		"ascii text":       "abc",
		"html":             "<script>",
		"ascii with emoji": "a💪",
		"control char":     "\x01",
		"lone digit":       "1",
		"too many runes":   strings.Repeat("💪", 33),
	}
	for name, emoji := range invalid {
		t.Run("invalid "+name, func(t *testing.T) {
			assert.Error(t, validateEmoji(emoji))
		})
	}
}

// ── handler decode ───────────────────────────────────────────────────────────

func TestHandlerDecodesPercentEncodedEmoji(t *testing.T) {
	repo := new(mockRepo)
	mem := new(mockMembership)
	repo.On("GetMessageContext", mock.Anything, "m1").Return("chan", "guild", nil).Once()
	mem.On("IsMember", mock.Anything, "guild", "u1").Return(true, nil).Once()

	var captured string
	repo.On("Add", mock.Anything, "m1", "u1", mock.Anything).
		Run(func(args mock.Arguments) { captured = args.String(3) }).
		Return(true, nil).Once()
	repo.On("CountForEmoji", mock.Anything, "m1", mock.Anything).Return(1, nil).Once()

	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u1"); return c.Next() })
	app.Put("/messages/:id/reactions/:emoji", NewHandler(NewService(repo, mem)).Add)

	req := httptest.NewRequest(http.MethodPut, "/messages/m1/reactions/%F0%9F%92%AA", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "💪", captured)
}

func TestHandlerRejectsAsciiEmoji(t *testing.T) {
	repo := new(mockRepo)
	mem := new(mockMembership)

	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u1"); return c.Next() })
	app.Put("/messages/:id/reactions/:emoji", NewHandler(NewService(repo, mem)).Add)

	req := httptest.NewRequest(http.MethodPut, "/messages/m1/reactions/abc", nil)
	resp, err := app.Test(req)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
	repo.AssertNotCalled(t, "Add")
}

// ── event counts ─────────────────────────────────────────────────────────────

func TestAddReactionEventCarriesServerCount(t *testing.T) {
	repo := new(mockRepo)
	mem := new(mockMembership)
	repo.On("GetMessageContext", mock.Anything, "m1").Return("chan", "guild", nil).Once()
	mem.On("IsMember", mock.Anything, "guild", "u1").Return(true, nil).Once()
	repo.On("Add", mock.Anything, "m1", "u1", "👍").Return(true, nil).Once()
	repo.On("CountForEmoji", mock.Anything, "m1", "👍").Return(4, nil).Once()

	pub := &spyPublisher{}
	svc := NewService(repo, mem)
	svc.SetPublisher(pub)

	require.NoError(t, svc.AddReaction(context.Background(), "u1", "m1", "👍"))
	require.Len(t, pub.addEvents, 1)
	assert.Equal(t, 4, pub.addEvents[0].Count)
	assert.Equal(t, "👍", pub.addEvents[0].Emoji)
	assert.Equal(t, "u1", pub.addEvents[0].UserID)
}

func TestRemoveReactionEventCarriesZeroWhenEmpty(t *testing.T) {
	repo := new(mockRepo)
	mem := new(mockMembership)
	repo.On("GetMessageContext", mock.Anything, "m1").Return("chan", "guild", nil).Once()
	mem.On("IsMember", mock.Anything, "guild", "u1").Return(true, nil).Once()
	repo.On("Remove", mock.Anything, "m1", "u1", "👍").Return(true, nil).Once()
	repo.On("CountForEmoji", mock.Anything, "m1", "👍").Return(0, nil).Once()

	pub := &spyPublisher{}
	svc := NewService(repo, mem)
	svc.SetPublisher(pub)

	require.NoError(t, svc.RemoveReaction(context.Background(), "u1", "m1", "👍"))
	require.Len(t, pub.removeEvents, 1)
	assert.Equal(t, 0, pub.removeEvents[0].Count)
}

func TestDMReactionUsesBothParticipants(t *testing.T) {
	repo := new(mockRepo)
	mem := new(mockMembership)
	repo.On("GetMessageContext", mock.Anything, "m1").Return("dm1", "", nil).Once()
	repo.On("GetDMParticipants", mock.Anything, "dm1").Return("u1", "u2", nil).Once()
	repo.On("Add", mock.Anything, "m1", "u1", "❤️").Return(true, nil).Once()
	repo.On("CountForEmoji", mock.Anything, "m1", "❤️").Return(1, nil).Once()

	pub := &spyPublisher{}
	svc := NewService(repo, mem)
	svc.SetPublisher(pub)

	require.NoError(t, svc.AddReaction(context.Background(), "u1", "m1", "❤️"))
	require.Len(t, pub.addEvents, 1)
	assert.Equal(t, "❤️", pub.addEvents[0].Emoji)
}
