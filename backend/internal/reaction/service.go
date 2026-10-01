package reaction

import (
	"context"
	"fmt"

	"github.com/d0d012/diskord/internal/guild"
	"github.com/gofiber/fiber/v2"
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
		return fmt.Errorf("reaction.Service: check membership: %w", err)
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	return nil
}

func (s *Service) AddReaction(ctx context.Context, userID, messageID, emoji string) error {
	channelID, guildID, err := s.repo.GetMessageContext(ctx, messageID)
	if err != nil {
		return err
	}

	var dmUserA, dmUserB string
	if guildID != "" {
		if err := s.requireMember(ctx, guildID, userID); err != nil {
			return err
		}
	} else {
		var err error
		dmUserA, dmUserB, err = s.repo.GetDMParticipants(ctx, channelID)
		if err != nil {
			return err
		}
		if userID != dmUserA && userID != dmUserB {
			return fiber.NewError(fiber.StatusForbidden, "not a participant in this DM")
		}
	}

	inserted, err := s.repo.Add(ctx, messageID, userID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to add reaction")
	}

	if inserted && s.pub != nil {
		event := ReactionEvent{
			MessageID: messageID,
			ChannelID: channelID,
			GuildID:   guildID,
			Emoji:     emoji,
			UserID:    userID,
			Action:    "add",
		}
		if guildID != "" {
			s.pub.PublishToGuild(guildID, "REACTION_ADD", event)
		} else {
			s.pub.PublishToDM(dmUserA, dmUserB, "REACTION_ADD", event)
		}
	}

	return nil
}

func (s *Service) RemoveReaction(ctx context.Context, userID, messageID, emoji string) error {
	channelID, guildID, err := s.repo.GetMessageContext(ctx, messageID)
	if err != nil {
		return err
	}

	var dmUserA, dmUserB string
	if guildID != "" {
		if err := s.requireMember(ctx, guildID, userID); err != nil {
			return err
		}
	} else {
		var err error
		dmUserA, dmUserB, err = s.repo.GetDMParticipants(ctx, channelID)
		if err != nil {
			return err
		}
		if userID != dmUserA && userID != dmUserB {
			return fiber.NewError(fiber.StatusForbidden, "not a participant in this DM")
		}
	}

	deleted, err := s.repo.Remove(ctx, messageID, userID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to remove reaction")
	}

	if deleted && s.pub != nil {
		event := ReactionEvent{
			MessageID: messageID,
			ChannelID: channelID,
			GuildID:   guildID,
			Emoji:     emoji,
			UserID:    userID,
			Action:    "remove",
		}
		if guildID != "" {
			s.pub.PublishToGuild(guildID, "REACTION_REMOVE", event)
		} else {
			s.pub.PublishToDM(dmUserA, dmUserB, "REACTION_REMOVE", event)
		}
	}

	return nil
}
