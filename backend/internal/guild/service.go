package guild

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/presence"
)

type Service struct {
	repo        *Repository
	presenceSvc *presence.Service
}

func NewService(repo *Repository, presenceSvc *presence.Service) *Service {
	return &Service{repo: repo, presenceSvc: presenceSvc}
}

func (s *Service) Create(ctx context.Context, userID string, req CreateGuildRequest) (*GuildResponse, error) {
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("guild.Service.Create: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	g, err := s.repo.CreateGuildTx(ctx, tx, req.Name, userID)
	if err != nil {
		log.Error().Err(err).Msg("failed to create guild")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create guild")
	}

	if err := s.repo.AddMemberTx(ctx, tx, g.ID, userID, "owner"); err != nil {
		log.Error().Err(err).Msg("failed to add owner as member")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create guild")
	}

	ch, err := s.repo.CreateChannelTx(ctx, tx, g.ID, "general", "text", 0)
	if err != nil {
		log.Error().Err(err).Msg("failed to create default channel")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create guild")
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("guild.Service.Create: commit: %w", err)
	}

	resp := g.ToResponse([]Channel{*ch})
	return &resp, nil
}

func (s *Service) Get(ctx context.Context, userID, guildID string) (*GuildResponse, error) {
	// Check existence first so non-existent guild returns 404, not 403
	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return nil, err
	}

	isMember, err := s.repo.IsMember(ctx, guildID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}

	channels, err := s.repo.GetChannelsByGuild(ctx, guildID)
	if err != nil {
		return nil, err
	}

	resp := g.ToResponse(channels)
	return &resp, nil
}

func (s *Service) Delete(ctx context.Context, userID, guildID string) error {
	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return err
	}

	if g.OwnerID != userID {
		return fiber.NewError(fiber.StatusForbidden, "only the guild owner can delete this guild")
	}

	return s.repo.DeleteGuild(ctx, guildID)
}

func (s *Service) ListMembers(ctx context.Context, callerID, guildID string) ([]MemberResponse, error) {
	ok, err := s.repo.IsMember(ctx, guildID, callerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}

	members, err := s.repo.ListMembers(ctx, guildID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.ID
	}
	statuses := s.presenceSvc.GetStatuses(ctx, ids)
	for i := range members {
		members[i].Status = statuses[members[i].ID]
	}
	return members, nil
}

func (s *Service) KickMember(ctx context.Context, callerID, guildID, targetID string) error {
	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return err
	}

	if g.OwnerID != callerID {
		return fiber.NewError(fiber.StatusForbidden, "only the guild owner can kick members")
	}

	if targetID == g.OwnerID {
		return fiber.NewError(fiber.StatusBadRequest, "cannot kick the guild owner")
	}

	return s.repo.RemoveMember(ctx, guildID, targetID)
}

func (s *Service) ListByUser(ctx context.Context, userID string) ([]GuildListItem, error) {
	guilds, err := s.repo.ListGuildsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	items := make([]GuildListItem, len(guilds))
	for i, g := range guilds {
		items[i] = g.ToListItem()
	}
	return items, nil
}
