package whiteboard

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func objectTotals(t *testing.T, objects map[string]Object) (int, int64) {
	t.Helper()
	var size int64
	for _, o := range objects {
		body, err := canonicalStoredBody(o.Body)
		require.NoError(t, err)
		size += int64(len(body))
	}
	return len(objects), size
}

func assertCounters(t *testing.T, h *harness) {
	t.Helper()
	count, size := objectTotals(t, h.repo.objects)
	assert.Equal(t, count, h.repo.objectCount)
	assert.Equal(t, size, h.repo.bodyBytes)
}

func TestIncrementalCounters(t *testing.T) {
	h := newHarness()
	a, b, c := h.uuid(), h.uuid(), h.uuid()
	body := rectBody(a)
	body["x"] = 1e-7 // JSONB expands this; accounting must remain canonical.
	_, err := h.run(createChange(a, body), createChange(b, rectBody(b)))
	require.NoError(t, err)
	assertCounters(t, h)

	// Mimic JSONB whitespace and numeric spelling on just the touched object.
	o := h.repo.objects[a]
	o.Body = json.RawMessage(strings.ReplaceAll(string(o.Body), `"x":1e-7`, `"x": 0.0000001`))
	h.repo.objects[a] = o
	_, err = h.run(updateChange(a, 1, m{"x": 99999}), deleteChange(b, 1), createChange(c, rectBody(c)))
	require.NoError(t, err)
	assert.Equal(t, 2, h.repo.objectCount)
	assertCounters(t, h)

	_, err = h.run(updateChange(a, 2, m{"x": 0})) // negative byte delta
	require.NoError(t, err)
	assertCounters(t, h)
	_, err = h.run(deleteChange(a, 3), deleteChange(c, 2))
	require.NoError(t, err)
	assertCounters(t, h)
	assert.Zero(t, h.repo.bodyBytes)
}

func TestCountersRollBackWithFailedCommit(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	before := h.repo.bodyBytes
	h.repo.failCommit = errors.New("commit failed")
	_, err = h.run(updateChange(id, 1, m{"x": 99999}))
	assert.Equal(t, 500, httpCode(t, err))
	assert.EqualValues(t, 1, h.repo.seq)
	assert.Equal(t, before, h.repo.bodyBytes)
	assertCounters(t, h)
}

func TestQuotaCounterThresholds(t *testing.T) {
	for _, quota := range []string{"count", "bytes"} {
		t.Run(quota, func(t *testing.T) {
			h := newHarness()
			id := h.uuid()
			body, err := validateCreateBody(raw(rectBody(id)), id, userID)
			require.NoError(t, err)
			stored, err := body.marshal()
			require.NoError(t, err)
			// Repository-boundary totals stand for the untouched objects. An
			// unrelated body need not even be decodable by this command.
			h.repo.objects[h.uuid()] = Object{Body: json.RawMessage(`invalid`)}
			if quota == "count" {
				h.repo.objectCount = MaxObjectsPerBoard - 1
			} else {
				h.repo.objectCount = 1
				h.repo.bodyBytes = MaxBoardBytes - int64(len(stored))
			}
			_, err = h.run(createChange(id, rectBody(id)))
			require.NoError(t, err, "exact threshold is accepted")
			beforeCount, beforeBytes := h.repo.objectCount, h.repo.bodyBytes
			if quota == "count" {
				assert.Equal(t, MaxObjectsPerBoard, beforeCount)
			} else {
				assert.EqualValues(t, MaxBoardBytes, beforeBytes)
			}
			other := h.uuid()
			_, err = h.run(createChange(other, rectBody(other)))
			assert.Equal(t, 413, httpCode(t, err))
			if quota == "bytes" {
				_, err = h.run(updateChange(id, 1, m{"x": 100})) // one byte over
				assert.Equal(t, 413, httpCode(t, err))
			}
			assert.Equal(t, beforeCount, h.repo.objectCount)
			assert.Equal(t, beforeBytes, h.repo.bodyBytes)
			assert.EqualValues(t, 1, h.repo.seq)
			// Check the final net delta, not an intermediate over-quota state.
			_, err = h.run(createChange(other, rectBody(other)), deleteChange(id, 1))
			require.NoError(t, err)
			assert.Equal(t, beforeCount, h.repo.objectCount)
			assert.Equal(t, beforeBytes, h.repo.bodyBytes)
		})
	}
}

func TestCachedTotalsDoNotQueryObjects(t *testing.T) {
	// A nil transaction would panic if Totals attempted any query.
	tx := &pgBoardTx{count: 1234, bodyBytes: 5678}
	count, size, err := tx.Totals(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1234, count)
	assert.EqualValues(t, 5678, size)
}

func TestCommandByteCap(t *testing.T) {
	for name, excess := range map[string]int{"exact limit": 0, "one byte over": 1} {
		t.Run(name, func(t *testing.T) {
			h := newHarness()
			id, other := h.uuid(), h.uuid()
			_, err := h.run(createChange(id, rectBody(id)))
			require.NoError(t, err)
			create := createChange(other, rectBody(other))
			update := updateChange(id, 1, m{"x": 123})
			// Raw JSON whitespace counts, but does not inflate the stored object.
			padding := MaxCommandBytes + excess - len(create.Body) - len(update.Patch)
			create.Body = json.RawMessage("{" + strings.Repeat(" ", padding) + string(create.Body[1:]))
			req := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{create, update}}
			if excess == 0 {
				_, err = h.svc.Execute(context.Background(), userID, chID, req)
				require.NoError(t, err)
				assertCounters(t, h)
				return
			}
			// Oversized commands must return without waiting on the board mutex.
			unlock := h.svc.locks.lock(chID)
			defer unlock()
			done := make(chan error, 1)
			go func() {
				_, err := h.svc.Execute(context.Background(), userID, chID, req)
				done <- err
			}()
			select {
			case err = <-done:
				assert.Equal(t, 413, httpCode(t, err))
				assert.EqualError(t, err, "command bodies and patches exceed 1048576 bytes")
			case <-time.After(time.Second):
				t.Fatal("oversized command waited for the board lock")
			}
			assert.Equal(t, 1, h.repo.commitCalls)
			assertCounters(t, h)
		})
	}
}
