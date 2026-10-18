package pixelart

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

// artSelect joins the remix author so credits survive the source being deleted.
const artSelect = `
	SELECT a.id, a.owner_id, a.title, a.doc, a.showcase_position, a.remix_of,
	       ra.id, ra.username, ra.display_name, a.created_at, a.updated_at
	FROM pixel_arts a
	LEFT JOIN users ra ON ra.id = a.remix_author_id`

func scanArt(row pgx.Row) (*Art, error) {
	var a Art
	var doc []byte
	var position *int16
	var raID, raUsername *string
	var raDisplay *string
	if err := row.Scan(&a.ID, &a.OwnerID, &a.Title, &doc, &position, &a.RemixOf,
		&raID, &raUsername, &raDisplay, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	a.Doc = json.RawMessage(doc)
	if position != nil {
		p := int(*position)
		a.ShowcasePosition = &p
	}
	if raID != nil && raUsername != nil {
		a.RemixAuthor = &UserRef{ID: *raID, Username: *raUsername, DisplayName: raDisplay}
	}
	return &a, nil
}

func collectArts(rows pgx.Rows, where string) ([]Art, error) {
	defer rows.Close()
	arts := []Art{}
	for rows.Next() {
		a, err := scanArt(rows)
		if err != nil {
			return nil, fmt.Errorf("pixelart.Repository.%s: scan: %w", where, err)
		}
		arts = append(arts, *a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.%s: rows: %w", where, err)
	}
	return arts, nil
}

// List returns a user's whole gallery, newest first.
func (r *Repository) List(ctx context.Context, ownerID string) ([]Art, error) {
	rows, err := r.db.Query(ctx, artSelect+` WHERE a.owner_id = $1 ORDER BY a.updated_at DESC`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.List: %w", err)
	}
	return collectArts(rows, "List")
}

// Get returns one piece; 404 if it doesn't exist.
func (r *Repository) Get(ctx context.Context, id string) (*Art, error) {
	a, err := scanArt(r.db.QueryRow(ctx, artSelect+` WHERE a.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "pixel art not found")
	}
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Get: %w", err)
	}
	return a, nil
}

// Create saves a piece, refusing past MaxGallery under a lock on the owner's row.
func (r *Repository) Create(ctx context.Context, ownerID, title string, doc json.RawMessage, remixOf, remixAuthorID *string) (*Art, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 FOR UPDATE`, ownerID).Scan(&id); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: lock: %w", err)
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM pixel_arts WHERE owner_id = $1`, ownerID).Scan(&count); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: count: %w", err)
	}
	if count >= MaxGallery {
		return nil, fiber.NewError(fiber.StatusConflict, fmt.Sprintf("your gallery is full (%d pieces); delete one first", MaxGallery))
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO pixel_arts (owner_id, title, doc, remix_of, remix_author_id)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		ownerID, title, []byte(doc), remixOf, remixAuthorID,
	).Scan(&id); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: insert: %w", err)
	}
	a, err := scanArt(tx.QueryRow(ctx, artSelect+` WHERE a.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: reload: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Create: commit: %w", err)
	}
	return a, nil
}

// Update changes the title and/or doc of one of the owner's pieces.
func (r *Repository) Update(ctx context.Context, ownerID, id string, title *string, doc json.RawMessage) (*Art, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE pixel_arts
		 SET title = COALESCE($3, title), doc = COALESCE($4, doc), updated_at = now()
		 WHERE id = $1 AND owner_id = $2`,
		id, ownerID, title, nullableJSON(doc),
	)
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Update: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fiber.NewError(fiber.StatusNotFound, "pixel art not found")
	}
	return r.Get(ctx, id)
}

func nullableJSON(doc json.RawMessage) any {
	if len(doc) == 0 {
		return nil
	}
	return []byte(doc)
}

// Delete removes one of the owner's pieces (and any buddy using it).
func (r *Repository) Delete(ctx context.Context, ownerID, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM pixel_arts WHERE id = $1 AND owner_id = $2`, id, ownerID)
	if err != nil {
		return fmt.Errorf("pixelart.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "pixel art not found")
	}
	return nil
}

// ownsAll reports whether every id belongs to ownerID (ids are already de-duplicated).
func ownsAll(ctx context.Context, tx pgx.Tx, ownerID string, ids []string) (bool, error) {
	if len(ids) == 0 {
		return true, nil
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM pixel_arts WHERE owner_id = $1 AND id = ANY($2)`, ownerID, ids).Scan(&n); err != nil {
		return false, err
	}
	return n == len(ids), nil
}

// SetShowcase replaces the showcase with ids, in order.
func (r *Repository) SetShowcase(ctx context.Context, ownerID string, ids []string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pixelart.Repository.SetShowcase: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	ok, err := ownsAll(ctx, tx, ownerID, ids)
	if err != nil {
		return fmt.Errorf("pixelart.Repository.SetShowcase: check: %w", err)
	}
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "showcase can only hold your own pieces")
	}
	if _, err := tx.Exec(ctx, `UPDATE pixel_arts SET showcase_position = NULL WHERE owner_id = $1 AND showcase_position IS NOT NULL`, ownerID); err != nil {
		return fmt.Errorf("pixelart.Repository.SetShowcase: clear: %w", err)
	}
	for i, id := range ids {
		if _, err := tx.Exec(ctx, `UPDATE pixel_arts SET showcase_position = $3 WHERE id = $1 AND owner_id = $2`, id, ownerID, i); err != nil {
			return fmt.Errorf("pixelart.Repository.SetShowcase: set: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pixelart.Repository.SetShowcase: commit: %w", err)
	}
	return nil
}

// SetBuddies replaces the owner's buddies.
func (r *Repository) SetBuddies(ctx context.Context, ownerID string, buddies []Buddy) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pixelart.Repository.SetBuddies: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	seen := map[string]bool{}
	ids := []string{}
	for _, b := range buddies {
		if !seen[b.ArtID] {
			seen[b.ArtID] = true
			ids = append(ids, b.ArtID)
		}
	}
	ok, err := ownsAll(ctx, tx, ownerID, ids)
	if err != nil {
		return fmt.Errorf("pixelart.Repository.SetBuddies: check: %w", err)
	}
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "buddies can only use your own pieces")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM profile_buddies WHERE owner_id = $1`, ownerID); err != nil {
		return fmt.Errorf("pixelart.Repository.SetBuddies: clear: %w", err)
	}
	for i, b := range buddies {
		if _, err := tx.Exec(ctx,
			`INSERT INTO profile_buddies (owner_id, art_id, position, x, y, height, flip, front)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			ownerID, b.ArtID, i, b.X, b.Y, b.Height, b.Flip, b.Front,
		); err != nil {
			return fmt.Errorf("pixelart.Repository.SetBuddies: insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pixelart.Repository.SetBuddies: commit: %w", err)
	}
	return nil
}

// Profile loads a user's showcase (in order) and buddies with their art.
func (r *Repository) Profile(ctx context.Context, userID string) (*Profile, error) {
	rows, err := r.db.Query(ctx, artSelect+` WHERE a.owner_id = $1 AND a.showcase_position IS NOT NULL ORDER BY a.showcase_position`, userID)
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Profile: showcase: %w", err)
	}
	showcase, err := collectArts(rows, "Profile")
	if err != nil {
		return nil, err
	}

	brows, err := r.db.Query(ctx,
		`SELECT b.art_id, b.x, b.y, b.height, b.flip, b.front, a.doc
		 FROM profile_buddies b JOIN pixel_arts a ON a.id = b.art_id
		 WHERE b.owner_id = $1 ORDER BY b.position`, userID)
	if err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Profile: buddies: %w", err)
	}
	defer brows.Close()
	buddies := []PlacedBuddy{}
	for brows.Next() {
		var b PlacedBuddy
		var doc []byte
		var x, y, h int16
		if err := brows.Scan(&b.ArtID, &x, &y, &h, &b.Flip, &b.Front, &doc); err != nil {
			return nil, fmt.Errorf("pixelart.Repository.Profile: scan buddy: %w", err)
		}
		b.X, b.Y, b.Height, b.Doc = int(x), int(y), int(h), json.RawMessage(doc)
		buddies = append(buddies, b)
	}
	if err := brows.Err(); err != nil {
		return nil, fmt.Errorf("pixelart.Repository.Profile: buddies rows: %w", err)
	}
	return &Profile{Showcase: showcase, Buddies: buddies}, nil
}

// UserExists distinguishes "no showcase" from "no such user".
func (r *Repository) UserExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists); err != nil {
		return false, fmt.Errorf("pixelart.Repository.UserExists: %w", err)
	}
	return exists, nil
}
