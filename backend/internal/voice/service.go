package voice

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/redis/go-redis/v9"

	"github.com/d0d012/diskord/internal/channel"
	"github.com/d0d012/diskord/internal/guild"
	"github.com/d0d012/diskord/pkg/config"
)

// EventPublisher is satisfied by the gateway hub.
type EventPublisher interface {
	PublishToGuild(guildID, op string, data interface{})
}

type Service struct {
	db          *pgxpool.Pool
	channelRepo *channel.Repository
	guildRepo   *guild.Repository
	rdb         *redis.Client
	cfg         config.LiveKitConfig
	pub         EventPublisher
}

func NewService(
	db *pgxpool.Pool,
	channelRepo *channel.Repository,
	guildRepo *guild.Repository,
	rdb *redis.Client,
	cfg config.LiveKitConfig,
) *Service {
	return &Service{
		db:          db,
		channelRepo: channelRepo,
		guildRepo:   guildRepo,
		rdb:         rdb,
		cfg:         cfg,
	}
}

func (s *Service) SetPublisher(pub EventPublisher) {
	s.pub = pub
}

func voiceStateKey(channelID string) string {
	return fmt.Sprintf("voice_state:%s", channelID)
}

func (s *Service) generateToken(userID, username, roomName string) (string, error) {
	at := lkauth.NewAccessToken(s.cfg.APIKey, s.cfg.APISecret)
	grant := &lkauth.VideoGrant{
		RoomJoin:     true,
		Room:         roomName,
		CanPublish:   boolPtr(true),
		CanSubscribe: boolPtr(true),
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID).
		SetName(username).
		SetValidFor(4 * time.Hour)
	return at.ToJWT()
}

func boolPtr(b bool) *bool { return &b }

func roomName(guildID, channelID string) string {
	return fmt.Sprintf("guild:%s:channel:%s", guildID, channelID)
}

func (s *Service) liveKitURL() string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	return fmt.Sprintf("ws://%s:%d", s.cfg.Host, s.cfg.Port)
}

// viewerToken is a hidden, subscribe-only token. The ":viewer" identity keeps it from
// replacing the user's real connection, which stays in the main window.
func viewerToken(cfg config.LiveKitConfig, userID, username, room string) (string, error) {
	at := lkauth.NewAccessToken(cfg.APIKey, cfg.APISecret)
	at.SetVideoGrant(&lkauth.VideoGrant{
		RoomJoin:       true,
		Room:           room,
		CanPublish:     boolPtr(false),
		CanPublishData: boolPtr(false),
		CanSubscribe:   boolPtr(true),
		Hidden:         true,
	}).
		SetIdentity(userID + ":viewer").
		SetName(username).
		SetValidFor(4 * time.Hour)
	return at.ToJWT()
}

// ViewerToken lets the desktop call window watch the voice channel the user is in.
func (s *Service) ViewerToken(ctx context.Context, userID, channelID string) (*VoiceTokenResponse, error) {
	ch, err := s.channelRepo.GetByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.Type != "voice" {
		return nil, fiber.NewError(fiber.StatusBadRequest, "not a voice channel")
	}
	ok, err := s.guildRepo.IsMember(ctx, ch.GuildID, userID)
	if err != nil {
		return nil, fmt.Errorf("voice.Service.ViewerToken: %w", err)
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	// Only someone in the channel may watch it.
	inChannel, err := s.rdb.SIsMember(ctx, voiceStateKey(channelID), userID).Result()
	if err != nil {
		return nil, fmt.Errorf("voice.Service.ViewerToken: redis: %w", err)
	}
	if !inChannel {
		return nil, fiber.NewError(fiber.StatusConflict, "join the voice channel first")
	}
	var username string
	if err := s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username); err != nil {
		return nil, fmt.Errorf("voice.Service.ViewerToken: fetch username: %w", err)
	}
	token, err := viewerToken(s.cfg, userID, username, roomName(ch.GuildID, channelID))
	if err != nil {
		return nil, fmt.Errorf("voice.Service.ViewerToken: %w", err)
	}
	return &VoiceTokenResponse{Token: token, URL: s.liveKitURL()}, nil
}

func (s *Service) JoinVoice(ctx context.Context, userID, channelID string) (*VoiceTokenResponse, error) {
	ch, err := s.channelRepo.GetByID(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if ch.Type != "voice" {
		return nil, fiber.NewError(fiber.StatusBadRequest, "not a voice channel")
	}

	ok, err := s.guildRepo.IsMember(ctx, ch.GuildID, userID)
	if err != nil {
		return nil, fmt.Errorf("voice.Service.JoinVoice: %w", err)
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}

	// Fetch username from DB
	var username string
	if err := s.db.QueryRow(ctx,
		`SELECT username FROM users WHERE id = $1`, userID,
	).Scan(&username); err != nil {
		return nil, fmt.Errorf("voice.Service.JoinVoice: fetch username: %w", err)
	}

	token, err := s.generateToken(userID, username, roomName(ch.GuildID, channelID))
	if err != nil {
		return nil, fmt.Errorf("voice.Service.JoinVoice: generate token: %w", err)
	}

	// Track voice state
	if err := s.rdb.SAdd(ctx, voiceStateKey(channelID), userID).Err(); err != nil {
		return nil, fmt.Errorf("voice.Service.JoinVoice: redis sadd: %w", err)
	}

	// Broadcast to guild
	if s.pub != nil {
		s.pub.PublishToGuild(ch.GuildID, "VOICE_STATE_UPDATE", VoiceStateUpdate{
			UserID:    userID,
			Username:  username,
			ChannelID: channelID,
			GuildID:   ch.GuildID,
			Joined:    true,
		})
	}

	return &VoiceTokenResponse{Token: token, URL: s.liveKitURL()}, nil
}

func (s *Service) LeaveVoice(ctx context.Context, userID, channelID string) error {
	ch, err := s.channelRepo.GetByID(ctx, channelID)
	if err != nil {
		return err
	}

	var username string
	_ = s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username)

	s.rdb.SRem(ctx, voiceStateKey(channelID), userID)

	if s.pub != nil {
		s.pub.PublishToGuild(ch.GuildID, "VOICE_STATE_UPDATE", VoiceStateUpdate{
			UserID:    userID,
			Username:  username,
			ChannelID: channelID,
			GuildID:   ch.GuildID,
			Joined:    false,
		})
	}
	return nil
}

// GetVoiceParticipants returns all user IDs currently in the voice channel.
func (s *Service) GetVoiceParticipants(ctx context.Context, channelID string) ([]string, error) {
	members, err := s.rdb.SMembers(ctx, voiceStateKey(channelID)).Result()
	if err != nil {
		return nil, fmt.Errorf("voice.Service.GetVoiceParticipants: %w", err)
	}
	return members, nil
}
