package message

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

type ReadStateRepository interface {
	IncrementMentions(context.Context, string, []string, bool, time.Time) error
	Ack(context.Context, string, string, bool) (time.Time, error)
}

type ReadStateUpdate struct {
	ChannelID    string    `json:"channelId"`
	LastReadAt   time.Time `json:"lastReadAt"`
	MentionCount int       `json:"mentionCount"`
}

func (s *Service) recordMentions(ctx context.Context, msg *MessageResponse, cc *ChannelContext) {
	repo, ok := s.repo.(ReadStateRepository)
	if !ok {
		return
	}
	ids := msg.Mentions
	if cc.IsDM {
		ids = []string{cc.DMUserA, cc.DMUserB}
	}
	seen := map[string]bool{msg.Author.ID: true}
	recipients := []string{}
	for _, id := range ids {
		if !seen[id] {
			recipients = append(recipients, id)
			seen[id] = true
		}
	}
	if len(recipients) == 0 {
		return
	}
	if err := repo.IncrementMentions(ctx, msg.ChannelID, recipients, cc.IsDM, msg.CreatedAt); err != nil {
		log.Error().Err(err).Msg("message.Service.recordMentions")
	}
}

func (s *Service) Ack(ctx context.Context, userID, channelID, connectionID string) (*ReadStateUpdate, error) {
	cc, err := s.repo.GetChannelContext(ctx, channelID)
	if err != nil {
		return nil, err
	}
	if cc.IsDM {
		if userID != cc.DMUserA && userID != cc.DMUserB {
			return nil, fiber.NewError(403, "not a participant in this DM")
		}
	} else {
		if err := s.requireMember(ctx, cc.GuildID, userID); err != nil {
			return nil, err
		}
		if cc.ChannelType != channelTypeText {
			return nil, fiber.NewError(400, "not a text channel")
		}
	}
	repo, ok := s.repo.(ReadStateRepository)
	if !ok {
		return nil, fmt.Errorf("message.Service.Ack: repository unavailable")
	}
	at, err := repo.Ack(ctx, userID, channelID, cc.IsDM)
	if err != nil {
		return nil, fmt.Errorf("message.Service.Ack: %w", err)
	}
	update := &ReadStateUpdate{ChannelID: channelID, LastReadAt: at}
	if pub, ok := s.pub.(interface {
		NotifyReadState(string, string, interface{})
	}); ok {
		pub.NotifyReadState(userID, connectionID, update)
	}
	return update, nil
}

func (h *Handler) Ack(c *fiber.Ctx) error {
	update, err := h.svc.Ack(c.Context(), c.Locals("userID").(string), c.Params("id"), c.Get("X-Gateway-Connection"))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": update})
}

func readStateTable(dm bool) string {
	if dm {
		return "dm_read_states"
	}
	return "channel_read_states"
}

func (r *Repository) Ack(ctx context.Context, userID, channelID string, dm bool) (time.Time, error) {
	var at time.Time
	err := r.db.QueryRow(ctx, `INSERT INTO `+readStateTable(dm)+` (user_id, channel_id, last_read_at)
 VALUES ($1, $2, clock_timestamp()) ON CONFLICT (user_id, channel_id) DO UPDATE
 SET last_read_at = clock_timestamp(), mention_count = 0, updated_at = now() RETURNING last_read_at`, userID, channelID).Scan(&at)
	return at, err
}

func (r *Repository) IncrementMentions(ctx context.Context, channelID string, users []string, dm bool, createdAt time.Time) error {
	// Preserve the join/creation baseline when first materializing a counter.
	source := `SELECT gm.user_id, c.id, gm.joined_at FROM channels c JOIN guild_members gm ON gm.guild_id = c.guild_id WHERE c.id = $1 AND gm.user_id = ANY($2::uuid[])`
	if dm {
		source = `SELECT u.id, d.id, d.created_at FROM dm_channels d JOIN users u ON u.id IN (d.user_a_id, d.user_b_id) WHERE d.id = $1 AND u.id = ANY($2::uuid[])`
	}
	table := readStateTable(dm)
	_, err := r.db.Exec(ctx, `INSERT INTO `+table+` (user_id, channel_id, last_read_at, mention_count)
 SELECT baseline.*, 1 FROM (`+source+`) baseline(user_id, channel_id, last_read_at) WHERE baseline.last_read_at < $3
 ON CONFLICT (user_id, channel_id) DO UPDATE SET mention_count = `+table+`.mention_count + 1, updated_at = now()
 WHERE `+table+`.last_read_at < $3`, channelID, users, createdAt)
	return err
}
