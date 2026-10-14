package soundboard

import (
	"context"
	"encoding/binary"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

type SoundRepository interface {
	List(context.Context, string) ([]Sound, error)
	Create(context.Context, string, string, CreateRequest) (*Sound, error)
	Get(context.Context, string, string) (*Sound, error)
	Audio(context.Context, string, string) ([]byte, error)
	Delete(context.Context, string, string) error
}
type MembershipRepository interface {
	GetMemberRole(context.Context, string, string) (string, error)
}
type EventPublisher interface {
	PublishToGuild(string, string, interface{})
}
type Service struct {
	repo    SoundRepository
	members MembershipRepository
	pub     EventPublisher
}

func NewService(repo SoundRepository, members MembershipRepository, pub EventPublisher) *Service {
	return &Service{repo: repo, members: members, pub: pub}
}
func (s *Service) member(ctx context.Context, guildID, userID string) (string, error) {
	role, err := s.members.GetMemberRole(ctx, guildID, userID)
	if err != nil {
		return "", err
	}
	if role == "" {
		return "", fiber.NewError(403, "not a member of this guild")
	}
	return role, nil
}

// Accept only the canonical format our client produces. No trusting extensions, MIME,
// supplied durations, or executing a media transcoder on untrusted uploads.
func validAudio(b []byte) bool {
	if len(b) < 46 || len(b) > MaxAudioBytes || len(b)%2 != 0 {
		return false
	}
	u16 := func(i int) uint16 { return binary.LittleEndian.Uint16(b[i : i+2]) }
	u32 := func(i int) uint32 { return binary.LittleEndian.Uint32(b[i : i+4]) }
	return string(b[:4]) == "RIFF" && u32(4) == uint32(len(b)-8) && string(b[8:16]) == "WAVEfmt " &&
		u32(16) == 16 && u16(20) == 1 && u16(22) == 1 && u32(24) == 24000 &&
		u32(28) == 48000 && u16(32) == 2 && u16(34) == 16 && string(b[36:40]) == "data" && u32(40) == uint32(len(b)-44)
}
func (s *Service) List(ctx context.Context, userID, guildID string) ([]Sound, error) {
	role, err := s.member(ctx, guildID, userID)
	if err != nil {
		return nil, err
	}
	sounds, err := s.repo.List(ctx, guildID)
	if err != nil {
		return nil, err
	}
	for i := range sounds {
		sounds[i].CanDelete = canDelete(&sounds[i], userID, role)
	}
	return sounds, nil
}
func (s *Service) Create(ctx context.Context, userID, guildID string, req CreateRequest) (*Sound, error) {
	if _, err := s.member(ctx, guildID, userID); err != nil {
		return nil, err
	}
	req.Name = strings.TrimSpace(req.Name)
	if !utf8.ValidString(req.Name) || utf8.RuneCountInString(req.Name) < 1 || utf8.RuneCountInString(req.Name) > 32 || strings.ContainsFunc(req.Name, unicode.IsControl) {
		return nil, fiber.NewError(400, "sound name must be 1–32 characters")
	}
	if !validAudio(req.Audio) {
		return nil, fiber.NewError(400, "sound must be mono 24 kHz PCM16 WAV, at most 15 seconds")
	}
	sound, err := s.repo.Create(ctx, guildID, userID, req)
	if err != nil {
		return nil, err
	}
	sound.CanDelete = true
	s.changed(guildID)
	return sound, nil
}
func (s *Service) Audio(ctx context.Context, userID, guildID, id string) ([]byte, error) {
	if _, err := s.member(ctx, guildID, userID); err != nil {
		return nil, err
	}
	return s.repo.Audio(ctx, guildID, id)
}
func (s *Service) Delete(ctx context.Context, userID, guildID, id string) error {
	role, err := s.member(ctx, guildID, userID)
	if err != nil {
		return err
	}
	sound, err := s.repo.Get(ctx, guildID, id)
	if err != nil {
		return err
	}
	if !canDelete(sound, userID, role) {
		return fiber.NewError(403, "only the uploader or a moderator can remove this sound")
	}
	if err := s.repo.Delete(ctx, guildID, id); err != nil {
		return err
	}
	s.changed(guildID)
	return nil
}
func canDelete(sound *Sound, userID, role string) bool {
	return (sound.CreatorID != nil && *sound.CreatorID == userID) || role == "owner" || role == "admin" || role == "moderator"
}
func (s *Service) changed(guildID string) {
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "SOUNDBOARD_UPDATE", map[string]string{"guildId": guildID})
	}
}
