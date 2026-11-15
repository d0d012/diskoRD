package whiteboard

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func (t *fakeTx) PurgeTargets(_ context.Context, req PurgeRequest) ([]Object, error) {
	ids := make([]string, 0, len(t.objects))
	for id := range t.objects {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var out []Object
	for _, id := range ids {
		o := t.objects[id]
		var author struct{ CreatedBy string }
		if err := json.Unmarshal(o.Body, &author); err != nil {
			return nil, err
		}
		if req.CreatedBy != nil && author.CreatedBy != *req.CreatedBy {
			continue
		}
		if req.Rect != nil {
			var rect Rect
			if err := json.Unmarshal(o.Body, &rect); err != nil {
				return nil, err
			}
			r := req.Rect
			if r.X > rect.X+rect.W || r.X+r.W < rect.X || r.Y > rect.Y+rect.H || r.Y+r.H < rect.Y {
				continue
			}
		}
		out = append(out, o)
		if len(out) == MaxChangesPerCommand {
			break
		}
	}
	return out, nil
}

func setRole(h *harness, role string) {
	h.svc.members = fakeRoleMembers{fakeMembers{true}, role}
}

func TestPurgeFilters(t *testing.T) {
	for _, tc := range []struct {
		name    string
		req     PurgeRequest
		deleted int
	}{
		{"author", PurgeRequest{CreatedBy: strptr(userID)}, 2},
		{"rect", PurgeRequest{Rect: &Rect{X: 100, Y: 100, W: 0, H: 0}}, 2},
		{"both", PurgeRequest{CreatedBy: strptr(userID), Rect: &Rect{X: 100, Y: 100, W: 0, H: 0}}, 1},
		{"no matches", PurgeRequest{CreatedBy: strptr(chID)}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness()
			setRole(h, "admin")
			seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
			seedObjects(t, h, 1, guild, Rect{W: 100, H: 100})
			seedObjects(t, h, 1, userID, Rect{X: 99999, W: 100, H: 100})
			seedObjects(t, h, 1, guild, Rect{X: 99999, W: 100, H: 100})
			status, body := do(t, testApp(h, true), "POST", "/channels/"+chID+"/board/purge", string(raw(tc.req)))
			assert.Equal(t, http.StatusOK, status)
			assert.Equal(t, map[string]any{"data": map[string]any{"deleted": float64(tc.deleted)}}, body)
			assert.Len(t, h.repo.objects, 4-tc.deleted)
			assertCounters(t, h)
			assert.Zero(t, h.repo.authorQueries)
			assert.Zero(t, h.repo.boundsQueries)
			if tc.deleted > 0 {
				require.Len(t, h.pub.payloads, 1)
				assert.Len(t, h.pub.payloads[0].Changes, tc.deleted)
			} else {
				assert.Empty(t, h.pub.payloads)
				assert.Empty(t, h.ops.records)
				assert.EqualValues(t, 1, h.repo.seq)
			}
		})
	}
}

func strptr(s string) *string { return &s }

func TestPurgeAuthorization(t *testing.T) {
	for _, role := range []string{"owner", "admin", "moderator", "member"} {
		t.Run(role, func(t *testing.T) {
			h := newHarness()
			setRole(h, role)
			seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
			status, body := do(t, testApp(h, true), "POST", "/channels/"+chID+"/board/purge", `{"createdBy":"`+userID+`"}`)
			if role == "admin" || role == "owner" {
				assert.Equal(t, 200, status)
			} else {
				assert.Equal(t, 403, status)
				assert.Equal(t, "only admins and owners can manage channels", body["error"])
				assert.Len(t, h.repo.objects, 1)
				assert.Zero(t, h.repo.commitCalls)
			}
		})
	}
	h := newHarness()
	status, _ := do(t, testApp(h, false), "POST", "/channels/"+chID+"/board/purge", `{"createdBy":"`+userID+`"}`)
	assert.Equal(t, 403, status)
}

func TestPurgeInvalidRequests(t *testing.T) {
	for _, body := range []string{
		`{}`, `{"createdBy":null,"rect":null}`, `{"createdBy":""}`, `{"createdBy":"not-a-uuid"}`,
		`{"rect":{}}`, `{"rect":{"x":null,"y":0,"w":1,"h":1}}`,
		`{"rect":{"x":0,"y":0,"w":-1,"h":1}}`,
		`{"rect":{"x":0,"y":0,"w":1,"h":"1"}}`,
		`{"rect":{"x":1e999,"y":0,"w":1,"h":1}}`,
		`{"rect":{"x":1e308,"y":0,"w":1e308,"h":1}}`,
	} {
		t.Run(body, func(t *testing.T) {
			h := newHarness()
			setRole(h, "owner")
			status, out := do(t, testApp(h, true), "POST", "/channels/"+chID+"/board/purge", body)
			assert.Equal(t, 400, status)
			assert.NotEmpty(t, out["error"])
			assert.Zero(t, h.repo.commitCalls)
		})
	}
}

