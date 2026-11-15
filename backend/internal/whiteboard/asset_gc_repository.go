package whiteboard

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

const orphanAssetPredicate = `a.updated_at < now() - interval '24 hours' AND NOT EXISTS (
 SELECT 1 FROM whiteboard_objects o WHERE o.board_id=a.board_id
 AND o.body->>'kind'='image' AND o.body->>'assetId'=a.id::text)`

func stringRows(rows pgx.Rows, err error, site string) ([]string, error) {
	if err != nil {
		return nil, fmt.Errorf("%s: %w", site, err)
	}
	defer rows.Close()
	values, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("%s: %w", site, err)
	}
	return values, nil
}

func (r *PgRepository) OrphanAssetBoards(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT a.board_id::text FROM whiteboard_assets a WHERE `+orphanAssetPredicate+` LIMIT 100`)
	return stringRows(rows, err, "whiteboard.Repository.OrphanAssetBoards")
}

func (r *PgRepository) ExistingAssetKeys(ctx context.Context, keys []string) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT storage_key FROM whiteboard_assets WHERE storage_key = ANY($1::text[])`, keys)
	return stringRows(rows, err, "whiteboard.Repository.ExistingAssetKeys")
}

func (t *pgBoardTx) TouchAssets(ctx context.Context, ids []string) error {
	_, err := t.tx.Exec(ctx, `UPDATE whiteboard_assets SET updated_at = now() WHERE board_id=$1 AND id = ANY($2::text[]::uuid[])`, t.boardID, ids)
	if err != nil {
		return fmt.Errorf("whiteboard.BoardTx.TouchAssets: %w", err)
	}
	return nil
}

func (t *pgBoardTx) DeleteOrphanAssets(ctx context.Context) ([]string, error) {
	rows, err := t.tx.Query(ctx, `DELETE FROM whiteboard_assets a WHERE a.board_id=$1 AND `+orphanAssetPredicate+` RETURNING storage_key`, t.boardID)
	return stringRows(rows, err, "whiteboard.BoardTx.DeleteOrphanAssets")
}
