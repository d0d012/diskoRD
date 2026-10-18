package pixelart

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type mockRepo struct{ mock.Mock }

func (m *mockRepo) List(ctx context.Context, ownerID string) ([]Art, error) {
	args := m.Called(ctx, ownerID)
	a, _ := args.Get(0).([]Art)
	return a, args.Error(1)
}

func (m *mockRepo) Get(ctx context.Context, id string) (*Art, error) {
	args := m.Called(ctx, id)
	a, _ := args.Get(0).(*Art)
	return a, args.Error(1)
}

func (m *mockRepo) Create(ctx context.Context, ownerID, title string, doc json.RawMessage, remixOf, remixAuthorID *string) (*Art, error) {
	args := m.Called(ctx, ownerID, title, doc, remixOf, remixAuthorID)
	a, _ := args.Get(0).(*Art)
	return a, args.Error(1)
}

func (m *mockRepo) Update(ctx context.Context, ownerID, id string, title *string, doc json.RawMessage) (*Art, error) {
	args := m.Called(ctx, ownerID, id, title, doc)
	a, _ := args.Get(0).(*Art)
	return a, args.Error(1)
}

func (m *mockRepo) Delete(ctx context.Context, ownerID, id string) error {
	return m.Called(ctx, ownerID, id).Error(0)
}

func (m *mockRepo) SetShowcase(ctx context.Context, ownerID string, ids []string) error {
	return m.Called(ctx, ownerID, ids).Error(0)
}

func (m *mockRepo) SetBuddies(ctx context.Context, ownerID string, buddies []Buddy) error {
	return m.Called(ctx, ownerID, buddies).Error(0)
}

func (m *mockRepo) Profile(ctx context.Context, userID string) (*Profile, error) {
	args := m.Called(ctx, userID)
	p, _ := args.Get(0).(*Profile)
	return p, args.Error(1)
}

func (m *mockRepo) UserExists(ctx context.Context, userID string) (bool, error) {
	args := m.Called(ctx, userID)
	return args.Bool(0), args.Error(1)
}

type spyPublisher struct{ events []string }

func (s *spyPublisher) PublishToUserAudience(userID, op string, _ any) {
	s.events = append(s.events, op+":"+userID)
}

const (
	me    = "11111111-1111-1111-1111-111111111111"
	other = "22222222-2222-2222-2222-222222222222"
	artA  = "33333333-3333-3333-3333-333333333333"
	artB  = "44444444-4444-4444-4444-444444444444"
)

func newService() (*Service, *mockRepo, *spyPublisher) {
	repo := &mockRepo{}
	pub := &spyPublisher{}
	svc := NewService(repo)
	svc.SetPublisher(pub)
	return svc, repo, pub
}

