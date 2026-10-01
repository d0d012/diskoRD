package message

import (
	"context"
	"fmt"
	"regexp"

	"github.com/gofiber/fiber/v2"

	"github.com/d0d012/diskord/internal/guild"
)

var mentionRe = regexp.MustCompile(`@(\w+)`)

func parseMentionUsernames(content string) []string {
	matches := mentionRe.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)
	var usernames []string
	for _, m := range matches {
		if !seen[m[1]] {
			seen[m[1]] = true
			usernames = append(usernames, m[1])
		}
	}
	return usernames
}

type Service struct {
	repo      *Repository
	guildRepo *guild.Repository
	pub       EventPublisher // nil until 3.4 wires the gateway
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
		return fmt.Errorf("message.Service: check membership: %w", err)
	}
	if !ok {
		return fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	return nil
}

func (s *Service) Send(ctx context.Context, userID, channelID string, req CreateMessageRequest) (*MessageResponse, error) {
	cc, err := s.repo.GetChannelContext(ctx, channelID)
	if err != nil {
		return nil, err
	}

	if cc.IsDM {
		if userID != cc.DMUserA && userID != cc.DMUserB {
			return nil, fiber.NewError(fiber.StatusForbidden, "not a participant in this DM")
		}
		recipientID := cc.DMUserB
		if userID == cc.DMUserB {
			recipientID = cc.DMUserA
		}
		msg, err := s.repo.Create(ctx, channelID, userID, req.Content)
		if err != nil {
			return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to send message")
		}
		s.resolveMentions(ctx, msg)
		if s.pub != nil {
			s.pub.PublishToDM(userID, recipientID, "MESSAGE_CREATE", msg)
		}
		return msg, nil
	}

	if err := s.requireMember(ctx, cc.GuildID, userID); err != nil {
		return nil, err
	}
	msg, err := s.repo.Create(ctx, channelID, userID, req.Content)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to send message")
	}
	msg.GuildID = cc.GuildID
	s.resolveMentions(ctx, msg)
	if s.pub != nil {
		s.pub.PublishToGuild(cc.GuildID, "MESSAGE_CREATE", msg)
	}
	return msg, nil
}

func (s *Service) PublishWithAttachment(ctx context.Context, msg *MessageResponse) {
	if s.pub == nil {
		return
	}
	cc, err := s.repo.GetChannelContext(ctx, msg.ChannelID)
	if err != nil {
		return
	}
	if cc.IsDM {
		recipientID := cc.DMUserB
		if msg.Author.ID == cc.DMUserB {
			recipientID = cc.DMUserA
		}
		s.pub.PublishToDM(msg.Author.ID, recipientID, "MESSAGE_CREATE", msg)
	} else {
		s.pub.PublishToGuild(msg.GuildID, "MESSAGE_CREATE", msg)
	}
}

func (s *Service) resolveMentions(ctx context.Context, msg *MessageResponse) {
	usernames := parseMentionUsernames(msg.Content)
	if len(usernames) == 0 {
		return
	}
	idMap, err := s.repo.GetUserIDsByUsernames(ctx, usernames)
	if err != nil {
		return
	}
	for _, id := range idMap {
		msg.Mentions = append(msg.Mentions, id)
	}
}

func (s *Service) List(ctx context.Context, userID, channelID string, beforeID *string, limit int) (*MessagesPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	cc, err := s.repo.GetChannelContext(ctx, channelID)
	if err != nil {
		return nil, err
	}

	if cc.IsDM {
		if userID != cc.DMUserA && userID != cc.DMUserB {
			return nil, fiber.NewError(fiber.StatusForbidden, "not a participant in this DM")
		}
	} else {
		if err := s.requireMember(ctx, cc.GuildID, userID); err != nil {
			return nil, err
		}
	}

	msgs, err := s.repo.List(ctx, channelID, beforeID, limit)
	if err != nil {
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to fetch messages")
	}

	hasMore := len(msgs) > limit
	if hasMore {
		msgs = msgs[:limit]
	}

	// Enrich with guildID for guild channels; reverse so oldest is first
	if !cc.IsDM {
		for i := range msgs {
			msgs[i].GuildID = cc.GuildID
		}
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	return &MessagesPage{Items: msgs, HasMore: hasMore}, nil
}

func (s *Service) Edit(ctx context.Context, userID, messageID string, req EditMessageRequest) (*MessageResponse, error) {
	authorID, channelID, guildID, err := s.repo.GetAuthorChannelAndGuild(ctx, messageID)
	if err != nil {
		return nil, err
	}
	if authorID != userID {
		return nil, fiber.NewError(fiber.StatusForbidden, "only the message author can edit it")
	}

	cc, err := s.repo.GetChannelContext(ctx, channelID)
	if err != nil {
		return nil, err
	}

	msg, err := s.repo.Update(ctx, messageID, req.Content)
	if err != nil {
		return nil, err
	}
	msg.GuildID = guildID

	if s.pub != nil {
		if cc.IsDM {
			s.pub.PublishToDM(cc.DMUserA, cc.DMUserB, "MESSAGE_UPDATE", msg)
		} else {
			s.pub.PublishToGuild(guildID, "MESSAGE_UPDATE", msg)
		}
	}
	return msg, nil
}

func (s *Service) Delete(ctx context.Context, userID, messageID string) error {
	authorID, channelID, guildID, err := s.repo.GetAuthorChannelAndGuild(ctx, messageID)
	if err != nil {
		return err
	}

	cc, err := s.repo.GetChannelContext(ctx, channelID)
	if err != nil {
		return err
	}

	// Author or guild owner can delete. DM messages can only be deleted by their author.
	if authorID != userID {
		if cc.IsDM {
			return fiber.NewError(fiber.StatusForbidden, "only the message author can delete it")
		}
		role, err := s.guildRepo.GetMemberRole(ctx, guildID, userID)
		if err != nil || role != "owner" {
			return fiber.NewError(fiber.StatusForbidden, "only the author or guild owner can delete this message")
		}
	}

	if err := s.repo.SoftDelete(ctx, messageID); err != nil {
		return err
	}

	if s.pub != nil {
		payload := map[string]string{
			"id":        messageID,
			"channelId": channelID,
			"guildId":   guildID,
		}
		if cc.IsDM {
			s.pub.PublishToDM(cc.DMUserA, cc.DMUserB, "MESSAGE_DELETE", payload)
		} else {
			s.pub.PublishToGuild(guildID, "MESSAGE_DELETE", payload)
		}
	}
	return nil
}
