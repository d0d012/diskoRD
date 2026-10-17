package decoration

import (
	"context"
	"fmt"

	"github.com/d0d012/diskord/internal/pixelart"
	"github.com/gofiber/fiber/v2"
)

// repository is the persistence subset the service needs, mockable in tests.
type repository interface {
	GetMessageContext(ctx context.Context, messageID string) (channelID, guildID string, err error)
	GetDMParticipants(ctx context.Context, channelID string) (userAID, userBID string, err error)
	Create(ctx context.Context, messageID, authorID string, req CreateRequest) (*Decoration, error)
	GetTarget(ctx context.Context, id string) (*Target, error)
	Delete(ctx context.Context, id string) error
}

type membership interface {
	IsMember(ctx context.Context, guildID, userID string) (bool, error)
	GetMemberRole(ctx context.Context, guildID, userID string) (string, error)
}

type Service struct {
	repo      repository
	guildRepo membership
	pub       EventPublisher
}

func NewService(repo repository, guildRepo membership) *Service {
	return &Service{repo: repo, guildRepo: guildRepo}
}

func (s *Service) SetPublisher(pub EventPublisher) {
	s.pub = pub
}

// audience checks the user can see the channel and returns the DM pair for DMs.
func (s *Service) audience(ctx context.Context, userID, channelID, guildID string) (dmUserA, dmUserB string, err error) {
	if guildID != "" {
		ok, err := s.guildRepo.IsMember(ctx, guildID, userID)
		if err != nil {
			return "", "", fmt.Errorf("decoration.Service: check membership: %w", err)
		}
		if !ok {
			return "", "", fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
		}
		return "", "", nil
	}
	dmUserA, dmUserB, err = s.repo.GetDMParticipants(ctx, channelID)
	if err != nil {
		return "", "", err
	}
	if userID != dmUserA && userID != dmUserB {
		return "", "", fiber.NewError(fiber.StatusForbidden, "not a participant in this DM")
	}
	return dmUserA, dmUserB, nil
}

func (s *Service) publish(guildID, dmUserA, dmUserB, op string, event interface{}) {
	if s.pub == nil {
		return
	}
	if guildID != "" {
		s.pub.PublishToGuild(guildID, op, event)
	} else {
		s.pub.PublishToDM(dmUserA, dmUserB, op, event)
	}
}

func (s *Service) Create(ctx context.Context, userID, messageID string, req CreateRequest) (*Decoration, error) {
	if req.Opacity == 0 {
		req.Opacity = DefaultOpacity
	}
	if req.X < 0 || req.X > 100 || req.Y < MinY || req.Y > MaxY || !AllowedSizes[req.Size] ||
		req.Opacity < MinOpacity || req.Opacity > MaxOpacity {
		return nil, fiber.NewError(fiber.StatusBadRequest, "invalid placement")
	}
	doc, err := pixelart.Validate(req.Doc)
	if err != nil {
		return nil, err
	}
	req.Doc = doc

	channelID, guildID, err := s.repo.GetMessageContext(ctx, messageID)
	if err != nil {
		return nil, err
	}
	dmUserA, dmUserB, err := s.audience(ctx, userID, channelID, guildID)
	if err != nil {
		return nil, err
	}

	d, err := s.repo.Create(ctx, messageID, userID, req)
	if err != nil {
		return nil, err
	}
	s.publish(guildID, dmUserA, dmUserB, "DECORATION_ADD", AddEvent{Decoration: *d, ChannelID: channelID, GuildID: guildID})
	return d, nil
}

// Delete lets the placer, the message author or a guild moderator remove a decoration.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	t, err := s.repo.GetTarget(ctx, id)
	if err != nil {
		return err
	}
	dmUserA, dmUserB, err := s.audience(ctx, userID, t.ChannelID, t.GuildID)
	if err != nil {
		return err
	}

	allowed := (t.AuthorID != nil && *t.AuthorID == userID) || (t.MessageAuthorID != nil && *t.MessageAuthorID == userID)
	if !allowed && t.GuildID != "" {
		role, err := s.guildRepo.GetMemberRole(ctx, t.GuildID, userID)
		if err != nil {
			return fmt.Errorf("decoration.Service.Delete: role: %w", err)
		}
		allowed = role == "owner" || role == "admin" || role == "moderator"
	}
	if !allowed {
		return fiber.NewError(fiber.StatusForbidden, "you can't remove this decoration")
	}

	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.publish(t.GuildID, dmUserA, dmUserB, "DECORATION_REMOVE", RemoveEvent{
		ID: id, MessageID: t.MessageID, ChannelID: t.ChannelID, GuildID: t.GuildID,
	})
	return nil
}
