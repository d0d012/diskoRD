package whiteboard

import (
	"context"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the service's persistence boundary.
type Repository interface {
	// GetChannel returns a 404 fiber error when the channel does not exist.
	GetChannel(ctx context.Context, channelID string) (*ChannelInfo, error)
	// CurrentSeq reads just the sequence; an unmaterialised board is seq 0.
	CurrentSeq(ctx context.Context, boardID string) (int64, error)
	// Snapshot reads seq and objects in one transaction, creating the board row
	// lazily.
	Snapshot(ctx context.Context, boardID string) (int64, []Object, error)
	// Commit runs fn in a transaction holding a row lock on the board. fn's
	// error rolls the transaction back and is returned unchanged.
	Commit(ctx context.Context, boardID string, fn func(ctx context.Context, tx BoardTx) error) error
}

// BoardTx is the locked view of a board inside Repository.Commit.
type BoardTx interface {
	// Seq is the board seq at lock time.
	Seq() int64
	// Objects returns the existing objects among ids, keyed by id.
	Objects(ctx context.Context, ids []string) (map[string]Object, error)
	// Totals returns object count and canonical compact stored-body bytes.
	Totals(ctx context.Context) (count int, bytes int64, err error)
	// Assets returns only metadata belonging to this locked board.
	Assets(ctx context.Context, ids []string) (map[string]Asset, error)
	// ReferencedAssets returns distinct live image asset ids, excluding objects
	// being replaced/deleted by a command. Unused uploads (including >24h old)
	// never consume the referenced-asset quota.
	ReferencedAssets(ctx context.Context, excludeObjectIDs []string) ([]string, error)
	InsertAsset(ctx context.Context, asset Asset) error
	Insert(ctx context.Context, o Object) error
	Update(ctx context.Context, o Object) error
	Delete(ctx context.Context, id string) error
	SetSeq(ctx context.Context, seq int64) error
}

// ErrObjectIDTaken is returned by Insert when the id exists on another board
// (object ids are globally unique primary keys).
var ErrObjectIDTaken = errors.New("whiteboard: object id already in use")

type PgRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *PgRepository {
	return &PgRepository{db: db}
}

func (r *PgRepository) GetChannel(ctx context.Context, channelID string) (*ChannelInfo, error) {
	var ch ChannelInfo
	err := r.db.QueryRow(ctx,
		`SELECT id, guild_id, type FROM channels WHERE id = $1`, channelID,
	).Scan(&ch.ID, &ch.GuildID, &ch.Type)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	if err != nil {
		return nil, fmt.Errorf("whiteboard.Repository.GetChannel: %w", err)
	}
	return &ch, nil
}

func (r *PgRepository) CurrentSeq(ctx context.Context, boardID string) (int64, error) {
	var seq int64
	err := r.db.QueryRow(ctx, `SELECT seq FROM whiteboards WHERE id = $1`, boardID).Scan(&seq)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("whiteboard.Repository.CurrentSeq: %w", err)
	}
	return seq, nil
}

func (r *PgRepository) ensureBoard(ctx context.Context, boardID string) error {
	if _, err := r.db.Exec(ctx,
		`INSERT INTO whiteboards (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, boardID,
	); err != nil {
		return fmt.Errorf("whiteboard.Repository.ensureBoard: %w", err)
	}
	return nil
}

func (r *PgRepository) Snapshot(ctx context.Context, boardID string) (int64, []Object, error) {
	// The lazy insert runs outside the snapshot transaction: under REPEATABLE
	// READ a concurrent first insert would abort it with a serialization error.
	if err := r.ensureBoard(ctx, boardID); err != nil {
		return 0, nil, err
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return 0, nil, fmt.Errorf("whiteboard.Repository.Snapshot: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only; nothing to lose

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT seq FROM whiteboards WHERE id = $1`, boardID).Scan(&seq); err != nil {
		return 0, nil, fmt.Errorf("whiteboard.Repository.Snapshot: seq: %w", err)
	}

	rows, err := tx.Query(ctx,
		`SELECT id, version, body FROM whiteboard_objects WHERE board_id = $1 ORDER BY id`, boardID)
	if err != nil {
		return 0, nil, fmt.Errorf("whiteboard.Repository.Snapshot: objects: %w", err)
	}
	defer rows.Close()

	objects := []Object{}
	for rows.Next() {
		var o Object
		if err := rows.Scan(&o.ID, &o.Version, &o.Body); err != nil {
			return 0, nil, fmt.Errorf("whiteboard.Repository.Snapshot: scan: %w", err)
		}
		objects = append(objects, o)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, fmt.Errorf("whiteboard.Repository.Snapshot: rows: %w", err)
	}
	return seq, objects, nil
}

