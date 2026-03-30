package invite

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/guild"
)

type Service struct {
	repo      *Repository
	guildRepo *guild.Repository
}

func NewService(repo *Repository, guildRepo *guild.Repository) *Service {
	return &Service{repo: repo, guildRepo: guildRepo}
}

func (s *Service) CreateInvite(ctx context.Context, guildID, creatorID string, req CreateInviteRequest) (*Invite, error) {
	// Must be a member to create an invite
	isMember, err := s.guildRepo.IsMember(ctx, guildID, creatorID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, fiber.NewError(fiber.StatusForbidden, "you are not a member of this guild")
	}

	return s.repo.CreateInvite(ctx, guildID, creatorID, req.MaxUses, req.ExpiresAt)
}

func (s *Service) JoinGuild(ctx context.Context, code, userID string) (*guild.Guild, error) {
	inv, err := s.repo.GetInvite(ctx, code)
	if err != nil {
		return nil, err
	}

	// Check expiry
	if inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
		return nil, fiber.NewError(fiber.StatusGone, "invite has expired")
	}

	// Check max uses
	if inv.MaxUses != nil && inv.UseCount >= *inv.MaxUses {
		return nil, fiber.NewError(fiber.StatusGone, "invite has reached maximum uses")
	}

	// Check already a member
	isMember, err := s.guildRepo.IsMember(ctx, inv.GuildID, userID)
	if err != nil {
		return nil, err
	}
	if isMember {
		return nil, fiber.NewError(fiber.StatusConflict, "already a member of this guild")
	}

	// Add member
	if err := s.guildRepo.AddMember(ctx, inv.GuildID, userID, "member"); err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return nil, fiber.NewError(fiber.StatusConflict, "already a member of this guild")
		}
		log.Error().Err(err).Str("guildID", inv.GuildID).Str("userID", userID).Msg("failed to add member")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to join guild")
	}

	// Increment use count (best-effort)
	if err := s.repo.IncrementUseCount(ctx, code); err != nil {
		log.Error().Err(err).Str("code", code).Msg("failed to increment invite use count")
	}

	return s.guildRepo.GetGuildByID(ctx, inv.GuildID)
}
