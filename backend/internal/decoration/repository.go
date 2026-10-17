package decoration

import (
	"context"
	"encoding/json"
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

const columns = `id, message_id, author_id, doc, x, y, size, opacity, created_at`

func scan(row pgx.Row) (*Decoration, error) {
	var d Decoration
	var doc []byte
	if err := row.Scan(&d.ID, &d.MessageID, &d.AuthorID, &doc, &d.X, &d.Y, &d.Size, &d.Opacity, &d.CreatedAt); err != nil {
		return nil, err
	}
	d.Doc = json.RawMessage(doc)
	return &d, nil
}

// GetMessageContext looks up the channel and guild ("" for DMs) of a live message.
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
		return "", "", fmt.Errorf("decoration.Repository.GetMessageContext: %w", err)
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
		return "", "", fmt.Errorf("decoration.Repository.GetDMParticipants: %w", err)
	}
	return userAID, userBID, nil
}

// Create inserts a decoration, refusing once the message already has MaxPerMessage.
func (r *Repository) Create(ctx context.Context, messageID, authorID string, req CreateRequest) (*Decoration, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("decoration.Repository.Create: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Serialize the per-message limit with concurrent inserts.
	var id string
	err = tx.QueryRow(ctx, `SELECT id FROM messages WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, messageID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "message not found")
	}
	if err != nil {
		return nil, fmt.Errorf("decoration.Repository.Create: lock: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM message_decorations WHERE message_id = $1`, messageID).Scan(&count); err != nil {
		return nil, fmt.Errorf("decoration.Repository.Create: count: %w", err)
	}
	if count >= MaxPerMessage {
		return nil, fiber.NewError(fiber.StatusConflict, fmt.Sprintf("this message already has %d decorations", MaxPerMessage))
	}
	d, err := scan(tx.QueryRow(ctx,
		`INSERT INTO message_decorations (message_id, author_id, doc, x, y, size, opacity)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+columns,
		messageID, authorID, []byte(req.Doc), req.X, req.Y, req.Size, req.Opacity,
	))
	if err != nil {
		return nil, fmt.Errorf("decoration.Repository.Create: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("decoration.Repository.Create: commit: %w", err)
	}
	return d, nil
}

// GetTarget loads what a delete needs; 404 if the decoration or its message is gone.
func (r *Repository) GetTarget(ctx context.Context, id string) (*Target, error) {
	var t Target
	err := r.db.QueryRow(ctx, `
		SELECT d.message_id, m.channel_id,
		       COALESCE((SELECT guild_id::text FROM channels WHERE id = m.channel_id), ''),
		       d.author_id, m.author_id
		FROM message_decorations d
		JOIN messages m ON m.id = d.message_id
		WHERE d.id = $1 AND m.deleted_at IS NULL`,
		id,
	).Scan(&t.MessageID, &t.ChannelID, &t.GuildID, &t.AuthorID, &t.MessageAuthorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "decoration not found")
	}
	if err != nil {
		return nil, fmt.Errorf("decoration.Repository.GetTarget: %w", err)
	}
	return &t, nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM message_decorations WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("decoration.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "decoration not found")
	}
	return nil
}

// ListForMessages returns decorations grouped by message, oldest first.
func (r *Repository) ListForMessages(ctx context.Context, messageIDs []string) (map[string][]Decoration, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+columns+` FROM message_decorations WHERE message_id = ANY($1) ORDER BY created_at`,
		messageIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("decoration.Repository.ListForMessages: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]Decoration)
	for rows.Next() {
		d, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("decoration.Repository.ListForMessages: scan: %w", err)
		}
		out[d.MessageID] = append(out[d.MessageID], *d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("decoration.Repository.ListForMessages: rows: %w", err)
	}
	return out, nil
}