func status(err error) int {
	var fe *fiber.Error
	if errors.As(err, &fe) {
		return fe.Code
	}
	return 0
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

var anyDoc = mock.AnythingOfType("json.RawMessage")
var nilStr = (*string)(nil)

func TestCreateValidatesAndTrimsTitle(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("Create", ctx, me, "Lil frog", anyDoc, nilStr, nilStr).Return(&Art{ID: artA}, nil)

	a, err := svc.Create(ctx, me, CreateRequest{Title: "  Lil frog ", Doc: docJSON(t, nil)})
	require.NoError(t, err)
	assert.Equal(t, artA, a.ID)

	_, err = svc.Create(ctx, me, CreateRequest{Title: strings.Repeat("x", 41), Doc: docJSON(t, nil)})
	assert.Equal(t, fiber.StatusBadRequest, status(err))
	_, err = svc.Create(ctx, me, CreateRequest{Doc: json.RawMessage(`{"v":1}`)})
	assert.Equal(t, fiber.StatusBadRequest, status(err))
}

func TestCreatePassesQuotaErrorThrough(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("Create", ctx, me, "", anyDoc, nilStr, nilStr).Return(nil, fiber.NewError(fiber.StatusConflict, "full"))

	_, err := svc.Create(ctx, me, CreateRequest{Doc: docJSON(t, nil)})
	assert.Equal(t, fiber.StatusConflict, status(err))
}

func TestRemixOfShowcasedPieceCreditsItsOwner(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("Get", ctx, artA).Return(&Art{ID: artA, OwnerID: other, ShowcasePosition: intPtr(0)}, nil)
	repo.On("Create", ctx, me, "", anyDoc, strPtr(artA), strPtr(other)).Return(&Art{ID: artB}, nil)

	_, err := svc.Create(ctx, me, CreateRequest{Doc: docJSON(t, nil), RemixOf: strPtr(artA)})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestRemixOfPrivatePieceIsNotFound(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("Get", ctx, artA).Return(&Art{ID: artA, OwnerID: other}, nil) // not in a showcase

	_, err := svc.Create(ctx, me, CreateRequest{Doc: docJSON(t, nil), RemixOf: strPtr(artA)})
	assert.Equal(t, fiber.StatusNotFound, status(err))
	repo.AssertNotCalled(t, "Create", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestRemixOfOwnRemixKeepsOriginalCredit(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("Get", ctx, artA).Return(&Art{ID: artA, OwnerID: me, RemixAuthor: &UserRef{ID: other}}, nil)
	repo.On("Create", ctx, me, "", anyDoc, strPtr(artA), strPtr(other)).Return(&Art{ID: artB}, nil)

	_, err := svc.Create(ctx, me, CreateRequest{Doc: docJSON(t, nil), RemixOf: strPtr(artA)})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestSetShowcaseRules(t *testing.T) {
	ctx := context.Background()
	t.Run("too many", func(t *testing.T) {
		svc, _, _ := newService()
		ids := make([]string, MaxShowcase+1)
		for i := range ids {
			ids[i] = artA
		}
		assert.Equal(t, fiber.StatusBadRequest, status(svc.SetShowcase(ctx, me, ShowcaseRequest{IDs: ids})))
	})
	t.Run("duplicates", func(t *testing.T) {
		svc, _, _ := newService()
		assert.Equal(t, fiber.StatusBadRequest, status(svc.SetShowcase(ctx, me, ShowcaseRequest{IDs: []string{artA, artA}})))
	})
	t.Run("ok publishes", func(t *testing.T) {
		svc, repo, pub := newService()
		repo.On("SetShowcase", ctx, me, []string{artB, artA}).Return(nil)
		require.NoError(t, svc.SetShowcase(ctx, me, ShowcaseRequest{IDs: []string{artB, artA}}))
		assert.Equal(t, []string{OpProfileUpdate + ":" + me}, pub.events)
	})
}

func TestSetBuddiesRules(t *testing.T) {
	ctx := context.Background()
	ok := Buddy{ArtID: artA, X: 50, Y: 20, Height: 64}
	cases := map[string][]Buddy{
		"too many":    {ok, ok, ok, ok, ok, ok},
		"bad id":      {{ArtID: "nope", Height: 32}},
		"x too large": {{ArtID: artA, X: 101, Height: 32}},
		"too tall":    {{ArtID: artA, Height: MaxBuddyHeight + 1}},
		"too small":   {{ArtID: artA, Height: MinBuddyHeight - 1}},
		"y too low":   {{ArtID: artA, Y: MaxBuddyY + 1, Height: 32}},
	}
	for name, buddies := range cases {
		t.Run(name, func(t *testing.T) {
			svc, repo, _ := newService()
			assert.Equal(t, fiber.StatusBadRequest, status(svc.SetBuddies(ctx, me, BuddiesRequest{Buddies: buddies})))
			repo.AssertNotCalled(t, "SetBuddies", mock.Anything, mock.Anything, mock.Anything)
		})
	}

	svc, repo, pub := newService()
	repo.On("SetBuddies", ctx, me, []Buddy{ok}).Return(nil)
	require.NoError(t, svc.SetBuddies(ctx, me, BuddiesRequest{Buddies: []Buddy{ok}}))
	assert.Len(t, pub.events, 1)
}

func TestProfileOfUnknownUser(t *testing.T) {
	svc, repo, _ := newService()
	ctx := context.Background()
	repo.On("UserExists", ctx, other).Return(false, nil)

	_, err := svc.Profile(ctx, other)
	assert.Equal(t, fiber.StatusNotFound, status(err))

	_, err = svc.Profile(ctx, "not-a-uuid")
	assert.Equal(t, fiber.StatusBadRequest, status(err))
}

func TestUpdateAndDeletePublish(t *testing.T) {
	svc, repo, pub := newService()
	ctx := context.Background()
	repo.On("Update", ctx, me, artA, strPtr("New"), json.RawMessage(nil)).Return(&Art{ID: artA}, nil)
	repo.On("Delete", ctx, me, artA).Return(nil)

	_, err := svc.Update(ctx, me, artA, UpdateRequest{Title: strPtr(" New ")})
	require.NoError(t, err)
	require.NoError(t, svc.Delete(ctx, me, artA))
	assert.Len(t, pub.events, 2)
}
