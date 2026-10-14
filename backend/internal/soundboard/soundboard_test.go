package soundboard

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type mockRepository struct{ mock.Mock }

func (m *mockRepository) List(ctx context.Context, guild string) ([]Sound, error) {
	a := m.Called(ctx, guild)
	return a.Get(0).([]Sound), a.Error(1)
}
func (m *mockRepository) Create(ctx context.Context, guild, user string, req CreateRequest) (*Sound, error) {
	a := m.Called(ctx, guild, user, req)
	return a.Get(0).(*Sound), a.Error(1)
}
func (m *mockRepository) Get(ctx context.Context, guild, id string) (*Sound, error) {
	a := m.Called(ctx, guild, id)
	return a.Get(0).(*Sound), a.Error(1)
}
func (m *mockRepository) Audio(ctx context.Context, guild, id string) ([]byte, error) {
	a := m.Called(ctx, guild, id)
	return a.Get(0).([]byte), a.Error(1)
}
func (m *mockRepository) Delete(ctx context.Context, guild, id string) error {
	return m.Called(ctx, guild, id).Error(0)
}

type mockMembers struct{ mock.Mock }

func (m *mockMembers) GetMemberRole(ctx context.Context, guild, user string) (string, error) {
	a := m.Called(ctx, guild, user)
	return a.String(0), a.Error(1)
}

type mockPublisher struct{ mock.Mock }

func (m *mockPublisher) PublishToGuild(guild, op string, data interface{}) { m.Called(guild, op, data) }
// maxSamples is the longest clip MaxAudioBytes allows (PCM16 mono, 44-byte header).
const maxSamples = (MaxAudioBytes - 44) / 2

