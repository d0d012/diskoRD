package reaction

import (
	"context"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Add inserts a new reaction. Returns true if it was newly inserted, false if it already existed.
func (r *Repository) Add(ctx context.Context, messageID, userID, emoji string) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`INSERT INTO message_reactions (message_id, user_id, emoji)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
		messageID, userID, emoji,
	)
	if err != nil {
		return false, fmt.Errorf("reaction.Repository.Add: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// Remove deletes a reaction. Returns true if it was deleted, false if it didn't exist.
func (r *Repository) Remove(ctx context.Context, messageID, userID, emoji string) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM message_reactions
		 WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
		messageID, userID, emoji,
	)
	if err != nil {
		return false, fmt.Errorf("reaction.Repository.Remove: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// CountForEmoji returns the total number of reactions for one emoji on a message.
func (r *Repository) CountForEmoji(ctx context.Context, messageID, emoji string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM message_reactions WHERE message_id = $1 AND emoji = $2`,
		messageID, emoji,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("reaction.Repository.CountForEmoji: %w", err)
	}
	return count, nil
}

// GetForMessage aggregates reactions for a message.
func (r *Repository) GetForMessage(ctx context.Context, messageID, viewerID string) ([]Reaction, error) {
	rows, err := r.db.Query(ctx,
		`SELECT emoji, COUNT(*) as count,
		        bool_or(user_id = $2) as self_reacted
		 FROM message_reactions
		 WHERE message_id = $1
		 GROUP BY emoji
		 ORDER BY count DESC, emoji ASC`,
		messageID, viewerID,
	)
	if err != nil {
		return nil, fmt.Errorf("reaction.Repository.GetForMessage: %w", err)
	}
	defer rows.Close()

	var reactions []Reaction
	for rows.Next() {
		var emoji string
		var count int
		var selfReacted bool
		if err := rows.Scan(&emoji, &count, &selfReacted); err != nil {
			return nil, fmt.Errorf("reaction.Repository.GetForMessage: scan: %w", err)
		}
		reactions = append(reactions, Reaction{
			MessageID:   messageID,
			UserID:      viewerID, // not really meaningful for the aggregated list, but keeping struct shape
			Emoji:       emoji,
			Count:       count,
			SelfReacted: selfReacted,
		})
	}
	return reactions, nil
}

// GetMessageContext looks up the channel and guild for a message
func (r *Repository) GetMessageContext(ctx context.Context, messageID string) (channelID, guildID string, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT m.channel_id,
		       COALESCE((SELECT guild_id::text FROM channels WHERE id = m.channel_id), '')
		FROM messages m
		WHERE m.id = $1 AND m.deleted_at IS NULL`,
		messageID,
	).Scan(&channelID, &guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	if err != nil {
		return "", "", fmt.Errorf("reaction.Repository.GetMessageContext: %w", err)
	}
	return channelID, guildID, nil
}

func (r *Repository) GetDMParticipants(ctx context.Context, channelID string) (userAID, userBID string, err error) {
	err = r.db.QueryRow(ctx,
		`SELECT user_a_id, user_b_id FROM dm_channels WHERE id = $1`, channelID,
	).Scan(&userAID, &userBID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", fiber.NewError(fiber.StatusNotFound, "DM channel not found")
	}
	if err != nil {
		return "", "", fmt.Errorf("reaction.Repository.GetDMParticipants: %w", err)
	}
	return userAID, userBID, nil
}
