package user

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

func (r *Repository) GetByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`SELECT id, username, email, password_hash, display_name, avatar_url, status, created_at, updated_at
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.GetByID: %w", err)
	}
	return &u, nil
}

func (r *Repository) UpdateProfile(ctx context.Context, id string, displayName *string, avatarURL *string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`UPDATE users
		 SET display_name = COALESCE($2, display_name),
		     avatar_url = COALESCE($3, avatar_url),
		     updated_at = now()
		 WHERE id = $1
		 RETURNING id, username, email, password_hash, display_name, avatar_url, status, created_at, updated_at`,
		id, displayName, avatarURL,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.UpdateProfile: %w", err)
	}
	return &u, nil
}
