package decoration

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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

func (m *mockRepo) Create(ctx context.Context, messageID, authorID string, req CreateRequest) (*Decoration, error) {
	args := m.Called(ctx, messageID, authorID, req)
	d, _ := args.Get(0).(*Decoration)
	return d, args.Error(1)
}

func (m *mockRepo) GetTarget(ctx context.Context, id string) (*Target, error) {
	args := m.Called(ctx, id)
	t, _ := args.Get(0).(*Target)
	return t, args.Error(1)
}

func (m *mockRepo) Delete(ctx context.Context, id string) error {
	return m.Called(ctx, id).Error(0)
}

type mockMembership struct{ mock.Mock }

func (m *mockMembership) IsMember(ctx context.Context, guildID, userID string) (bool, error) {
	args := m.Called(ctx, guildID, userID)
	return args.Bool(0), args.Error(1)
}

func (m *mockMembership) GetMemberRole(ctx context.Context, guildID, userID string) (string, error) {
	args := m.Called(ctx, guildID, userID)
	return args.String(0), args.Error(1)
}

type published struct {
	scope string // "guild" or "dm"
	op    string
	data  interface{}
}

type spyPublisher struct{ events []published }

func (s *spyPublisher) PublishToGuild(_ string, op string, data interface{}) {
	s.events = append(s.events, published{"guild", op, data})
}

func (s *spyPublisher) PublishToDM(_, _ string, op string, data interface{}) {
	s.events = append(s.events, published{"dm", op, data})
}

func newService() (*Service, *mockRepo, *mockMembership, *spyPublisher) {
	repo := &mockRepo{}
	members := &mockMembership{}
	pub := &spyPublisher{}
	svc := NewService(repo, members)
	svc.SetPublisher(pub)
	return svc, repo, members, pub
}

func validDoc() json.RawMessage {
	pixels := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("\x01", 16*16)))
	return json.RawMessage(`{"v":1,"width":16,"height":16,"palette":["#ff0000"],"frames":["` + pixels + `"]}`)
}

func status(err error) int {
	var fe *fiber.Error
	if errors.As(err, &fe) {
		return fe.Code
	}
	return 0
}

func ptr(s string) *string { return &s }

// ── Create ───────────────────────────────────────────────────────────────────

func TestCreateInGuildPublishesToGuild(t *testing.T) {
	svc, repo, members, pub := newService()
	ctx := context.Background()
	repo.On("GetMessageContext", ctx, "m1").Return("c1", "g1", nil)
	members.On("IsMember", ctx, "g1", "u1").Return(true, nil)
	repo.On("Create", ctx, "m1", "u1", mock.Anything).Return(&Decoration{ID: "d1", MessageID: "m1"}, nil)

	d, err := svc.Create(ctx, "u1", "m1", CreateRequest{Doc: validDoc(), X: 50, Y: 10, Size: 64})

	require.NoError(t, err)
	assert.Equal(t, "d1", d.ID)
	require.Len(t, pub.events, 1)
	assert.Equal(t, "guild", pub.events[0].scope)
	assert.Equal(t, "DECORATION_ADD", pub.events[0].op)
	ev := pub.events[0].data.(AddEvent)
	assert.Equal(t, "c1", ev.ChannelID)
	assert.Equal(t, "g1", ev.GuildID)
}

func TestCreateInDMRequiresParticipant(t *testing.T) {
	svc, repo, _, pub := newService()
	ctx := context.Background()
	repo.On("GetMessageContext", ctx, "m1").Return("dm1", "", nil)
	repo.On("GetDMParticipants", ctx, "dm1").Return("a", "b", nil)

	_, err := svc.Create(ctx, "stranger", "m1", CreateRequest{Doc: validDoc(), X: 0, Y: 0, Size: 32})

	assert.Equal(t, fiber.StatusForbidden, status(err))
	assert.Empty(t, pub.events)
	repo.AssertNotCalled(t, "Create", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestCreateRejectsNonMember(t *testing.T) {
	svc, repo, members, _ := newService()
	ctx := context.Background()
	repo.On("GetMessageContext", ctx, "m1").Return("c1", "g1", nil)
	members.On("IsMember", ctx, "g1", "u1").Return(false, nil)

	_, err := svc.Create(ctx, "u1", "m1", CreateRequest{Doc: validDoc(), X: 0, Y: 0, Size: 32})
	assert.Equal(t, fiber.StatusForbidden, status(err))
}

func TestCreateValidatesBeforeTouchingTheDatabase(t *testing.T) {
	cases := map[string]CreateRequest{
		"x too large": {Doc: validDoc(), X: 101, Y: 0, Size: 32},
		"y too high":  {Doc: validDoc(), X: 0, Y: MinY - 1, Size: 32},
		"y too low":   {Doc: validDoc(), X: 0, Y: MaxY + 1, Size: 32},
		"bad size":    {Doc: validDoc(), X: 0, Y: 0, Size: 40},
		"invalid doc": {Doc: json.RawMessage(`{"v":1}`), X: 0, Y: 0, Size: 32},
		"missing doc": {X: 0, Y: 0, Size: 32},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			svc, repo, _, _ := newService()
			_, err := svc.Create(context.Background(), "u1", "m1", req)
			assert.Equal(t, fiber.StatusBadRequest, status(err))
			repo.AssertNotCalled(t, "GetMessageContext", mock.Anything, mock.Anything)
		})
	}
}