func (r *PgRepository) Commit(ctx context.Context, boardID string, fn func(ctx context.Context, tx BoardTx) error) error {
	if err := r.ensureBoard(ctx, boardID); err != nil {
		return err
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("whiteboard.Repository.Commit: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT seq FROM whiteboards WHERE id = $1 FOR UPDATE`, boardID).Scan(&seq); err != nil {
		return fmt.Errorf("whiteboard.Repository.Commit: lock: %w", err)
	}

	if err := fn(ctx, &pgBoardTx{tx: tx, boardID: boardID, seq: seq}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("whiteboard.Repository.Commit: commit: %w", err)
	}
	return nil
}

type pgBoardTx struct {
	tx      pgx.Tx
	boardID string
	seq     int64
}

func (t *pgBoardTx) Seq() int64 { return t.seq }

func (t *pgBoardTx) Objects(ctx context.Context, ids []string) (map[string]Object, error) {
	rows, err := t.tx.Query(ctx,
		`SELECT id, version, body FROM whiteboard_objects
		 WHERE board_id = $1 AND id = ANY($2::text[]::uuid[])`, t.boardID, ids)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.Objects: %w", err)
	}
	defer rows.Close()

	out := make(map[string]Object, len(ids))
	for rows.Next() {
		var o Object
		if err := rows.Scan(&o.ID, &o.Version, &o.Body); err != nil {
			return nil, fmt.Errorf("whiteboard.BoardTx.Objects: scan: %w", err)
		}
		out[o.ID] = o
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.Objects: rows: %w", err)
	}
	return out, nil
}

func (t *pgBoardTx) Totals(ctx context.Context) (int, int64, error) {
	// JSONB adds whitespace and expands exponent-form numbers. Re-encode through
	// the same canonical encoder as writes so the quota does not drift per edit.
	// This scan is bounded by the board quota; no schema/counter migration in v2.
	rows, err := t.tx.Query(ctx, `SELECT body FROM whiteboard_objects WHERE board_id = $1`, t.boardID)
	if err != nil {
		return 0, 0, fmt.Errorf("whiteboard.BoardTx.Totals: %w", err)
	}
	defer rows.Close()
	var count int
	var size int64
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return 0, 0, fmt.Errorf("whiteboard.BoardTx.Totals: scan: %w", err)
		}
		body, err := canonicalStoredBody(raw)
		if err != nil {
			return 0, 0, fmt.Errorf("whiteboard.BoardTx.Totals: encode: %w", err)
		}
		count++
		size += int64(len(body))
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("whiteboard.BoardTx.Totals: rows: %w", err)
	}
	return count, size, nil
}

func (t *pgBoardTx) Assets(ctx context.Context, ids []string) (map[string]Asset, error) {
	rows, err := t.tx.Query(ctx,
		`SELECT id, storage_key, width, height FROM whiteboard_assets
		 WHERE board_id = $1 AND id = ANY($2::text[]::uuid[])`, t.boardID, ids)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.Assets: %w", err)
	}
	defer rows.Close()
	out := make(map[string]Asset, len(ids))
	for rows.Next() {
		a := Asset{BoardID: t.boardID}
		if err := rows.Scan(&a.ID, &a.StorageKey, &a.Width, &a.Height); err != nil {
			return nil, fmt.Errorf("whiteboard.BoardTx.Assets: scan: %w", err)
		}
		out[a.ID] = a
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.Assets: rows: %w", err)
	}
	return out, nil
}

func (t *pgBoardTx) ReferencedAssets(ctx context.Context, excludeObjectIDs []string) ([]string, error) {
	if excludeObjectIDs == nil {
		excludeObjectIDs = []string{}
	}
	rows, err := t.tx.Query(ctx, `SELECT DISTINCT body->>'assetId' FROM whiteboard_objects
		WHERE board_id = $1 AND body->>'kind' = 'image'
		AND NOT (id = ANY($2::text[]::uuid[]))`, t.boardID, excludeObjectIDs)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.ReferencedAssets: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("whiteboard.BoardTx.ReferencedAssets: scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.ReferencedAssets: rows: %w", err)
	}
	return ids, nil
}

func (t *pgBoardTx) InsertAsset(ctx context.Context, a Asset) error {
	_, err := t.tx.Exec(ctx, `INSERT INTO whiteboard_assets
		(id, board_id, storage_key, mime, bytes, width, height, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		a.ID, t.boardID, a.StorageKey, a.MIME, a.Bytes, a.Width, a.Height, a.UploadedBy)
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.InsertAsset: %w", err)
	}
	return nil
}

func (t *pgBoardTx) Insert(ctx context.Context, o Object) error {
	_, err := t.tx.Exec(ctx,
		`INSERT INTO whiteboard_objects (id, board_id, version, body) VALUES ($1, $2, $3, $4::jsonb)`,
		o.ID, t.boardID, o.Version, []byte(o.Body))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrObjectIDTaken
	}
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.Insert: %w", err)
	}
	return nil
}

func (t *pgBoardTx) Update(ctx context.Context, o Object) error {
	tag, err := t.tx.Exec(ctx,
		`UPDATE whiteboard_objects SET version = $1, body = $2::jsonb, updated_at = now()
		 WHERE id = $3 AND board_id = $4`,
		o.Version, []byte(o.Body), o.ID, t.boardID)
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.Update: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("whiteboard.BoardTx.Update: object %s vanished under lock", o.ID)
	}
	return nil
}

func (t *pgBoardTx) Delete(ctx context.Context, id string) error {
	tag, err := t.tx.Exec(ctx,
		`DELETE FROM whiteboard_objects WHERE id = $1 AND board_id = $2`, id, t.boardID)
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.Delete: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("whiteboard.BoardTx.Delete: object %s vanished under lock", id)
	}
	return nil
}

func (t *pgBoardTx) SetSeq(ctx context.Context, seq int64) error {
	if _, err := t.tx.Exec(ctx,
		`UPDATE whiteboards SET seq = $1, updated_at = now() WHERE id = $2`, seq, t.boardID,
	); err != nil {
		return fmt.Errorf("whiteboard.BoardTx.SetSeq: %w", err)
	}
	return nil
}
