package whiteboard

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type counterTx struct {
	pgx.Tx
	mock.Mock
}

func (t *counterTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	a := t.Called(ctx, sql, args)
	return a.Get(0).(pgx.Rows), a.Error(1)
}

func (t *counterTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	a := t.Called(ctx, sql, args)
	return pgconn.NewCommandTag("UPDATE 1"), a.Error(0)
}

type bodyRows struct {
	pgx.Rows
	bodies [][]byte
	index  int
	closed bool
}

func (r *bodyRows) Next() bool { r.index++; return r.index <= len(r.bodies) }
func (r *bodyRows) Scan(dest ...any) error {
	*dest[0].(*[]byte) = r.bodies[r.index-1]
	return nil
}
func (r *bodyRows) Err() error { return nil }
func (r *bodyRows) Close()     { r.closed = true }

func TestLegacyTotalsRecomputeCanonicalBytesAndPersist(t *testing.T) {
	ctx := context.Background()
	db := &counterTx{}
	defer db.AssertExpectations(t)
	// JSONB spelling differs from compact Go JSON in number format, key order,
	// whitespace, HTML escaping and UTF-8; SQL octet_length(body::text) is wrong.
	rows := &bodyRows{bodies: [][]byte{
		[]byte(`{"x": 0.0000001, "text": "<>&é", "kind": "text"}`),
		[]byte(`{"kind": "rect", "x": 10.000}`),
	}}
	const size = len(`{"kind":"text","text":"\u003c\u003e\u0026é","x":1e-7}`) + len(`{"kind":"rect","x":10}`)
	db.On("Query", ctx, "SELECT body FROM whiteboard_objects WHERE board_id = $1", []any{chID}).Return(rows, nil).Once()
	tx := &pgBoardTx{tx: db, boardID: chID, seq: 5, count: 2, bodyBytes: -1}
	for i := 0; i < 2; i++ {
		count, bytes, err := tx.Totals(ctx)
		require.NoError(t, err)
		assert.Equal(t, 2, count)
		assert.EqualValues(t, size, bytes)
	}
	assert.True(t, rows.closed)

	db.On("Exec", ctx,
		"UPDATE whiteboards SET seq = $1, object_count = $2, body_bytes = $3, updated_at = now() WHERE id = $4",
		[]any{int64(6), 3, int64(size + 100), chID}).Return(nil).Once()
	require.NoError(t, tx.SetState(ctx, 6, 3, int64(size+100)))
	count, bytes, err := tx.Totals(ctx)
	require.NoError(t, err)
	assert.Equal(t, 3, count)
	assert.EqualValues(t, size+100, bytes)
	assert.EqualValues(t, 6, tx.Seq())
}
