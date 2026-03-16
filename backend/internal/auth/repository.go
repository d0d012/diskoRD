package auth

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

func (r *Repository) CreateUser(ctx context.Context, username, email, passwordHash string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash)
		 VALUES ($1, $2, $3)
		 RETURNING id, username, email, password_hash, display_name, avatar_url, status, created_at, updated_at`,
		username, email, passwordHash,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("auth.Repository.CreateUser: %w", err)
	}
	return &u, nil
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`SELECT id, username, email, password_hash, display_name, avatar_url, status, created_at, updated_at
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "invalid email or password")
	}
	if err != nil {
		return nil, fmt.Errorf("auth.Repository.GetUserByEmail: %w", err)
	}
	return &u, nil
}

func (r *Repository) GetUserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := r.db.QueryRow(ctx,
		`SELECT id, username, email, password_hash, display_name, avatar_url, status, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("auth.Repository.GetUserByID: %w", err)
	}
	return &u, nil
}
