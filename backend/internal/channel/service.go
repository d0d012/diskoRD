package channel

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/guild"
)

type Service struct {
	repo      *Repository
	guildRepo *guild.Repository
	pub       EventPublisher
}

func NewService(repo *Repository, guildRepo *guild.Repository) *Service {
	return &Service{repo: repo, guildRepo: guildRepo}
}

func (s *Service) SetPublisher(pub EventPublisher) {
	s.pub = pub
}

func (s *Service) requireMember(ctx context.Context, guildID, userID string) error {
	ok, err := s.guildRepo.IsMember(ctx, guildID, userID)
	if err != nil {
		return fmt.Errorf("channel.Service: check membership: %w", err)
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	return nil
}

func (s *Service) requireAdmin(ctx context.Context, guildID, userID string) error {
	role, err := s.guildRepo.GetMemberRole(ctx, guildID, userID)
	if err != nil {
		return err
	}
	if role != "owner" && role != "admin" {
		return fiber.NewError(fiber.StatusForbidden, "only admins and owners can manage channels")
	}
	return nil
}

func (s *Service) Create(ctx context.Context, userID, guildID string, req CreateChannelRequest) (*ChannelResponse, error) {
	if err := s.requireAdmin(ctx, guildID, userID); err != nil {
		return nil, err
	}

	maxPos, err := s.repo.GetMaxPosition(ctx, guildID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get max channel position")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create channel")
	}

	ch, err := s.repo.Create(ctx, guildID, req.Name, req.Type, maxPos+1)
	if err != nil {
		log.Error().Err(err).Msg("failed to create channel")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create channel")
	}

	resp := ch.ToResponse()
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "CHANNEL_CREATE", resp)
	}
	return &resp, nil
}

func (s *Service) List(ctx context.Context, userID, guildID string) ([]ChannelResponse, error) {
	if err := s.requireMember(ctx, guildID, userID); err != nil {
		return nil, err
	}

	channels, err := s.repo.ListByGuild(ctx, guildID)
	if err != nil {
		return nil, err
	}

	resp := make([]ChannelResponse, len(channels))
	for i, ch := range channels {
		resp[i] = ch.ToResponse()
	}
	return resp, nil
}

func (s *Service) Update(ctx context.Context, userID, channelID string, req UpdateChannelRequest) (*ChannelResponse, error) {
	ch, err := s.repo.GetByID(ctx, channelID)
	if err != nil {
		return nil, err
	}

	if err := s.requireAdmin(ctx, ch.GuildID, userID); err != nil {
		return nil, err
	}

	updated, err := s.repo.Update(ctx, channelID, req.Name, req.Position)
	if err != nil {
		return nil, err
	}

	resp := updated.ToResponse()
	if s.pub != nil {
		s.pub.PublishToGuild(ch.GuildID, "CHANNEL_UPDATE", resp)
	}
	return &resp, nil
}

func (s *Service) Delete(ctx context.Context, userID, channelID string) error {
	ch, err := s.repo.GetByID(ctx, channelID)
	if err != nil {
		return err
	}

	if err := s.requireAdmin(ctx, ch.GuildID, userID); err != nil {
		return err
	}

	if ch.Type == "text" {
		count, err := s.repo.CountTextChannelsByGuild(ctx, ch.GuildID)
		if err != nil {
			return err
		}
		if count <= 1 {
			return fiber.NewError(fiber.StatusBadRequest, "cannot delete the last text channel in a guild")
		}
	}

	if err := s.repo.Delete(ctx, channelID); err != nil {
		return err
	}

	if s.pub != nil {
		s.pub.PublishToGuild(ch.GuildID, "CHANNEL_DELETE", map[string]string{
			"id":      channelID,
			"guildId": ch.GuildID,
		})
	}
	return nil
}