func TestCreatePassesThroughTheLimitError(t *testing.T) {
	svc, repo, members, pub := newService()
	ctx := context.Background()
	repo.On("GetMessageContext", ctx, "m1").Return("c1", "g1", nil)
	members.On("IsMember", ctx, "g1", "u1").Return(true, nil)
	repo.On("Create", ctx, "m1", "u1", mock.Anything).Return(nil, fiber.NewError(fiber.StatusConflict, "full"))

	_, err := svc.Create(ctx, "u1", "m1", CreateRequest{Doc: validDoc(), X: 0, Y: 0, Size: 32})

	assert.Equal(t, fiber.StatusConflict, status(err))
	assert.Empty(t, pub.events)
}

// ── Delete ───────────────────────────────────────────────────────────────────

func TestDeletePermissions(t *testing.T) {
	cases := []struct {
		name    string
		user    string
		role    string
		allowed bool
	}{
		{"placer", "placer", "member", true},
		{"message author", "msgAuthor", "member", true},
		{"moderator", "someone", "moderator", true},
		{"admin", "someone", "admin", true},
		{"owner", "someone", "owner", true},
		{"other member", "someone", "member", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, repo, members, pub := newService()
			ctx := context.Background()
			repo.On("GetTarget", ctx, "d1").Return(&Target{
				MessageID: "m1", ChannelID: "c1", GuildID: "g1",
				AuthorID: ptr("placer"), MessageAuthorID: ptr("msgAuthor"),
			}, nil)
			members.On("IsMember", ctx, "g1", tc.user).Return(true, nil)
			members.On("GetMemberRole", ctx, "g1", tc.user).Return(tc.role, nil)
			repo.On("Delete", ctx, "d1").Return(nil)

			err := svc.Delete(ctx, tc.user, "d1")

			if tc.allowed {
				require.NoError(t, err)
				require.Len(t, pub.events, 1)
				assert.Equal(t, "DECORATION_REMOVE", pub.events[0].op)
				assert.Equal(t, RemoveEvent{ID: "d1", MessageID: "m1", ChannelID: "c1", GuildID: "g1"}, pub.events[0].data)
			} else {
				assert.Equal(t, fiber.StatusForbidden, status(err))
				repo.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
				assert.Empty(t, pub.events)
			}
		})
	}
}

func TestDeleteInDMOnlyPlacerOrAuthor(t *testing.T) {
	svc, repo, _, pub := newService()
	ctx := context.Background()
	repo.On("GetTarget", ctx, "d1").Return(&Target{
		MessageID: "m1", ChannelID: "dm1", AuthorID: ptr("a"), MessageAuthorID: ptr("a"),
	}, nil)
	repo.On("GetDMParticipants", ctx, "dm1").Return("a", "b", nil)

	err := svc.Delete(ctx, "b", "d1")
	assert.Equal(t, fiber.StatusForbidden, status(err))

	repo.On("Delete", ctx, "d1").Return(nil)
	require.NoError(t, svc.Delete(ctx, "a", "d1"))
	require.Len(t, pub.events, 1)
	assert.Equal(t, "dm", pub.events[0].scope)
}

func TestDeleteAfterPlacerAccountRemoved(t *testing.T) {
	svc, repo, members, _ := newService()
	ctx := context.Background()
	// author_id is NULL after the placer deleted their account.
	repo.On("GetTarget", ctx, "d1").Return(&Target{MessageID: "m1", ChannelID: "c1", GuildID: "g1", MessageAuthorID: ptr("x")}, nil)
	members.On("IsMember", ctx, "g1", "u1").Return(true, nil)
	members.On("GetMemberRole", ctx, "g1", "u1").Return("member", nil)

	assert.Equal(t, fiber.StatusForbidden, status(svc.Delete(ctx, "u1", "d1")))
}
