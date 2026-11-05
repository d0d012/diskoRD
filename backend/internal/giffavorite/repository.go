package giffavorite

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }
func (r *Repository) List(ctx context.Context, userID string, after *Cursor, limit int) ([]Favorite, error) {
	var createdAt, slug any
	if after != nil {
		createdAt = after.CreatedAt
		slug = after.Slug
	}
	rows, err := r.db.Query(ctx, `SELECT slug,width,height,created_at FROM gif_favorites
 WHERE user_id=$1 AND provider='klipy' AND ($2::timestamptz IS NULL OR (created_at,slug)<($2::timestamptz,$3::text))
 ORDER BY created_at DESC,slug DESC LIMIT $4`, userID, createdAt, slug, limit)
	if err != nil {
		return nil, fmt.Errorf("giffavorite.Repository.List: %w", err)
	}
	defer rows.Close()
	items := []Favorite{}
	for rows.Next() {
		var f Favorite
		if err := rows.Scan(&f.Slug, &f.Width, &f.Height, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("giffavorite.Repository.List: scan: %w", err)
		}
		items = append(items, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("giffavorite.Repository.List: rows: %w", err)
	}
	return items, nil
}
func (r *Repository) Put(ctx context.Context, userID, slug string, d Dimensions) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("giffavorite.Repository.Put: begin: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize additions per user, including the quota check. Existing favorites remain idempotent at capacity.
	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, userID).Scan(&id); err != nil {
		return fmt.Errorf("giffavorite.Repository.Put: lock: %w", err)
	}
	var count int
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT count(*), COALESCE(bool_or(provider='klipy' AND slug=$2),false) FROM gif_favorites WHERE user_id=$1`, userID, slug).Scan(&count, &exists); err != nil {
		return fmt.Errorf("giffavorite.Repository.Put: count: %w", err)
	}
	if !exists && count >= MaxFavorites {
		return ErrFull
	}
	_, err = tx.Exec(ctx, `INSERT INTO gif_favorites(user_id,slug,width,height) VALUES($1,$2,$3,$4)
 ON CONFLICT(user_id,provider,slug) DO UPDATE SET width=COALESCE(EXCLUDED.width,gif_favorites.width),height=COALESCE(EXCLUDED.height,gif_favorites.height),updated_at=now()`, userID, slug, d.Width, d.Height)
	if err != nil {
		return fmt.Errorf("giffavorite.Repository.Put: upsert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("giffavorite.Repository.Put: commit: %w", err)
	}
	return nil
}
func (r *Repository) Delete(ctx context.Context, userID, slug string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM gif_favorites WHERE user_id=$1 AND provider='klipy' AND slug=$2`, userID, slug)
	if err != nil {
		return fmt.Errorf("giffavorite.Repository.Delete: %w", err)
	}
	return nil
}
