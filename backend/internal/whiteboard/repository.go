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
	OrphanAssetBoards(ctx context.Context) ([]string, error)
	ExistingAssetKeys(ctx context.Context, keys []string) ([]string, error)
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
	// Totals returns the locked counters (initialising legacy boards once).
	Totals(ctx context.Context) (count int, bytes int64, err error)
	// CountByAuthor excludes objects deleted by this command.
	CountByAuthor(ctx context.Context, userID string, excludeIDs []string) (int, error)
	// Bounds excludes every object touched by this command; nil means empty.
	Bounds(ctx context.Context, excludeIDs []string) (*bounds, error)
	// PurgeTargets selects at most MaxChangesPerCommand matching objects.
	PurgeTargets(ctx context.Context, req PurgeRequest) ([]Object, error)
	// Assets returns only metadata belonging to this locked board.
	Assets(ctx context.Context, ids []string) (map[string]Asset, error)
	// ReferencedAssets returns distinct live image asset ids, excluding objects
	// being replaced/deleted by a command. Unused uploads (including >24h old)
	// never consume the referenced-asset quota.
	ReferencedAssets(ctx context.Context, excludeObjectIDs []string) ([]string, error)
	TouchAssets(ctx context.Context, ids []string) error
	DeleteOrphanAssets(ctx context.Context) ([]string, error)
	InsertAsset(ctx context.Context, asset Asset) error
	Insert(ctx context.Context, o Object) error
	Update(ctx context.Context, o Object) error
	Delete(ctx context.Context, id string) error
	// WriteObjects applies writes in order with the same semantics as
	// Insert/Update/Delete, in one round trip; it stops at the first error.
	WriteObjects(ctx context.Context, writes []ObjectWrite) error
	// SetState persists the sequence and quota counters with the object writes.
	SetState(ctx context.Context, seq int64, count int, bytes int64) error
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

	var seq, bodyBytes int64
	var count int
	if err := tx.QueryRow(ctx, `SELECT seq, object_count, body_bytes FROM whiteboards WHERE id = $1 FOR UPDATE`, boardID).
		Scan(&seq, &count, &bodyBytes); err != nil {
		return fmt.Errorf("whiteboard.Repository.Commit: lock: %w", err)
	}

	if err := fn(ctx, &pgBoardTx{tx: tx, boardID: boardID, seq: seq, count: count, bodyBytes: bodyBytes}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("whiteboard.Repository.Commit: commit: %w", err)
	}
	return nil
}

type pgBoardTx struct {
	tx        pgx.Tx
	boardID   string
	seq       int64
	count     int
	bodyBytes int64
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
	if t.bodyBytes >= 0 {
		return t.count, t.bodyBytes, nil
	}
	// Migration 000029 marks nonempty legacy boards with -1: SQL's JSONB text
	// cannot reproduce Go's float64 encoding and HTML escaping exactly. Only
	// these boards need a full scan, once on their first successful command.
	// SetState persists the exact totals with the command under this row lock.
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
	t.count, t.bodyBytes = count, size
	return count, size, nil
}

func (t *pgBoardTx) CountByAuthor(ctx context.Context, userID string, excludeIDs []string) (int, error) {
	if excludeIDs == nil {
		excludeIDs = []string{}
	}
	var count int
	err := t.tx.QueryRow(ctx, `SELECT count(*) FROM whiteboard_objects
		WHERE board_id = $1 AND created_by = $2
		AND NOT (id = ANY($3::text[]::uuid[]))`, t.boardID, userID, excludeIDs).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("whiteboard.BoardTx.CountByAuthor: %w", err)
	}
	return count, nil
}

func (t *pgBoardTx) Bounds(ctx context.Context, excludeIDs []string) (*bounds, error) {
	if excludeIDs == nil {
		excludeIDs = []string{}
	}
	var minX, minY, maxX, maxY *float64
	err := t.tx.QueryRow(ctx, `SELECT min(x), min(y), max(x + w), max(y + h)
		FROM whiteboard_objects WHERE board_id = $1
		AND NOT (id = ANY($2::text[]::uuid[]))`, t.boardID, excludeIDs).Scan(&minX, &minY, &maxX, &maxY)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.Bounds: %w", err)
	}
	if minX == nil {
		return nil, nil
	}
	return &bounds{*minX, *minY, *maxX, *maxY}, nil
}

