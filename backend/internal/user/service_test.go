package user

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// ── mocks ────────────────────────────────────────────────────────────────────

type mockRepo struct {
	mock.Mock
}

func (m *mockRepo) GetByID(ctx context.Context, id string) (*User, error) {
	args := m.Called(ctx, id)
	u, _ := args.Get(0).(*User)
	return u, args.Error(1)
}

func (m *mockRepo) FindByUsername(ctx context.Context, username string) (*User, error) {
	args := m.Called(ctx, username)
	u, _ := args.Get(0).(*User)
	return u, args.Error(1)
}

func (m *mockRepo) UpdateProfile(ctx context.Context, id string, p UpdateProfileParams) (*User, error) {
	args := m.Called(ctx, id, p)
	u, _ := args.Get(0).(*User)
	return u, args.Error(1)
}

func (m *mockRepo) SetAvatarURL(ctx context.Context, id string, url *string) (*User, error) {
	args := m.Called(ctx, id, url)
	u, _ := args.Get(0).(*User)
	return u, args.Error(1)
}

func (m *mockRepo) SetPreferredStatus(ctx context.Context, id, status string) (*User, error) {
	args := m.Called(ctx, id, status)
	u, _ := args.Get(0).(*User)
	return u, args.Error(1)
}

func (m *mockRepo) GetPreferredStatus(ctx context.Context, id string) (string, error) {
	args := m.Called(ctx, id)
	return args.String(0), args.Error(1)
}

type mockStorage struct {
	mock.Mock
}

func (m *mockStorage) SaveAvatar(userID, mimeType string, r io.Reader) (string, error) {
	args := m.Called(userID, mimeType, r)
	return args.String(0), args.Error(1)
}

func (m *mockStorage) DeleteAvatars(userID string) error {
	args := m.Called(userID)
	return args.Error(0)
}

func (m *mockStorage) DeleteAvatarsExcept(userID, keepFilename string) error {
	args := m.Called(userID, keepFilename)
	return args.Error(0)
}

type spyPublisher struct {
	updatedPublic  map[string]any
	updatedSelf    map[string]any
	presenceStatus string
	presenceSelf   map[string]any
	updateCalls    int
	presenceCalls  int
}

func (s *spyPublisher) PublishUserUpdate(_ string, public, self any) {
	s.updateCalls++
	s.updatedPublic, _ = public.(map[string]any)
	s.updatedSelf, _ = self.(map[string]any)
}

func (s *spyPublisher) PublishPresenceChange(_ string, status string, self any) {
	s.presenceCalls++
	s.presenceStatus = status
	s.presenceSelf, _ = self.(map[string]any)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func newService(repo repository, storage Storage) (*Service, *spyPublisher) {
	pub := &spyPublisher{}
	svc := NewService(repo, storage)
	svc.SetPublisher(pub)
	return svc, pub
}

// ── profile validation ───────────────────────────────────────────────────────

func TestUpdateProfileValidation(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, _ := newService(repo, storage)

	t.Run("bio over 190 runes rejected", func(t *testing.T) {
		_, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{
			Bio: strPtr(strings.Repeat("é", 191)),
		})
		require.Error(t, err)
		repo.AssertNotCalled(t, "UpdateProfile")
	})

	t.Run("bio of 190 multibyte runes accepted", func(t *testing.T) {
		u := &User{ID: "u1", Username: "bob"}
		repo.On("UpdateProfile", mock.Anything, "u1", mock.Anything).Return(u, nil).Once()
		_, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{
			Bio: strPtr(strings.Repeat("é", 190)),
		})
		require.NoError(t, err)
	})

	t.Run("display name over 64 characters rejected", func(t *testing.T) {
		_, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{
			DisplayName: strPtr(strings.Repeat("a", 65)),
		})
		require.Error(t, err)
	})

	t.Run("bad banner hex rejected", func(t *testing.T) {
		_, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{
			BannerColor: strPtr("blue"),
		})
		require.Error(t, err)
	})

	t.Run("empty banner color accepted (clears)", func(t *testing.T) {
		u := &User{ID: "u1", Username: "bob"}
		repo.On("UpdateProfile", mock.Anything, "u1", mock.Anything).Return(u, nil).Once()
		_, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{
			BannerColor: strPtr(""),
		})
		require.NoError(t, err)
	})
}

