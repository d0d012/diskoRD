package whiteboard

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type geometryTx struct{ counterTx }

func (t *geometryTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.Called(ctx, sql, args).Get(0).(pgx.Row)
}

type scanRow func(...any) error

func (r scanRow) Scan(dest ...any) error { return r(dest...) }

func TestRepositoryWritesMirrorBody(t *testing.T) {
	ctx := context.Background()
	for _, action := range []string{ActionCreate, ActionUpdate} {
		t.Run(action, func(t *testing.T) {
			db := &counterTx{}
			defer db.AssertExpectations(t)
			o := Object{ID: userID, Version: 7, Body: raw(m{"createdBy": userID, "x": -12, "y": 34, "w": 56, "h": 78})}
			// Values come directly from the very JSONB written in this statement.
			// The user lookup also leaves orphaned/deleted authors NULL on update.
			param := "$4"
			args := []any{o.ID, chID, o.Version, []byte(o.Body)}
			if action == ActionUpdate {
				param = "$2"
				args = []any{o.Version, []byte(o.Body), o.ID, chID}
			}
			db.On("Exec", ctx, mock.MatchedBy(func(sql string) bool {
				assert.Contains(t, sql, "created_by")
				assert.Contains(t, sql, "(SELECT id FROM users WHERE id = ("+param+"::jsonb->>'createdBy')::uuid)")
				for _, field := range []string{"x", "y", "w", "h"} {
					assert.Contains(t, sql, "("+param+"::jsonb->>'"+field+"')::double precision")
				}
				return true
			}), args).Return(nil).Once()
			tx := &pgBoardTx{tx: db, boardID: chID}
			if action == ActionCreate {
				require.NoError(t, tx.Insert(ctx, o))
			} else {
				require.NoError(t, tx.Update(ctx, o))
			}
		})
	}
}

func TestRepositoryAuthorCountExcludesDeletesOnThisBoard(t *testing.T) {
	ctx := context.Background()
	db := &geometryTx{}
	defer db.AssertExpectations(t)
	deleted := []string{guild}
	db.On("QueryRow", ctx, mock.MatchedBy(func(sql string) bool {
		return strings.Contains(sql, "board_id = $1 AND created_by = $2") &&
			strings.Contains(sql, "NOT (id = ANY($3::text[]::uuid[]))")
	}), []any{chID, userID, deleted}).Return(scanRow(func(dest ...any) error {
		*dest[0].(*int) = 1499
		return nil
	})).Once()
	count, err := (&pgBoardTx{tx: db, boardID: chID}).CountByAuthor(ctx, userID, deleted)
	require.NoError(t, err)
	assert.Equal(t, 1499, count)
}

func TestRepositoryBounds(t *testing.T) {
	for _, empty := range []bool{false, true} {
		t.Run(map[bool]string{true: "empty", false: "aggregate"}[empty], func(t *testing.T) {
			ctx := context.Background()
			db := &geometryTx{}
			defer db.AssertExpectations(t)
			excluded := []string{userID, guild}
			db.On("QueryRow", ctx, mock.MatchedBy(func(sql string) bool {
				return strings.Contains(sql, "SELECT min(x), min(y), max(x + w), max(y + h)") &&
					strings.Contains(sql, "board_id = $1") && strings.Contains(sql, "NOT (id = ANY($2::text[]::uuid[]))")
			}), []any{chID, excluded}).Return(scanRow(func(dest ...any) error {
				if !empty {
					for i, v := range []float64{-1, -2, 100, 200} {
						v := v
						*dest[i].(**float64) = &v
					}
				}
				return nil
			})).Once()
			b, err := (&pgBoardTx{tx: db, boardID: chID}).Bounds(ctx, excluded)
			require.NoError(t, err)
			if empty {
				assert.Nil(t, b)
			} else {
				assert.Equal(t, &bounds{-1, -2, 100, 200}, b)
			}
		})
	}
}

func TestRepositoryPurgeFiltersAndChunkLimit(t *testing.T) {
	for _, req := range []PurgeRequest{
		{CreatedBy: strptr(userID)},
		{Rect: &Rect{X: -10, Y: 20, W: 30, H: 40}},
		{CreatedBy: strptr(userID), Rect: &Rect{X: -10, Y: 20, W: 30, H: 40}},
	} {
		ctx := context.Background()
		db := &counterTx{}
		rows := &bodyRows{}
		r := Rect{}
		if req.Rect != nil {
			r = *req.Rect
		}
		db.On("Query", ctx, mock.MatchedBy(func(sql string) bool {
			return strings.Contains(sql, "board_id = $1 AND ($2::uuid IS NULL OR created_by = $2::uuid)") &&
				strings.Contains(sql, "AND (NOT $3::boolean OR (x <=") &&
				strings.Contains(sql, "AND x + w >=") && strings.Contains(sql, "AND y + h >=") &&
				strings.Contains(sql, "ORDER BY id LIMIT $8")
		}), []any{chID, req.CreatedBy, req.Rect != nil, r.X, r.Y, r.W, r.H, MaxChangesPerCommand}).Return(rows, nil).Once()
		objects, err := (&pgBoardTx{tx: db, boardID: chID}).PurgeTargets(ctx, req)
		require.NoError(t, err)
		assert.Empty(t, objects)
		assert.True(t, rows.closed)
		db.AssertExpectations(t)
	}
}

func TestRepositoryGeometryQueryErrors(t *testing.T) {
	ctx := context.Background()
	db := &geometryTx{}
	defer db.AssertExpectations(t)
	failure := errors.New("database unavailable")
	db.On("QueryRow", ctx, mock.Anything, mock.Anything).Return(scanRow(func(...any) error { return failure })).Twice()
	tx := &pgBoardTx{tx: db, boardID: chID}
	_, err := tx.Bounds(ctx, nil)
	assert.ErrorIs(t, err, failure)
	_, err = tx.CountByAuthor(ctx, userID, nil)
	assert.ErrorIs(t, err, failure)
}
