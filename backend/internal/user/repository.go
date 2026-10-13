package user

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const userColumns = `id, username, email, password_hash, display_name, avatar_url,
	bio, banner_color, preferred_status, status, created_at, updated_at`

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanUser(row rowScanner) (*User, error) {
	var u User
	err := row.Scan(
		&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL,
		&u.Bio, &u.BannerColor, &u.PreferredStatus, &u.Status, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetByID(ctx context.Context, id string) (*User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.GetByID: %w", err)
	}
	return u, nil
}

func (r *Repository) FindByUsername(ctx context.Context, username string) (*User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE lower(username) = lower($1)`, username))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.FindByUsername: %w", err)
	}
	return u, nil
}

// UpdateProfile updates only the non-nil fields. A pointer to "" clears the
// column to NULL.
func (r *Repository) UpdateProfile(ctx context.Context, id string, p UpdateProfileParams) (*User, error) {
	set := []string{"updated_at = now()"}
	args := []any{id}

	add := func(column string, value *string) {
		if value == nil {
			return
		}
		var placeholder any
		if *value == "" {
			placeholder = nil
		} else {
			placeholder = *value
		}
		args = append(args, placeholder)
		set = append(set, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	add("display_name", p.DisplayName)
	add("bio", p.Bio)
	add("banner_color", p.BannerColor)

	query := fmt.Sprintf("UPDATE users SET %s WHERE id = $1 RETURNING %s", strings.Join(set, ", "), userColumns)
	u, err := scanUser(r.db.QueryRow(ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.UpdateProfile: %w", err)
	}
	return u, nil
}

func (r *Repository) SetAvatarURL(ctx context.Context, id string, url *string) (*User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING `+userColumns,
		id, url))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.SetAvatarURL: %w", err)
	}
	return u, nil
}

func (r *Repository) SetPreferredStatus(ctx context.Context, id, status string) (*User, error) {
	u, err := scanUser(r.db.QueryRow(ctx,
		`UPDATE users SET preferred_status = $2, updated_at = now() WHERE id = $1 RETURNING `+userColumns,
		id, status))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("user.Repository.SetPreferredStatus: %w", err)
	}
	return u, nil
}

func (r *Repository) GetPreferredStatus(ctx context.Context, id string) (string, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT preferred_status FROM users WHERE id = $1`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	if err != nil {
		return "", fmt.Errorf("user.Repository.GetPreferredStatus: %w", err)
	}
	return status, nil
}