func TestUpdateProfilePublishesPublicPayloadWithoutPreferredStatus(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, pub := newService(repo, storage)

	bio := "hi"
	updated := &User{ID: "u1", Username: "bob", Bio: &bio, PreferredStatus: "dnd"}
	repo.On("UpdateProfile", mock.Anything, "u1", mock.Anything).Return(updated, nil).Once()

	resp, err := svc.UpdateProfile(context.Background(), "u1", UpdateProfileParams{Bio: strPtr("hi")})
	require.NoError(t, err)
	assert.Equal(t, "dnd", resp.PreferredStatus)

	require.Equal(t, 1, pub.updateCalls)
	assert.NotContains(t, pub.updatedPublic, "preferredStatus")
	assert.Equal(t, "u1", pub.updatedPublic["id"])
	assert.Equal(t, "dnd", pub.updatedSelf["preferredStatus"])
}

// ── avatars ──────────────────────────────────────────────────────────────────

func TestSetAvatarStoresAndPublishes(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, pub := newService(repo, storage)

	storage.On("SaveAvatar", "u1", "image/png", mock.Anything).Return("http://x/uploads/avatars/u1/abc.png", nil).Once()
	storage.On("DeleteAvatarsExcept", "u1", "abc.png").Return(nil).Once()
	updated := &User{ID: "u1", Username: "bob", AvatarURL: strPtr("http://x/uploads/avatars/u1/abc.png")}
	repo.On("SetAvatarURL", mock.Anything, "u1", mock.Anything).Return(updated, nil).Once()

	resp, err := svc.SetAvatar(context.Background(), "u1", "image/png", strings.NewReader("data"))
	require.NoError(t, err)
	assert.Equal(t, "http://x/uploads/avatars/u1/abc.png", *resp.AvatarURL)
	assert.Equal(t, 1, pub.updateCalls)
}

func TestRemoveAvatarClears(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, pub := newService(repo, storage)

	storage.On("DeleteAvatars", "u1").Return(nil).Once()
	updated := &User{ID: "u1", Username: "bob"}
	repo.On("SetAvatarURL", mock.Anything, "u1", (*string)(nil)).Return(updated, nil).Once()

	resp, err := svc.RemoveAvatar(context.Background(), "u1")
	require.NoError(t, err)
	assert.Nil(t, resp.AvatarURL)
	assert.Equal(t, 1, pub.updateCalls)
}

func TestSetAvatarStorageErrorIsWrapped(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, _ := newService(repo, storage)

	storage.On("SaveAvatar", "u1", "image/png", mock.Anything).Return("", errors.New("boom")).Once()

	_, err := svc.SetAvatar(context.Background(), "u1", "image/png", strings.NewReader("data"))
	require.Error(t, err)
}

// ── presence ─────────────────────────────────────────────────────────────────

func TestSetPreferredStatusValidation(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, _ := newService(repo, storage)

	err := svc.SetPreferredStatus(context.Background(), "u1", "away")
	require.Error(t, err)
	repo.AssertNotCalled(t, "SetPreferredStatus")
}

func TestSetPreferredStatusPublishesPresenceChange(t *testing.T) {
	repo := new(mockRepo)
	storage := new(mockStorage)
	svc, pub := newService(repo, storage)

	updated := &User{ID: "u1", Username: "bob", PreferredStatus: "invisible"}
	repo.On("SetPreferredStatus", mock.Anything, "u1", "invisible").Return(updated, nil).Once()

	require.NoError(t, svc.SetPreferredStatus(context.Background(), "u1", "invisible"))
	require.Equal(t, 1, pub.presenceCalls)
	assert.Equal(t, "invisible", pub.presenceStatus)
	assert.Equal(t, "invisible", pub.presenceSelf["preferredStatus"])
}
