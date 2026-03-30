package channel

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

func (r *Repository) Create(ctx context.Context, guildID, name, channelType string, position int) (*Channel, error) {
	var ch Channel
	err := r.db.QueryRow(ctx,
		`INSERT INTO channels (guild_id, name, type, position)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, guild_id, name, type, position, created_at, updated_at`,
		guildID, name, channelType, position,
	).Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("channel.Repository.Create: %w", err)
	}
	return &ch, nil
}

func (r *Repository) GetByID(ctx context.Context, id string) (*Channel, error) {
	var ch Channel
	err := r.db.QueryRow(ctx,
		`SELECT id, guild_id, name, type, position, created_at, updated_at
		 FROM channels WHERE id = $1`, id,
	).Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	if err != nil {
		return nil, fmt.Errorf("channel.Repository.GetByID: %w", err)
	}
	return &ch, nil
}

func (r *Repository) ListByGuild(ctx context.Context, guildID string) ([]Channel, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, guild_id, name, type, position, created_at, updated_at
		 FROM channels WHERE guild_id = $1
		 ORDER BY position ASC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("channel.Repository.ListByGuild: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var ch Channel
		if err := rows.Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, fmt.Errorf("channel.Repository.ListByGuild: scan: %w", err)
		}
		channels = append(channels, ch)
	}
	return channels, nil
}

func (r *Repository) Update(ctx context.Context, id string, name *string, position *int) (*Channel, error) {
	var ch Channel
	err := r.db.QueryRow(ctx,
		`UPDATE channels
		 SET name = COALESCE($1, name),
		     position = COALESCE($2, position),
		     updated_at = now()
		 WHERE id = $3
		 RETURNING id, guild_id, name, type, position, created_at, updated_at`,
		name, position, id,
	).Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	if err != nil {
		return nil, fmt.Errorf("channel.Repository.Update: %w", err)
	}
	return &ch, nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM channels WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("channel.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	return nil
}

func (r *Repository) CountTextChannelsByGuild(ctx context.Context, guildID string) (int, error) {
	var count int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM channels WHERE guild_id = $1 AND type = 'text'`, guildID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("channel.Repository.CountTextChannelsByGuild: %w", err)
	}
	return count, nil
}

func (r *Repository) GetMaxPosition(ctx context.Context, guildID string) (int, error) {
	var pos *int
	err := r.db.QueryRow(ctx,
		`SELECT MAX(position) FROM channels WHERE guild_id = $1`, guildID,
	).Scan(&pos)
	if err != nil {
		return 0, fmt.Errorf("channel.Repository.GetMaxPosition: %w", err)
	}
	if pos == nil {
		return -1, nil
	}
	return *pos, nil
}
