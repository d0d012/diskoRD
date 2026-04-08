package guild

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

func (r *Repository) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.db.Begin(ctx)
}

func (r *Repository) CreateGuildTx(ctx context.Context, tx pgx.Tx, name, ownerID string) (*Guild, error) {
	var g Guild
	err := tx.QueryRow(ctx,
		`INSERT INTO guilds (name, owner_id) VALUES ($1, $2)
		 RETURNING id, name, icon_url, owner_id, created_at, updated_at`,
		name, ownerID,
	).Scan(&g.ID, &g.Name, &g.IconURL, &g.OwnerID, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.CreateGuildTx: %w", err)
	}
	return &g, nil
}

func (r *Repository) AddMemberTx(ctx context.Context, tx pgx.Tx, guildID, userID, role string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO guild_members (guild_id, user_id, role) VALUES ($1, $2, $3)`,
		guildID, userID, role,
	)
	if err != nil {
		return fmt.Errorf("guild.Repository.AddMemberTx: %w", err)
	}
	return nil
}

func (r *Repository) CreateChannelTx(ctx context.Context, tx pgx.Tx, guildID, name, channelType string, position int) (*Channel, error) {
	var ch Channel
	err := tx.QueryRow(ctx,
		`INSERT INTO channels (guild_id, name, type, position) VALUES ($1, $2, $3, $4)
		 RETURNING id, guild_id, name, type, position, created_at, updated_at`,
		guildID, name, channelType, position,
	).Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.CreateChannelTx: %w", err)
	}
	return &ch, nil
}

func (r *Repository) GetGuildByID(ctx context.Context, id string) (*Guild, error) {
	var g Guild
	err := r.db.QueryRow(ctx,
		`SELECT id, name, icon_url, owner_id, created_at, updated_at
		 FROM guilds WHERE id = $1`, id,
	).Scan(&g.ID, &g.Name, &g.IconURL, &g.OwnerID, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "guild not found")
	}
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.GetGuildByID: %w", err)
	}
	return &g, nil
}

func (r *Repository) DeleteGuild(ctx context.Context, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM guilds WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("guild.Repository.DeleteGuild: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "guild not found")
	}
	return nil
}

func (r *Repository) IsMember(ctx context.Context, guildID, userID string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2)`,
		guildID, userID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("guild.Repository.IsMember: %w", err)
	}
	return exists, nil
}

func (r *Repository) GetMemberRole(ctx context.Context, guildID, userID string) (string, error) {
	var role string
	err := r.db.QueryRow(ctx,
		`SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	if err != nil {
		return "", fmt.Errorf("guild.Repository.GetMemberRole: %w", err)
	}
	return role, nil
}

func (r *Repository) ListGuildsByUser(ctx context.Context, userID string) ([]Guild, error) {
	rows, err := r.db.Query(ctx,
		`SELECT g.id, g.name, g.icon_url, g.owner_id, g.created_at, g.updated_at
		 FROM guilds g
		 JOIN guild_members gm ON g.id = gm.guild_id
		 WHERE gm.user_id = $1
		 ORDER BY g.created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.ListGuildsByUser: %w", err)
	}
	defer rows.Close()

	var guilds []Guild
	for rows.Next() {
		var g Guild
		if err := rows.Scan(&g.ID, &g.Name, &g.IconURL, &g.OwnerID, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, fmt.Errorf("guild.Repository.ListGuildsByUser: scan: %w", err)
		}
		guilds = append(guilds, g)
	}
	return guilds, nil
}

func (r *Repository) AddMember(ctx context.Context, guildID, userID, role string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO guild_members (guild_id, user_id, role) VALUES ($1, $2, $3)`,
		guildID, userID, role,
	)
	if err != nil {
		return fmt.Errorf("guild.Repository.AddMember: %w", err)
	}
	return nil
}

func (r *Repository) UpdateMemberRole(ctx context.Context, guildID, userID, role string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE guild_members SET role = $1 WHERE guild_id = $2 AND user_id = $3`,
		role, guildID, userID,
	)
	if err != nil {
		return fmt.Errorf("guild.Repository.UpdateMemberRole: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "member not found")
	}
	return nil
}

func (r *Repository) GetChannelsByGuild(ctx context.Context, guildID string) ([]Channel, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, guild_id, name, type, position, created_at, updated_at
		 FROM channels WHERE guild_id = $1
		 ORDER BY position ASC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.GetChannelsByGuild: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var ch Channel
		if err := rows.Scan(&ch.ID, &ch.GuildID, &ch.Name, &ch.Type, &ch.Position, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, fmt.Errorf("guild.Repository.GetChannelsByGuild: scan: %w", err)
		}
		channels = append(channels, ch)
	}
	return channels, nil
}