func wav(samples int) []byte {
	b := make([]byte, 44+samples*2)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 24000)
	binary.LittleEndian.PutUint32(b[28:], 48000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(samples*2))
	return b
}
func TestValidAudio(t *testing.T) {
	require.True(t, validAudio(wav(maxSamples)))
	require.True(t, validAudio(wav(1)))
	for _, b := range [][]byte{nil, {}, wav(0), wav(maxSamples + 1), []byte("not audio")} {
		require.False(t, validAudio(b))
	}
	for _, offset := range []int{0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40} {
		b := wav(100)
		b[offset] ^= 0xff
		require.False(t, validAudio(b), "offset %d", offset)
	}
}
func TestOrdinaryMemberCanUpload(t *testing.T) {
	repo := new(mockRepository)
	members := new(mockMembers)
	pub := new(mockPublisher)
	members.On("GetMemberRole", mock.Anything, "guild", "member").Return("member", nil)
	req := CreateRequest{Name: " Quack ", Audio: wav(24000)}
	repo.On("Create", mock.Anything, "guild", "member", mock.MatchedBy(func(r CreateRequest) bool { return r.Name == "Quack" && validAudio(r.Audio) })).Return(&Sound{ID: "sound", GuildID: "guild", Name: "Quack"}, nil).Once()
	pub.On("PublishToGuild", "guild", "SOUNDBOARD_UPDATE", map[string]string{"guildId": "guild"}).Once()
	s := NewService(repo, members, pub)
	result, err := s.Create(context.Background(), "member", "guild", req)
	require.NoError(t, err)
	require.True(t, result.CanDelete)
	repo.AssertExpectations(t)
	pub.AssertExpectations(t)
}
func TestNonmembersCannotAccessSounds(t *testing.T) {
	repo := new(mockRepository)
	members := new(mockMembers)
	members.On("GetMemberRole", mock.Anything, "guild", "outsider").Return("", fiber.NewError(403, "not a member"))
	s := NewService(repo, members, nil)
	ctx := context.Background()
	_, err := s.List(ctx, "outsider", "guild")
	require.Equal(t, 403, err.(*fiber.Error).Code)
	_, err = s.Create(ctx, "outsider", "guild", CreateRequest{Name: "Quack", Audio: wav(1)})
	require.Equal(t, 403, err.(*fiber.Error).Code)
	_, err = s.Audio(ctx, "outsider", "guild", "sound")
	require.Equal(t, 403, err.(*fiber.Error).Code)
	err = s.Delete(ctx, "outsider", "guild", "sound")
	require.Equal(t, 403, err.(*fiber.Error).Code)
	require.Empty(t, repo.Calls)
}
func TestValidationBeforeRepository(t *testing.T) {
	repo := new(mockRepository)
	members := new(mockMembers)
	members.On("GetMemberRole", mock.Anything, "guild", "member").Return("member", nil)
	s := NewService(repo, members, nil)
	for _, req := range []CreateRequest{{Name: " ", Audio: wav(1)}, {Name: "bad\nname", Audio: wav(1)}, {Name: string(bytes.Repeat([]byte("x"), 33)), Audio: wav(1)}, {Name: "fine", Audio: wav(maxSamples + 1)}} {
		_, err := s.Create(context.Background(), "member", "guild", req)
		require.Error(t, err)
		require.Equal(t, 400, err.(*fiber.Error).Code)
	}
	require.Empty(t, repo.Calls)
}
func TestDeletePermissions(t *testing.T) {
	creator := "uploader"
	for _, tc := range []struct {
		user, role string
		allowed    bool
	}{{"uploader", "member", true}, {"someone", "member", false}, {"someone", "moderator", true}, {"someone", "admin", true}, {"someone", "owner", true}} {
		t.Run(tc.user+tc.role, func(t *testing.T) {
			repo := new(mockRepository)
			members := new(mockMembers)
			members.On("GetMemberRole", mock.Anything, "guild", tc.user).Return(tc.role, nil)
			repo.On("Get", mock.Anything, "guild", "sound").Return(&Sound{CreatorID: &creator}, nil)
			if tc.allowed {
				repo.On("Delete", mock.Anything, "guild", "sound").Return(nil).Once()
			}
			err := NewService(repo, members, nil).Delete(context.Background(), tc.user, "guild", "sound")
			if tc.allowed {
				require.NoError(t, err)
			} else {
				require.Equal(t, 403, err.(*fiber.Error).Code)
			}
			repo.AssertExpectations(t)
		})
	}
}
func TestGuildQuotaErrorPropagates(t *testing.T) {
	repo := new(mockRepository)
	members := new(mockMembers)
	members.On("GetMemberRole", mock.Anything, "guild", "member").Return("member", nil)
	repo.On("Create", mock.Anything, "guild", "member", mock.Anything).Return((*Sound)(nil), fiber.NewError(409, "full"))
	_, err := NewService(repo, members, nil).Create(context.Background(), "member", "guild", CreateRequest{Name: "Quack", Audio: wav(1)})
	require.Equal(t, 409, err.(*fiber.Error).Code)
}
func TestRoutesValidateIDsAndBodySize(t *testing.T) {
	repo := new(mockRepository)
	members := new(mockMembers)
	app := fiber.New()
	auth := func(c *fiber.Ctx) error { c.Locals("userID", "member"); return c.Next() }
	RegisterRoutes(app, NewHandler(NewService(repo, members, nil)), auth, func(c *fiber.Ctx) error { return c.Next() })
	for _, path := range []string{"/guilds/invalid/sounds", "/guilds/00000000-0000-0000-0000-000000000001/sounds/invalid"} {
		response, err := app.Test(httptest.NewRequest("GET", path, nil))
		require.NoError(t, err)
		require.Equal(t, 400, response.StatusCode)
		response.Body.Close()
	}
	body, _ := json.Marshal(CreateRequest{Name: "test", Audio: make([]byte, MaxAudioBytes+2000)})
	req := httptest.NewRequest("POST", "/guilds/00000000-0000-0000-0000-000000000001/sounds", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response, err := app.Test(req)
	require.NoError(t, err)
	require.Equal(t, 413, response.StatusCode)
	response.Body.Close()
	require.Empty(t, repo.Calls)
}
