package soundboard

import (
	"context"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const columns = `id, guild_id, creator_id, name, created_at, updated_at`

func scanSound(row pgx.Row) (*Sound, error) {
	var s Sound
	err := row.Scan(&s.ID, &s.GuildID, &s.CreatorID, &s.Name, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(404, "sound not found")
	}
	if err != nil {
		return nil, fmt.Errorf("soundboard.Repository.scanSound: %w", err)
	}
	return &s, nil
}
func (r *Repository) List(ctx context.Context, guildID string) ([]Sound, error) {
	rows, err := r.db.Query(ctx, `SELECT `+columns+` FROM guild_sounds WHERE guild_id=$1 ORDER BY created_at, id`, guildID)
	if err != nil {
		return nil, fmt.Errorf("soundboard.Repository.List: %w", err)
	}
	defer rows.Close()
	sounds := make([]Sound, 0)
	for rows.Next() {
		s, err := scanSound(rows)
		if err != nil {
			return nil, err
		}
		sounds = append(sounds, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("soundboard.Repository.List: rows: %w", err)
	}
	return sounds, nil
}
func (r *Repository) Create(ctx context.Context, guildID, userID string, req CreateRequest) (*Sound, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("soundboard.Repository.Create: begin: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize the quota check with concurrent inserts for this guild.
	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM guilds WHERE id=$1 FOR UPDATE`, guildID).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fiber.NewError(fiber.StatusNotFound, "guild not found")
		}
		return nil, fmt.Errorf("soundboard.Repository.Create: lock: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM guild_sounds WHERE guild_id=$1`, guildID).Scan(&count); err != nil {
		return nil, fmt.Errorf("soundboard.Repository.Create: count: %w", err)
	}
	if count >= MaxGuildSounds {
		return nil, fiber.NewError(409, fmt.Sprintf("this server has reached its %d-sound limit", MaxGuildSounds))
	}
	s, err := scanSound(tx.QueryRow(ctx, `INSERT INTO guild_sounds (guild_id, creator_id, name, audio) VALUES ($1,$2,$3,$4) RETURNING `+columns, guildID, userID, req.Name, req.Audio))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("soundboard.Repository.Create: commit: %w", err)
	}
	return s, nil
}
func (r *Repository) Get(ctx context.Context, guildID, id string) (*Sound, error) {
	return scanSound(r.db.QueryRow(ctx, `SELECT `+columns+` FROM guild_sounds WHERE guild_id=$1 AND id=$2`, guildID, id))
}
func (r *Repository) Audio(ctx context.Context, guildID, id string) ([]byte, error) {
	var audio []byte
	err := r.db.QueryRow(ctx, `SELECT audio FROM guild_sounds WHERE guild_id=$1 AND id=$2`, guildID, id).Scan(&audio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(404, "sound not found")
	}
	if err != nil {
		return nil, fmt.Errorf("soundboard.Repository.Audio: %w", err)
	}
	return audio, nil
}
func (r *Repository) Delete(ctx context.Context, guildID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM guild_sounds WHERE guild_id=$1 AND id=$2`, guildID, id)
	if err != nil {
		return fmt.Errorf("soundboard.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(404, "sound not found")
	}
	return nil
}
