package whiteboard

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func (t *fakeTx) CountByAuthor(_ context.Context, userID string, excludeIDs []string) (int, error) {
	t.repo.authorQueries++
	excluded := map[string]bool{}
	for _, id := range excludeIDs {
		excluded[id] = true
	}
	count := 0
	for id, o := range t.objects {
		var b struct{ CreatedBy string }
		// Some existing counter tests represent unrelated rows with opaque
		// bodies. Their author/geometry columns are absent in this fake.
		_ = json.Unmarshal(o.Body, &b)
		if !excluded[id] && b.CreatedBy == userID {
			count++
		}
	}
	return count, nil
}

func (t *fakeTx) Bounds(_ context.Context, excludeIDs []string) (*bounds, error) {
	t.repo.boundsQueries++
	excluded := map[string]bool{}
	for _, id := range excludeIDs {
		excluded[id] = true
	}
	var out *bounds
	for id, o := range t.objects {
		if excluded[id] {
			continue
		}
		var rect Rect
		if json.Unmarshal(o.Body, &rect) == nil {
			out = extendBounds(out, rect)
		}
	}
	return out, nil
}

func seedObjects(t *testing.T, h *harness, count int, author string, rect Rect) []string {
	t.Helper()
	ids := make([]string, count)
	for i := range ids {
		id := h.uuid()
		ids[i] = id
		body := rectBody(id)
		delete(body, "id")
		delete(body, "version")
		body["createdBy"] = author
		body["x"], body["y"], body["w"], body["h"] = rect.X, rect.Y, rect.W, rect.H
		h.repo.objects[id] = Object{ID: id, Version: 1, Body: raw(body)}
	}
	h.repo.seq = 1
	h.repo.objectCount, h.repo.bodyBytes = objectTotals(t, h.repo.objects)
	return ids
}

func TestPerUserQuota(t *testing.T) {
	for _, tc := range []struct {
		name                            string
		owned, deletes, creates, status int
	}{
		{"1500 allowed", 1499, 0, 1, 200},
		{"1501 rejected", 1500, 0, 1, 413},
		{"own deletes free room", 1500, 1, 1, 200},
		{"net creates still exceed", 1500, 1, 2, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness()
			ids := seedObjects(t, h, tc.owned, userID, Rect{W: 100, H: 100})
			// Other users' objects on this board do not consume our quota.
			seedObjects(t, h, 3, guild, Rect{W: 100, H: 100})
			var changes []ChangeRequest
			for i := 0; i < tc.creates; i++ {
				id := h.uuid()
				changes = append(changes, createChange(id, rectBody(id)))
			}
			for _, id := range ids[:tc.deletes] {
				changes = append(changes, deleteChange(id, 1))
			}
			_, err := h.run(changes...)
			if tc.status == 200 {
				require.NoError(t, err)
				assert.Equal(t, tc.owned-tc.deletes+tc.creates+3, h.repo.objectCount)
			} else {
				assert.Equal(t, tc.status, httpCode(t, err))
				assert.EqualError(t, err, "you can hold at most 1500 objects on a board")
				assert.Equal(t, tc.owned+3, h.repo.objectCount)
				assert.Empty(t, h.pub.payloads)
			}
			assertCounters(t, h)
			assert.Equal(t, 1, h.repo.authorQueries)
		})
	}
	t.Run("deleting another author does not free room", func(t *testing.T) {
		h := newHarness()
		seedObjects(t, h, 1500, userID, Rect{W: 100, H: 100})
		other := seedObjects(t, h, 1, guild, Rect{W: 100, H: 100})[0]
		id := h.uuid()
		_, err := h.run(deleteChange(other, 1), createChange(id, rectBody(id)))
		assert.Equal(t, 413, httpCode(t, err))
		assertCounters(t, h)
	})
	t.Run("no count query without creates", func(t *testing.T) {
		h := newHarness()
		ids := seedObjects(t, h, 1501, userID, Rect{W: 100, H: 100})
		_, err := h.run(updateChange(ids[0], 1, m{"x": 1}), deleteChange(ids[1], 1))
		require.NoError(t, err)
		assert.Zero(t, h.repo.authorQueries)
		assertCounters(t, h)
	})
}

func TestPlacement(t *testing.T) {
	for _, tc := range []struct {
		name   string
		rect   Rect
		status int
	}{
		{"right edge inclusive", Rect{X: 50000, W: 100, H: 100}, 200},
		{"left edge inclusive", Rect{X: -50000, Y: -50000, W: 100, H: 100}, 200},
		{"right extent outside", Rect{X: 500001, W: 100, H: 100}, 422},
		{"left outside", Rect{X: -500001, W: 100, H: 100}, 422},
		{"top outside", Rect{Y: -500001, W: 100, H: 100}, 422},
		{"bottom extent outside", Rect{Y: 50000, W: 100, H: 101}, 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness()
			seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
			id := h.uuid()
			body := rectBody(id)
			body["x"], body["y"], body["w"], body["h"] = tc.rect.X, tc.rect.Y, tc.rect.W, tc.rect.H
			_, err := h.run(createChange(id, body))
			if tc.status == 200 {
				require.NoError(t, err)
			} else {
				assert.Equal(t, 422, httpCode(t, err))
				assert.EqualError(t, err, "too far from existing content")
				assert.Len(t, h.repo.objects, 1)
				assert.Empty(t, h.pub.payloads)
			}
			assertCounters(t, h)
		})
	}
	t.Run("empty board allows anything", func(t *testing.T) {
		h := newHarness()
		id := h.uuid()
		body := rectBody(id)
		body["x"], body["y"] = maxCoord, -maxCoord
		_, err := h.run(createChange(id, body))
		require.NoError(t, err)
	})
	t.Run("move far away rejects entire command", func(t *testing.T) {
		h := newHarness()
		ids := seedObjects(t, h, 3, userID, Rect{W: 100, H: 100})
		_, err := h.run(updateChange(ids[0], 1, m{"x": 99999}), deleteChange(ids[1], 1))
		assert.Equal(t, 422, httpCode(t, err))
		assert.Len(t, h.repo.objects, 3)
		assertCounters(t, h)
	})
	t.Run("deletes and unchanged geometry never checked", func(t *testing.T) {
		h := newHarness()
		seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
		ids := seedObjects(t, h, 2, guild, Rect{X: 99999, W: 100, H: 100})
		_, err := h.run(updateChange(ids[0], 1, m{"x": 99999, "style": m{"colour": "red", "weight": "thin", "fill": "none"}}), deleteChange(ids[1], 1))
		require.NoError(t, err)
		assert.Zero(t, h.repo.boundsQueries)
		assert.Zero(t, h.repo.authorQueries)
		assertCounters(t, h)
	})
	t.Run("command touching every object allowed", func(t *testing.T) {
		h := newHarness()
		ids := seedObjects(t, h, 2, userID, Rect{W: 100, H: 100})
		_, err := h.run(updateChange(ids[0], 1, m{"x": 99999}), deleteChange(ids[1], 1))
		require.NoError(t, err)
		assertCounters(t, h)
	})
	t.Run("new content cannot bridge to empty space", func(t *testing.T) {
		h := newHarness()
		seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
		a, b := h.uuid(), h.uuid()
		near, far := rectBody(a), rectBody(b)
		near["x"], far["x"] = 50000, 100000
		_, err := h.run(createChange(a, near), createChange(b, far))
		assert.Equal(t, 422, httpCode(t, err))
		assertCounters(t, h)
	})
}