func (t *pgBoardTx) PurgeTargets(ctx context.Context, req PurgeRequest) ([]Object, error) {
	var rect Rect
	if req.Rect != nil {
		rect = *req.Rect
	}
	rows, err := t.tx.Query(ctx, `SELECT id, version, body FROM whiteboard_objects
		WHERE board_id = $1 AND ($2::uuid IS NULL OR created_by = $2::uuid)
		AND (NOT $3::boolean OR (x <= $4::double precision + $6::double precision
		AND x + w >= $4::double precision AND y <= $5::double precision + $7::double precision
		AND y + h >= $5::double precision))
		ORDER BY id LIMIT $8`, t.boardID, req.CreatedBy, req.Rect != nil,
		rect.X, rect.Y, rect.W, rect.H, MaxChangesPerCommand)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.PurgeTargets: %w", err)
	}
	defer rows.Close()
	var objects []Object
	for rows.Next() {
		var o Object
		if err := rows.Scan(&o.ID, &o.Version, &o.Body); err != nil {
			return nil, fmt.Errorf("whiteboard.BoardTx.PurgeTargets: scan: %w", err)
		}
		objects = append(objects, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whiteboard.BoardTx.PurgeTargets: rows: %w", err)
	}
	return objects, nil
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

const (
	insertObjectSQL = `INSERT INTO whiteboard_objects (id, board_id, version, body, created_by, x, y, w, h)
		 VALUES ($1, $2, $3, $4::jsonb,
		 (SELECT id FROM users WHERE id = ($4::jsonb->>'createdBy')::uuid),
		 ($4::jsonb->>'x')::double precision, ($4::jsonb->>'y')::double precision,
		 ($4::jsonb->>'w')::double precision, ($4::jsonb->>'h')::double precision)`
	updateObjectSQL = `UPDATE whiteboard_objects SET version = $1, body = $2::jsonb, updated_at = now(),
		 created_by = (SELECT id FROM users WHERE id = ($2::jsonb->>'createdBy')::uuid),
		 x = ($2::jsonb->>'x')::double precision, y = ($2::jsonb->>'y')::double precision,
		 w = ($2::jsonb->>'w')::double precision, h = ($2::jsonb->>'h')::double precision
		 WHERE id = $3 AND board_id = $4`
	deleteObjectSQL = `DELETE FROM whiteboard_objects WHERE id = $1 AND board_id = $2`
)

// ObjectWrite is one queued object mutation for BoardTx.WriteObjects.
type ObjectWrite struct {
	Action string // ActionCreate, ActionUpdate or ActionDelete
	Object Object // Delete uses Object.ID only
}

func insertResult(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrObjectIDTaken
	}
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.Insert: %w", err)
	}
	return nil
}

func rowResult(op, id string, tag pgconn.CommandTag, err error) error {
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.%s: %w", op, err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("whiteboard.BoardTx.%s: object %s vanished under lock", op, id)
	}
	return nil
}

func (t *pgBoardTx) Insert(ctx context.Context, o Object) error {
	_, err := t.tx.Exec(ctx, insertObjectSQL, o.ID, t.boardID, o.Version, []byte(o.Body))
	return insertResult(err)
}

func (t *pgBoardTx) Update(ctx context.Context, o Object) error {
	tag, err := t.tx.Exec(ctx, updateObjectSQL, o.Version, []byte(o.Body), o.ID, t.boardID)
	return rowResult("Update", o.ID, tag, err)
}

func (t *pgBoardTx) Delete(ctx context.Context, id string) error {
	tag, err := t.tx.Exec(ctx, deleteObjectSQL, id, t.boardID)
	return rowResult("Delete", id, tag, err)
}

// WriteObjects pipelines a command's writes: a 500-object paste was 500
// sequential round trips held under the board lock.
func (t *pgBoardTx) WriteObjects(ctx context.Context, writes []ObjectWrite) (err error) {
	if len(writes) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, w := range writes {
		o := w.Object
		switch w.Action {
		case ActionCreate:
			batch.Queue(insertObjectSQL, o.ID, t.boardID, o.Version, []byte(o.Body))
		case ActionUpdate:
			batch.Queue(updateObjectSQL, o.Version, []byte(o.Body), o.ID, t.boardID)
		case ActionDelete:
			batch.Queue(deleteObjectSQL, o.ID, t.boardID)
		default:
			return fmt.Errorf("whiteboard.BoardTx.WriteObjects: unknown action %q", w.Action)
		}
	}
	results := t.tx.SendBatch(ctx, batch)
	defer func() {
		if cerr := results.Close(); err == nil && cerr != nil {
			err = fmt.Errorf("whiteboard.BoardTx.WriteObjects: close: %w", cerr)
		}
	}()
	for _, w := range writes {
		tag, execErr := results.Exec()
		switch w.Action {
		case ActionCreate:
			err = insertResult(execErr)
		case ActionUpdate:
			err = rowResult("Update", w.Object.ID, tag, execErr)
		case ActionDelete:
			err = rowResult("Delete", w.Object.ID, tag, execErr)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (t *pgBoardTx) SetState(ctx context.Context, seq int64, count int, bytes int64) error {
	if _, err := t.tx.Exec(ctx,
		`UPDATE whiteboards SET seq = $1, object_count = $2, body_bytes = $3, updated_at = now() WHERE id = $4`,
		seq, count, bytes, t.boardID,
	); err != nil {
		return fmt.Errorf("whiteboard.BoardTx.SetState: %w", err)
	}
	t.seq, t.count, t.bodyBytes = seq, count, bytes
	return nil
}