func TestPurgeChunksUseNormalCommitPath(t *testing.T) {
	h := newHarness()
	setRole(h, "owner")
	seedObjects(t, h, 1201, userID, Rect{W: 100, H: 100})
	keep := seedObjects(t, h, 2, guild, Rect{W: 100, H: 100})
	result, err := h.svc.Purge(context.Background(), userID, chID, PurgeRequest{CreatedBy: strptr(userID)})
	require.NoError(t, err)
	assert.Equal(t, 1201, result.Deleted)
	assert.Len(t, h.repo.objects, 2)
	for _, id := range keep {
		assert.Contains(t, h.repo.objects, id)
	}
	assert.EqualValues(t, 4, h.repo.seq)
	assert.Equal(t, 3, h.repo.commits)
	assertCounters(t, h)
	require.Len(t, h.pub.payloads, 3)
	assert.Len(t, h.ops.records, 3)
	for i, payload := range h.pub.payloads {
		want := 500
		if i == 2 {
			want = 201
		}
		assert.Len(t, payload.Changes, want)
		assert.EqualValues(t, i+2, payload.Seq)
		assert.Equal(t, userID, payload.UserID)
		record := h.ops.records[payload.OpID]
		assert.Equal(t, chID, record.ChannelID)
		assert.Equal(t, userID, record.UserID)
		for _, change := range payload.Changes {
			assert.Equal(t, ActionDelete, change.Action)
			assert.Equal(t, payload.Seq, change.Version)
		}
		// Echoing a generated command's opId returns the cached result and
		// does not delete again, advance counters, or republish.
		changes := make([]ChangeRequest, len(payload.Changes))
		for j, c := range payload.Changes {
			changes[j] = deleteChange(c.ID, 1)
		}
		cached, err := h.svc.Execute(context.Background(), userID, chID, CommandRequest{OpID: payload.OpID, Changes: changes})
		require.NoError(t, err)
		assert.Equal(t, record.Result, *cached)
	}
	assert.Len(t, h.pub.payloads, 3)
	assertCounters(t, h)
}

func TestPurgeClearsCounters(t *testing.T) {
	for _, count := range []int{MaxChangesPerCommand, MaxChangesPerCommand + 1} {
		h := newHarness()
		setRole(h, "admin")
		seedObjects(t, h, count, userID, Rect{X: 99999, W: 100, H: 100})
		result, err := h.svc.Purge(context.Background(), userID, chID, PurgeRequest{CreatedBy: strptr(userID)})
		require.NoError(t, err)
		assert.Equal(t, count, result.Deleted)
		assert.Empty(t, h.repo.objects)
		assert.Zero(t, h.repo.objectCount)
		assert.Zero(t, h.repo.bodyBytes)
		assertCounters(t, h)
		assert.Len(t, h.pub.payloads, (count+MaxChangesPerCommand-1)/MaxChangesPerCommand)
	}
}

func TestPurgeRateLimitIndependentFromOps(t *testing.T) {
	for _, limit := range []string{"commands", "bytes"} {
		t.Run(limit, func(t *testing.T) {
			h := newHarness()
			setRole(h, "owner")
			seedObjects(t, h, 1, userID, Rect{W: 100, H: 100})
			app := testApp(h, true)
			opsPath, purgePath := "/channels/"+chID+"/board/ops", "/channels/"+chID+"/board/purge"
			if limit == "commands" {
				for i := 0; i < CommandBurst; i++ {
					status, _ := do(t, app, "POST", opsPath, `{}`)
					require.Equal(t, 400, status)
				}
			} else {
				status, _ := do(t, app, "POST", opsPath, strings.Repeat(" ", CommandByteBurst-2)+`{}`)
				require.Equal(t, 400, status)
			}
			status, _ := do(t, app, "POST", opsPath, strings.Repeat(" ", MaxCommandBytes)+`{}`)
			require.Equal(t, 429, status)
			status, body := do(t, app, "POST", purgePath, `{"createdBy":"`+userID+`"}`)
			assert.Equal(t, 200, status)
			assert.Equal(t, map[string]any{"deleted": float64(1)}, body["data"])
			assertCounters(t, h)
		})
	}
}

func TestPurgeLimiter(t *testing.T) {
	h := newHarness()
	setRole(h, "admin")
	app := testApp(h, true)
	path, body := "/channels/"+chID+"/board/purge", `{"createdBy":"`+userID+`"}`
	for i := 0; i < PurgeBurst; i++ {
		status, _ := do(t, app, "POST", path, body)
		require.Equal(t, 200, status)
	}
	status, out, headers := doWithHeaders(t, app, "POST", path, body)
	assert.Equal(t, 429, status)
	assert.Equal(t, "too many board purges", out["error"])
	assert.Equal(t, "2", headers.Get("Retry-After"))

	now := time.Unix(0, 0)
	l := newPurgeLimiter()
	l.now = func() time.Time { return now }
	for i := 0; i < PurgeBurst; i++ {
		assert.Zero(t, l.take(userID, 1))
	}
	assert.Equal(t, 2, l.take(userID, 1))
	now = now.Add(PurgeRefillInterval)
	assert.Zero(t, l.take(userID, 1))
	assert.Equal(t, 2, l.take(userID, 1))
	assert.Zero(t, l.take(guild, 1), "per-user buckets")
}
