package reaction

import (
	"context"
	"fmt"
	"sync"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

// repository is the persistence subset the service needs; an interface so the
// service can be unit-tested with testify mocks.
type repository interface {
	GetMessageContext(ctx context.Context, messageID string) (channelID, guildID string, err error)
	GetDMParticipants(ctx context.Context, channelID string) (userAID, userBID string, err error)
	Add(ctx context.Context, messageID, userID, emoji string) (bool, error)
	Remove(ctx context.Context, messageID, userID, emoji string) (bool, error)
	CountForEmoji(ctx context.Context, messageID, emoji string) (int, error)
}

// membership is the guild-membership check the service needs.
type membership interface {
	IsMember(ctx context.Context, guildID, userID string) (bool, error)
}

type Service struct {
	repo      repository
	guildRepo membership
	pub       EventPublisher
	// reactMu serialises the mutate → count → publish sequence per message+emoji
	// so a slower request cannot publish a stale count after a newer one.
	reactMu sync.Map // "messageID\x00emoji" -> *sync.Mutex
}

// lock returns the mutex guarding one emoji on one message. Cross-instance
// ordering still depends on Redis delivery; see the task's Open questions.
func (s *Service) lock(messageID, emoji string) *sync.Mutex {
	mu, _ := s.reactMu.LoadOrStore(messageID+"\x00"+emoji, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

func NewService(repo repository, guildRepo membership) *Service {
	return &Service{repo: repo, guildRepo: guildRepo}
}

func (s *Service) SetPublisher(pub EventPublisher) {
	s.pub = pub
}

func invalidEmoji() error {
	return fiber.NewError(fiber.StatusBadRequest, "invalid emoji")
}

// validateEmoji rejects empty, overlong, non-UTF-8, ASCII-text and control
// sequences. Emoji are allowed as any rune >= U+00A9 (which covers ZWJ, VS16,
// keycaps, skin tones and flags), plus ASCII digits/#/* only as the base of a
// keycap sequence (followed by U+FE0F or U+20E3).
func validateEmoji(emoji string) error {
	if emoji == "" || !utf8.ValidString(emoji) {
		return invalidEmoji()
	}
	runes := []rune(emoji)
	if len(runes) > 32 {
		return invalidEmoji()
	}
	for i, r := range runes {
		if r >= 0x00A9 {
			continue
		}
		isKeycapBase := (r >= '0' && r <= '9') || r == '#' || r == '*'
		nextIsKeycap := i+1 < len(runes) && (runes[i+1] == 0xFE0F || runes[i+1] == 0x20E3)
		if isKeycapBase && nextIsKeycap {
			continue
		}
		return invalidEmoji()
	}
	return nil
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

// resolveAudience validates access and returns where the event should go.
func (s *Service) resolveAudience(ctx context.Context, userID, channelID, guildID string) (dmUserA, dmUserB string, err error) {
	if guildID != "" {
		return "", "", s.requireMember(ctx, guildID, userID)
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

func (s *Service) publish(channelID, guildID, dmUserA, dmUserB, op string, event ReactionEvent) {
	if s.pub == nil {
		return
	}
	if guildID != "" {
		s.pub.PublishToGuild(guildID, op, event)
	} else {
		s.pub.PublishToDM(dmUserA, dmUserB, op, event)
	}
}

func (s *Service) AddReaction(ctx context.Context, userID, messageID, emoji string) error {
	if err := validateEmoji(emoji); err != nil {
		return err
	}

	channelID, guildID, err := s.repo.GetMessageContext(ctx, messageID)
	if err != nil {
		return err
	}

	dmUserA, dmUserB, err := s.resolveAudience(ctx, userID, channelID, guildID)
	if err != nil {
		return err
	}

	lock := s.lock(messageID, emoji)
	lock.Lock()
	defer lock.Unlock()

	inserted, err := s.repo.Add(ctx, messageID, userID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to add reaction")
	}
	if !inserted {
		return nil
	}

	count, err := s.repo.CountForEmoji(ctx, messageID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to count reactions")
	}

	s.publish(channelID, guildID, dmUserA, dmUserB, "REACTION_ADD", ReactionEvent{
		MessageID: messageID,
		ChannelID: channelID,
		GuildID:   guildID,
		Emoji:     emoji,
		UserID:    userID,
		Action:    "add",
		Count:     count,
	})

	return nil
}

func (s *Service) RemoveReaction(ctx context.Context, userID, messageID, emoji string) error {
	if err := validateEmoji(emoji); err != nil {
		return err
	}

	channelID, guildID, err := s.repo.GetMessageContext(ctx, messageID)
	if err != nil {
		return err
	}

	dmUserA, dmUserB, err := s.resolveAudience(ctx, userID, channelID, guildID)
	if err != nil {
		return err
	}

	lock := s.lock(messageID, emoji)
	lock.Lock()
	defer lock.Unlock()

	deleted, err := s.repo.Remove(ctx, messageID, userID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to remove reaction")
	}
	if !deleted {
		return nil
	}

	count, err := s.repo.CountForEmoji(ctx, messageID, emoji)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to count reactions")
	}

	s.publish(channelID, guildID, dmUserA, dmUserB, "REACTION_REMOVE", ReactionEvent{
		MessageID: messageID,
		ChannelID: channelID,
		GuildID:   guildID,
		Emoji:     emoji,
		UserID:    userID,
		Action:    "remove",
		Count:     count,
	})

	return nil
}
