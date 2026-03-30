package invite

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const codeChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func generateCode() (string, error) {
	b := make([]byte, 8)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeChars))))
		if err != nil {
			return "", err
		}
		b[i] = codeChars[n.Int64()]
	}
	return string(b), nil
}

func (r *Repository) CreateInvite(ctx context.Context, guildID, creatorID string, maxUses *int, expiresAt *time.Time) (*Invite, error) {
	code, err := generateCode()
	if err != nil {
		return nil, fmt.Errorf("invite.Repository.CreateInvite: generate code: %w", err)
	}

	var inv Invite
	err = r.db.QueryRow(ctx,
		`INSERT INTO invites (code, guild_id, creator_id, max_uses, expires_at)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING code, guild_id, creator_id, max_uses, use_count, expires_at, created_at`,
		code, guildID, creatorID, maxUses, expiresAt,
	).Scan(&inv.Code, &inv.GuildID, &inv.CreatorID, &inv.MaxUses, &inv.UseCount, &inv.ExpiresAt, &inv.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("invite.Repository.CreateInvite: %w", err)
	}
	return &inv, nil
}

func (r *Repository) GetInvite(ctx context.Context, code string) (*Invite, error) {
	var inv Invite
	err := r.db.QueryRow(ctx,
		`SELECT code, guild_id, creator_id, max_uses, use_count, expires_at, created_at
		 FROM invites WHERE code = $1`,
		code,
	).Scan(&inv.Code, &inv.GuildID, &inv.CreatorID, &inv.MaxUses, &inv.UseCount, &inv.ExpiresAt, &inv.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "invite not found")
	}
	if err != nil {
		return nil, fmt.Errorf("invite.Repository.GetInvite: %w", err)
	}
	return &inv, nil
}

func (r *Repository) IncrementUseCount(ctx context.Context, code string) error {
	_, err := r.db.Exec(ctx, `UPDATE invites SET use_count = use_count + 1 WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("invite.Repository.IncrementUseCount: %w", err)
	}
	return nil
}
