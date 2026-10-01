package message

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

// GetChannelGuildID returns the guild_id for a guild channel, or 404 if not found.
func (r *Repository) GetChannelGuildID(ctx context.Context, channelID string) (string, error) {
	var guildID string
	err := r.db.QueryRow(ctx,
		`SELECT guild_id FROM channels WHERE id = $1`, channelID,
	).Scan(&guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	if err != nil {
		return "", fmt.Errorf("message.Repository.GetChannelGuildID: %w", err)
	}
	return guildID, nil
}

// ChannelContext describes whether a channel is a guild channel or a DM channel.
type ChannelContext struct {
	GuildID string // empty for DMs
	IsDM    bool
	DMUserA string
	DMUserB string
}

// GetChannelContext looks up a channel in both the channels and dm_channels tables.
func (r *Repository) GetChannelContext(ctx context.Context, channelID string) (*ChannelContext, error) {
	var guildID string
	err := r.db.QueryRow(ctx, `SELECT guild_id FROM channels WHERE id = $1`, channelID).Scan(&guildID)
	if err == nil {
		return &ChannelContext{GuildID: guildID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("message.Repository.GetChannelContext: %w", err)
	}
	// Try dm_channels
	var userA, userB string
	err = r.db.QueryRow(ctx,
		`SELECT user_a_id, user_b_id FROM dm_channels WHERE id = $1`, channelID,
	).Scan(&userA, &userB)
	if err == nil {
		return &ChannelContext{IsDM: true, DMUserA: userA, DMUserB: userB}, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	return nil, fmt.Errorf("message.Repository.GetChannelContext: %w", err)
}

func (r *Repository) Create(ctx context.Context, channelID, authorID, content string) (*MessageResponse, error) {
	var msg MessageResponse
	var author AuthorInfo

	err := r.db.QueryRow(ctx, `
		WITH inserted AS (
			INSERT INTO messages (channel_id, author_id, content)
			VALUES ($1, $2, $3)
			RETURNING id, channel_id, content, created_at
		)
		SELECT i.id, i.channel_id, i.content, i.created_at,
		       u.id, u.username, u.display_name, u.avatar_url
		FROM inserted i
		JOIN users u ON u.id = $2`,
		channelID, authorID, content,
	).Scan(
		&msg.ID, &msg.ChannelID, &msg.Content, &msg.CreatedAt,
		&author.ID, &author.Username, &author.DisplayName, &author.AvatarURL,
	)
	if err != nil {
		return nil, fmt.Errorf("message.Repository.Create: %w", err)
	}
	msg.Author = author
	return &msg, nil
}

func (r *Repository) List(ctx context.Context, channelID string, beforeID *string, limit int) ([]MessageResponse, error) {
	fetch := limit + 1

	var rows pgx.Rows
	var err error

	if beforeID == nil {
		rows, err = r.db.Query(ctx, `
			SELECT m.id, m.channel_id, m.content, m.created_at, m.edited_at,
			       COALESCE(u.id::text, ''), COALESCE(u.username, 'Deleted User'),
			       u.display_name, u.avatar_url
			FROM messages m
			LEFT JOIN users u ON u.id = m.author_id
			WHERE m.channel_id = $1 AND m.deleted_at IS NULL
			ORDER BY m.created_at DESC
			LIMIT $2`,
			channelID, fetch,
		)
	} else {
		rows, err = r.db.Query(ctx, `
			SELECT m.id, m.channel_id, m.content, m.created_at, m.edited_at,
			       COALESCE(u.id::text, ''), COALESCE(u.username, 'Deleted User'),
			       u.display_name, u.avatar_url
			FROM messages m
			LEFT JOIN users u ON u.id = m.author_id
			WHERE m.channel_id = $1
			  AND m.deleted_at IS NULL
			  AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
			ORDER BY m.created_at DESC
			LIMIT $3`,
			channelID, *beforeID, fetch,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("message.Repository.List: %w", err)
	}
	defer rows.Close()

	var msgs []MessageResponse
	for rows.Next() {
		var msg MessageResponse
		var author AuthorInfo
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.Content, &msg.CreatedAt, &msg.EditedAt,
			&author.ID, &author.Username, &author.DisplayName, &author.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("message.Repository.List: scan: %w", err)
		}
		msg.Author = author
		msgs = append(msgs, msg)
	}
	return msgs, nil
}

func (r *Repository) GetByID(ctx context.Context, messageID string) (*MessageResponse, error) {
	var msg MessageResponse
	var author AuthorInfo
	err := r.db.QueryRow(ctx, `
		SELECT m.id, m.channel_id, m.content, m.created_at, m.edited_at,
		       COALESCE(u.id::text, ''), COALESCE(u.username, 'Deleted User'),
		       u.display_name, u.avatar_url,
		       COALESCE((SELECT guild_id::text FROM channels WHERE id = m.channel_id), '')
		FROM messages m
		LEFT JOIN users u ON u.id = m.author_id
		WHERE m.id = $1 AND m.deleted_at IS NULL`,
		messageID,
	).Scan(
		&msg.ID, &msg.ChannelID, &msg.Content, &msg.CreatedAt, &msg.EditedAt,
		&author.ID, &author.Username, &author.DisplayName, &author.AvatarURL,
		&msg.GuildID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	if err != nil {
		return nil, fmt.Errorf("message.Repository.GetByID: %w", err)
	}
	msg.Author = author
	return &msg, nil
}

func (r *Repository) Update(ctx context.Context, messageID, content string) (*MessageResponse, error) {
	var msg MessageResponse
	var author AuthorInfo
	err := r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE messages SET content = $2, edited_at = now()
			WHERE id = $1 AND deleted_at IS NULL
			RETURNING id, channel_id, content, created_at, edited_at
		)
		SELECT u2.id, u2.channel_id, u2.content, u2.created_at, u2.edited_at,
		       COALESCE(u.id::text, ''), COALESCE(u.username, 'Deleted User'),
		       u.display_name, u.avatar_url,
		       COALESCE((SELECT guild_id::text FROM channels WHERE id = u2.channel_id), '')
		FROM updated u2
		LEFT JOIN messages m ON m.id = u2.id
		LEFT JOIN users u ON u.id = m.author_id`,
		messageID, content,
	).Scan(
		&msg.ID, &msg.ChannelID, &msg.Content, &msg.CreatedAt, &msg.EditedAt,
		&author.ID, &author.Username, &author.DisplayName, &author.AvatarURL,
		&msg.GuildID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	if err != nil {
		return nil, fmt.Errorf("message.Repository.Update: %w", err)
	}
	msg.Author = author
	return &msg, nil
}

func (r *Repository) SoftDelete(ctx context.Context, messageID string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE messages SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
		messageID,
	)
	if err != nil {
		return fmt.Errorf("message.Repository.SoftDelete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	return nil
}

// GetUserIDsByUsernames resolves @mention usernames to user IDs.
func (r *Repository) GetUserIDsByUsernames(ctx context.Context, usernames []string) (map[string]string, error) {
	if len(usernames) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, username FROM users WHERE username = ANY($1)`, usernames,
	)
	if err != nil {
		return nil, fmt.Errorf("message.Repository.GetUserIDsByUsernames: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string, len(usernames))
	for rows.Next() {
		var id, username string
		if err := rows.Scan(&id, &username); err != nil {
			return nil, fmt.Errorf("message.Repository.GetUserIDsByUsernames: scan: %w", err)
		}
		result[username] = id
	}
	return result, nil
}

// GetAuthorAndGuild returns the author_id and guild_id for a message.
func (r *Repository) GetAuthorAndGuild(ctx context.Context, messageID string) (authorID, guildID string, err error) {
	authorID, _, guildID, err = r.GetAuthorChannelAndGuild(ctx, messageID)
	return authorID, guildID, err
}

// GetAuthorChannelAndGuild returns the author_id, channel_id, and guild_id for a message.
// guildID is empty for DM channels.
func (r *Repository) GetAuthorChannelAndGuild(ctx context.Context, messageID string) (authorID, channelID, guildID string, err error) {
	err = r.db.QueryRow(ctx, `
		SELECT COALESCE(m.author_id::text, ''),
		       m.channel_id::text,
		       COALESCE((SELECT guild_id::text FROM channels WHERE id = m.channel_id), '')
		FROM messages m
		WHERE m.id = $1 AND m.deleted_at IS NULL`,
		messageID,
	).Scan(&authorID, &channelID, &guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	if err != nil {
		return "", "", "", fmt.Errorf("message.Repository.GetAuthorChannelAndGuild: %w", err)
	}
	return authorID, channelID, guildID, nil
}
