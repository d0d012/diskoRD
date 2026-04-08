package role

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/guild"
	"github.com/d0d012/diskord/pkg/middleware"
)

type Publisher interface {
	PublishToGuild(guildID, op string, data interface{})
}

type Service struct {
	repo      *Repository
	guildRepo *guild.Repository
	publisher Publisher
}

func NewService(repo *Repository, guildRepo *guild.Repository) *Service {
	return &Service{repo: repo, guildRepo: guildRepo}
}

func (s *Service) SetPublisher(p Publisher) {
	s.publisher = p
}

func (s *Service) publish(guildID, op string, data interface{}) {
	if s.publisher != nil {
		s.publisher.PublishToGuild(guildID, op, data)
	}
}

func (s *Service) ListByGuild(ctx context.Context, callerID, guildID string) ([]RoleResponse, error) {
	ok, err := s.guildRepo.IsMember(ctx, guildID, callerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	return s.repo.ListByGuild(ctx, guildID)
}

func (s *Service) Create(ctx context.Context, callerID, guildID string, req CreateRoleRequest) (*RoleResponse, error) {
	if err := s.requireRole(ctx, guildID, callerID, "moderator"); err != nil {
		return nil, err
	}
	color := req.Color
	if color == "" {
		color = "#99aab5"
	}
	ro, err := s.repo.Create(ctx, guildID, req.Name, color, req.Hoist)
	if err != nil {
		log.Error().Err(err).Msg("role.Service.Create")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to create role")
	}
	resp := ro.ToResponse(0)
	s.publish(guildID, OpRoleCreate, resp)
	return &resp, nil
}

func (s *Service) Update(ctx context.Context, callerID, guildID, roleID string, req UpdateRoleRequest) (*RoleResponse, error) {
	if err := s.requireRole(ctx, guildID, callerID, "moderator"); err != nil {
		return nil, err
	}
	ro, err := s.repo.Update(ctx, roleID, guildID, req)
	if err != nil {
		return nil, err
	}
	resp := ro.ToResponse(0)
	s.publish(guildID, OpRoleUpdate, resp)
	return &resp, nil
}

func (s *Service) Delete(ctx context.Context, callerID, guildID, roleID string) error {
	if err := s.requireRole(ctx, guildID, callerID, "admin"); err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, roleID, guildID); err != nil {
		return err
	}
	s.publish(guildID, OpRoleDelete, map[string]string{"guildId": guildID, "roleId": roleID})
	return nil
}

func (s *Service) Reorder(ctx context.Context, callerID, guildID string, req ReorderRequest) error {
	if err := s.requireRole(ctx, guildID, callerID, "admin"); err != nil {
		return err
	}
	if err := s.repo.Reorder(ctx, guildID, req.Roles); err != nil {
		return fmt.Errorf("role.Service.Reorder: %w", err)
	}
	// Broadcast updated list
	roles, _ := s.repo.ListByGuild(ctx, guildID)
	s.publish(guildID, OpRoleReorder, map[string]interface{}{"guildId": guildID, "roles": roles})
	return nil
}

func (s *Service) AssignToMember(ctx context.Context, callerID, guildID, userID, roleID string) (*RoleResponse, error) {
	if err := s.requireRole(ctx, guildID, callerID, "moderator"); err != nil {
		return nil, err
	}
	// Ensure role belongs to this guild
	ro, err := s.repo.GetByID(ctx, roleID, guildID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.AssignToMember(ctx, guildID, userID, roleID); err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to assign role")
	}
	resp := ro.ToResponse(0)
	s.publish(guildID, OpMemberRoleAdd, map[string]interface{}{
		"guildId": guildID,
		"userId":  userID,
		"role":    resp,
	})
	return &resp, nil
}

func (s *Service) RemoveFromMember(ctx context.Context, callerID, guildID, userID, roleID string) error {
	if err := s.requireRole(ctx, guildID, callerID, "moderator"); err != nil {
		return err
	}
	if err := s.repo.RemoveFromMember(ctx, guildID, userID, roleID); err != nil {
		return err
	}
	s.publish(guildID, OpMemberRoleRemove, map[string]interface{}{
		"guildId": guildID,
		"userId":  userID,
		"roleId":  roleID,
	})
	return nil
}

func (s *Service) GetMemberRoles(ctx context.Context, callerID, guildID, userID string) ([]RoleResponse, error) {
	ok, err := s.guildRepo.IsMember(ctx, guildID, callerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	return s.repo.GetMemberRoles(ctx, guildID, userID)
}

func (s *Service) GetRoleMembers(ctx context.Context, callerID, guildID, roleID string) ([]struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}, error) {
	ok, err := s.guildRepo.IsMember(ctx, guildID, callerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	members, err := s.repo.GetRoleMembersWithNames(ctx, roleID)
	if err != nil {
		return nil, err
	}
	result := make([]struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}, len(members))
	for i, m := range members {
		result[i].ID = m.ID
		result[i].Username = m.Username
	}
	return result, nil
}

func (s *Service) requireRole(ctx context.Context, guildID, userID, minRole string) error {
	callerRole, err := s.guildRepo.GetMemberRole(ctx, guildID, userID)
	if err != nil {
		return err
	}
	if middleware.RoleLevel(callerRole) < middleware.RoleLevel(minRole) {
		return fiber.NewError(fiber.StatusForbidden, "insufficient permissions")
	}
	return nil
}
