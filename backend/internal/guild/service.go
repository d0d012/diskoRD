package guild

import (
	"context"
	"fmt"
	"io"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/presence"
	"github.com/d0d012/diskord/pkg/middleware"
)

// IconStorage is the file-storage subset used for guild icons.
type IconStorage interface {
	SaveGuildIcon(guildID, mimeType string, r io.Reader) (string, error)
	DeleteGuildIcons(guildID string) error
}

type Service struct {
	repo        *Repository
	presenceSvc *presence.Service
	pub         EventPublisher
	icons       IconStorage
}

func NewService(repo *Repository, presenceSvc *presence.Service) *Service {
	return &Service{repo: repo, presenceSvc: presenceSvc}
}

func (s *Service) SetPublisher(pub EventPublisher) {
	s.pub = pub
}

func (s *Service) SetIconStorage(icons IconStorage) {
	s.icons = icons
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

func (s *Service) Update(ctx context.Context, userID, guildID string, req UpdateGuildRequest) (*GuildListItem, error) {
	if req.Name == nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "at least one field must be provided")
	}

	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return nil, err
	}
	if g.OwnerID != userID {
		return nil, fiber.NewError(fiber.StatusForbidden, "only the guild owner can update this guild")
	}

	updated, err := s.repo.UpdateGuild(ctx, guildID, req)
	if err != nil {
		return nil, err
	}
	resp := updated.ToListItem()
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "GUILD_UPDATE", resp)
	}
	return &resp, nil
}

// SetIcon stores an uploaded icon for the guild. Owner only.
func (s *Service) SetIcon(ctx context.Context, userID, guildID, mimeType string, r io.Reader) (*GuildListItem, error) {
	if err := s.requireOwner(ctx, userID, guildID); err != nil {
		return nil, err
	}
	if s.icons == nil {
		return nil, fiber.NewError(fiber.StatusNotImplemented, "storage not configured")
	}
	url, err := s.icons.SaveGuildIcon(guildID, mimeType, r)
	if err != nil {
		return nil, fmt.Errorf("guild.Service.SetIcon: %w", err)
	}
	return s.setIconURL(ctx, guildID, &url)
}

// RemoveIcon clears the guild icon and deletes its files. Owner only.
func (s *Service) RemoveIcon(ctx context.Context, userID, guildID string) (*GuildListItem, error) {
	if err := s.requireOwner(ctx, userID, guildID); err != nil {
		return nil, err
	}
	if s.icons != nil {
		if err := s.icons.DeleteGuildIcons(guildID); err != nil {
			return nil, fmt.Errorf("guild.Service.RemoveIcon: %w", err)
		}
	}
	return s.setIconURL(ctx, guildID, nil)
}

func (s *Service) setIconURL(ctx context.Context, guildID string, url *string) (*GuildListItem, error) {
	updated, err := s.repo.SetIconURL(ctx, guildID, url)
	if err != nil {
		return nil, err
	}
	resp := updated.ToListItem()
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "GUILD_UPDATE", resp)
	}
	return &resp, nil
}

func (s *Service) requireOwner(ctx context.Context, userID, guildID string) error {
	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return err
	}
	if g.OwnerID != userID {
		return fiber.NewError(fiber.StatusForbidden, "only the guild owner can update this guild")
	}
	return nil
}

func (s *Service) Delete(ctx context.Context, userID, guildID string) error {
	g, err := s.repo.GetGuildByID(ctx, guildID)
	if err != nil {
		return err
	}

	if g.OwnerID != userID {
		return fiber.NewError(fiber.StatusForbidden, "only the guild owner can delete this guild")
	}

	if err := s.repo.DeleteGuild(ctx, guildID); err != nil {
		return err
	}
	if s.icons != nil {
		if err := s.icons.DeleteGuildIcons(guildID); err != nil {
			log.Warn().Err(err).Str("guildID", guildID).Msg("guild.Service.Delete: remove icon files")
		}
	}
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "GUILD_DELETE", map[string]string{"guildId": guildID})
	}
	return nil
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

	if err := s.repo.RemoveMember(ctx, guildID, targetID); err != nil {
		return err
	}
	if s.pub != nil {
		payload := map[string]string{
			"guildId": guildID,
			"userId":  targetID,
		}
		s.pub.PublishToGuild(guildID, "GUILD_MEMBER_REMOVE", payload)
		// Ensure the kicked user's current connection updates even if it is removed
		// from guild routing before the guild broadcast is processed.
		s.pub.NotifyUser(targetID, "GUILD_MEMBER_REMOVE", payload)
		s.pub.RemoveClientGuild(targetID, guildID)
	}
	return nil
}

func (s *Service) UpdateMemberRole(ctx context.Context, guildID, callerID, targetID, newRole string) error {
	callerRole, err := s.repo.GetMemberRole(ctx, guildID, callerID)
	if err != nil {
		return err
	}
	targetRole, err := s.repo.GetMemberRole(ctx, guildID, targetID)
	if err != nil {
		return err
	}

	callerLevel := middleware.RoleLevel(callerRole)
	targetLevel := middleware.RoleLevel(targetRole)
	newLevel := middleware.RoleLevel(newRole)

	// Owner cannot be demoted by anyone else
	if targetRole == "owner" && callerID != targetID {
		return fiber.NewError(fiber.StatusForbidden, "cannot change the owner's role")
	}
	// Cannot assign owner role
	if newRole == "owner" {
		return fiber.NewError(fiber.StatusForbidden, "cannot assign owner role")
	}
	// Caller must outrank both the target and the new role
	if callerLevel <= targetLevel {
		return fiber.NewError(fiber.StatusForbidden, "insufficient permissions to change this member's role")
	}
	if callerLevel <= newLevel {
		return fiber.NewError(fiber.StatusForbidden, "cannot assign a role equal to or higher than your own")
	}

	if err := s.repo.UpdateMemberRole(ctx, guildID, targetID, newRole); err != nil {
		return err
	}
	if s.pub != nil {
		s.pub.PublishToGuild(guildID, "GUILD_MEMBER_UPDATE", map[string]string{
			"guildId": guildID,
			"userId":  targetID,
			"role":    newRole,
		})
	}
	return nil
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
