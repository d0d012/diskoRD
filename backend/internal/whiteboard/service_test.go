package whiteboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/d0d012/diskord/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	chID   = "11111111-1111-4111-8111-111111111111"
	userID = "22222222-2222-4222-8222-222222222222"
	guild  = "33333333-3333-4333-8333-333333333333"
)

// fakeRepo is an in-memory Repository with transactional semantics: Commit
// works on a copy and keeps it only when fn succeeds.
type fakeRepo struct {
	channels      map[string]*ChannelInfo
	seq           int64
	objectCount   int
	bodyBytes     int64
	commitCalls   int
	snapshots     int
	objects       map[string]Object
	assets        map[string]Asset
	commits       int
	failNext      error
	failAsset     error
	failCommit    error
	authorQueries int
	boundsQueries int
	touched       []string
	orphanKeys    []string
	beforeCommit  func()
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		channels: map[string]*ChannelInfo{chID: {ID: chID, GuildID: guild, Type: ChannelTypeWhiteboard}},
		objects:  map[string]Object{},
		assets:   map[string]Asset{},
	}
}

func (r *fakeRepo) GetChannel(_ context.Context, id string) (*ChannelInfo, error) {
	ch, ok := r.channels[id]
	if !ok {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel not found")
	}
	return ch, nil
}

func (r *fakeRepo) CurrentSeq(context.Context, string) (int64, error) { return r.seq, nil }

func (r *fakeRepo) Snapshot(_ context.Context, _ string) (int64, []Object, error) {
	r.snapshots++
	out := []Object{}
	for _, o := range r.objects {
		out = append(out, o)
	}
	return r.seq, out, nil
}

func (r *fakeRepo) Commit(ctx context.Context, boardID string, fn func(context.Context, BoardTx) error) error {
	r.commitCalls++
	if r.failNext != nil {
		err := r.failNext
		r.failNext = nil
		return err
	}
	tx := &fakeTx{repo: r, seq: r.seq, count: r.objectCount, bodyBytes: r.bodyBytes, boardID: boardID,
		objects: map[string]Object{}, assets: map[string]Asset{}, failAsset: r.failAsset}
	for k, v := range r.objects {
		tx.objects[k] = v
	}
	for k, v := range r.assets {
		tx.assets[k] = v
	}
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if r.beforeCommit != nil {
		r.beforeCommit()
	}
	if r.failCommit != nil {
		return r.failCommit
	}
	r.seq, r.objects, r.assets = tx.seq, tx.objects, tx.assets
	r.objectCount, r.bodyBytes = tx.count, tx.bodyBytes
	r.commits++
	return nil
}

type fakeTx struct {
	repo      *fakeRepo
	seq       int64
	count     int
	bodyBytes int64
	objects   map[string]Object
	assets    map[string]Asset
	boardID   string
	failAsset error
}

func (t *fakeTx) Seq() int64 { return t.seq }
func (t *fakeTx) Objects(_ context.Context, ids []string) (map[string]Object, error) {
	out := map[string]Object{}
	for _, id := range ids {
		if o, ok := t.objects[id]; ok {
			out[id] = o
		}
	}
	return out, nil
}
func (t *fakeTx) Totals(context.Context) (int, int64, error) {
	return t.count, t.bodyBytes, nil
}
func (t *fakeTx) Assets(_ context.Context, ids []string) (map[string]Asset, error) {
	out := map[string]Asset{}
	for _, id := range ids {
		if a, ok := t.assets[id]; ok && a.BoardID == t.boardID {
			out[id] = a
		}
	}
	return out, nil
}
func (t *fakeTx) ReferencedAssets(_ context.Context, excludeIDs []string) ([]string, error) {
	excluded := map[string]bool{}
	for _, id := range excludeIDs {
		excluded[id] = true
	}
	var refs []string
	for _, o := range t.objects {
		if excluded[o.ID] {
			continue
		}
		var b struct {
			Kind    string
			AssetID string
		}
		if err := json.Unmarshal(o.Body, &b); err != nil {
			return nil, err
		}
		if b.Kind == "image" {
			refs = append(refs, b.AssetID)
		}
	}
	return dedupe(refs), nil
}
func (t *fakeTx) InsertAsset(_ context.Context, a Asset) error {
	if t.failAsset != nil {
		return t.failAsset
	}
	t.assets[a.ID] = a
	return nil
}
func (t *fakeTx) Insert(_ context.Context, o Object) error  { t.objects[o.ID] = o; return nil }
func (t *fakeTx) Update(_ context.Context, o Object) error  { t.objects[o.ID] = o; return nil }
func (t *fakeTx) Delete(_ context.Context, id string) error { delete(t.objects, id); return nil }
func (t *fakeTx) WriteObjects(ctx context.Context, writes []ObjectWrite) error {
	for _, w := range writes {
		var err error
		switch w.Action {
		case ActionCreate:
			err = t.Insert(ctx, w.Object)
		case ActionUpdate:
			err = t.Update(ctx, w.Object)
		case ActionDelete:
			err = t.Delete(ctx, w.Object.ID)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
func (t *fakeTx) SetState(_ context.Context, seq int64, count int, bytes int64) error {
	t.seq, t.count, t.bodyBytes = seq, count, bytes
	return nil
}

type fakeOps struct {
	records map[string]OpRecord
	getErr  error
}

func (o *fakeOps) Get(_ context.Context, id string) (*OpRecord, error) {
	if o.getErr != nil {
		return nil, o.getErr
	}
	r, ok := o.records[id]
	if !ok {
		return nil, nil
	}
	return &r, nil
}
func (o *fakeOps) Put(_ context.Context, id string, r OpRecord) error {
	o.records[id] = r
	return nil
}

type fakeMembers struct{ member bool }

func (m fakeMembers) IsMember(context.Context, string, string) (bool, error) { return m.member, nil }
func (m fakeMembers) GetMemberRole(context.Context, string, string) (string, error) {
	return "member", nil
}

type fakeRoleMembers struct {
	fakeMembers
	role string
}

func (m fakeRoleMembers) GetMemberRole(context.Context, string, string) (string, error) {
	return m.role, nil
}

type recordingPublisher struct{ payloads []CommitPayload }

func (p *recordingPublisher) PublishBoardCommit(_ context.Context, g, c string, payload CommitPayload) {
	if g != guild || c != chID {
		panic("published to the wrong room")
	}
	p.payloads = append(p.payloads, payload)
}

type harness struct {
	repo *fakeRepo
	ops  *fakeOps
	pub  *recordingPublisher
	svc  *Service
	n    int
}

func newHarness() *harness {
	h := &harness{repo: newFakeRepo(), ops: &fakeOps{records: map[string]OpRecord{}}, pub: &recordingPublisher{}}
	h.svc = NewService(h.repo, fakeMembers{member: true}, h.ops)
	h.svc.SetStorage(storage.NewService("", ""))
	h.svc.SetPublisher(h.pub)
	return h
}

func (h *harness) uuid() string {
	h.n++
	return fmt.Sprintf("aaaaaaaa-0000-4000-8000-%012d", h.n)
}

func raw(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

type m = map[string]any

func rectBody(id string) m {
	return m{
		"id": id, "kind": "rect", "rank": "1:a0", "version": 0, "createdBy": userID,
		"x": 10, "y": 20, "w": 100, "h": 50,
		"style": m{"colour": "red", "weight": "thin", "fill": "none"},
	}
}

func createChange(id string, body m) ChangeRequest {
	zero := int64(0)
	return ChangeRequest{ID: id, Action: ActionCreate, ExpectedVersion: &zero, Body: raw(body)}
}

func updateChange(id string, version int64, patch m) ChangeRequest {
	return ChangeRequest{ID: id, Action: ActionUpdate, ExpectedVersion: &version, Patch: raw(patch)}
}

func deleteChange(id string, version int64) ChangeRequest {
	return ChangeRequest{ID: id, Action: ActionDelete, ExpectedVersion: &version}
}

func (h *harness) run(changes ...ChangeRequest) (*CommandResult, error) {
	return h.svc.Execute(context.Background(), userID, chID, CommandRequest{OpID: h.uuid(), Changes: changes})
}

func httpCode(t *testing.T, err error) int {
	t.Helper()
	var fe *fiber.Error
	require.ErrorAs(t, err, &fe)
	return fe.Code
}

func TestCreateUpdateDelete(t *testing.T) {
	h := newHarness()
	id := h.uuid()

	res, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	assert.Equal(t, int64(1), res.Seq)
	assert.Equal(t, []ChangeResult{{ID: id, Action: "create", Version: 1}}, res.Changes)

	res, err = h.run(updateChange(id, 1, m{"x": 99, "style": m{"colour": "blue", "weight": "thick", "fill": "solid"}}))
	require.NoError(t, err)
	assert.Equal(t, int64(2), res.Seq)

	snap, err := h.svc.GetBoard(context.Background(), userID, chID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), snap.Seq)
	require.Len(t, snap.Objects, 1)
	var obj map[string]any
	require.NoError(t, json.Unmarshal(snap.Objects[0], &obj))
	assert.Equal(t, id, obj["id"])
	assert.EqualValues(t, 2, obj["version"])
	assert.EqualValues(t, 99, obj["x"])
	assert.EqualValues(t, 20, obj["y"], "unpatched fields stay")
	assert.Equal(t, "solid", obj["style"].(map[string]any)["fill"], "nested style is replaced whole")

	res, err = h.run(deleteChange(id, 2))
	require.NoError(t, err)
	assert.Equal(t, int64(3), res.Seq)
	assert.Empty(t, h.repo.objects)

	// Re-creating after a delete gets a new, higher version.
	res, err = h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	assert.Equal(t, int64(4), res.Changes[0].Version)
}

func TestEmptyBoardSnapshotHasEmptyObjectsArray(t *testing.T) {
	h := newHarness()
	snap, err := h.svc.GetBoard(context.Background(), userID, chID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), snap.Seq)
	assert.NotNil(t, snap.Objects)
	assert.JSONEq(t, `{"seq":0,"objects":[]}`, string(raw(snap)))
}

func TestCommitPayloadAndPublish(t *testing.T) {
	h := newHarness()
	a, b := h.uuid(), h.uuid()
	_, err := h.run(createChange(a, rectBody(a)))
	require.NoError(t, err)
	_, err = h.run(createChange(b, rectBody(b)))
	require.NoError(t, err)
	opID := h.uuid()
	res, err := h.svc.Execute(context.Background(), userID, chID, CommandRequest{OpID: opID, Changes: []ChangeRequest{
		updateChange(a, 1, m{"w": 5}), deleteChange(b, 2),
	}})
	require.NoError(t, err)

	require.Len(t, h.pub.payloads, 3)
	p := h.pub.payloads[2]
	assert.Equal(t, CommitPayload{
		ChannelID: chID, OpID: opID, Seq: res.Seq, UserID: userID,
		Changes: []CommittedChange{
			{ID: a, Action: "update", Version: 3, Patch: raw(m{"w": 5})},
			{ID: b, Action: "delete", Version: 3},
		},
	}, p)

	// A create is broadcast with its full body and version == seq.
	var body map[string]any
	require.NoError(t, json.Unmarshal(h.pub.payloads[0].Changes[0].Body, &body))
	assert.EqualValues(t, 1, body["version"])
	assert.Equal(t, a, body["id"])
	assert.Equal(t, userID, body["createdBy"])
}

func TestStaleExpectedVersionConflictsWithCurrentObjects(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	_, err = h.run(updateChange(id, 1, m{"x": 1}))
	require.NoError(t, err)

	_, err = h.run(updateChange(id, 1, m{"x": 2}))
	var ce *ConflictError
	require.ErrorAs(t, err, &ce)
	assert.Equal(t, CodeConflict, ce.Code)
	assert.Equal(t, int64(2), ce.Seq)
	require.Len(t, ce.Current, 1)
	var cur map[string]any
	require.NoError(t, json.Unmarshal(ce.Current[0], &cur))
	assert.EqualValues(t, 2, cur["version"])
	assert.EqualValues(t, 1, cur["x"])
	assert.Len(t, h.pub.payloads, 2, "a rejected command is not published")
}

func TestCreateOfExistingObjectConflicts(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	_, err = h.run(createChange(id, rectBody(id)))
	var ce *ConflictError
	require.ErrorAs(t, err, &ce)
	assert.Equal(t, CodeConflict, ce.Code)
}

func TestMissingObjectIsGone(t *testing.T) {
	h := newHarness()
	exists, missing := h.uuid(), h.uuid()
	_, err := h.run(createChange(exists, rectBody(exists)))
	require.NoError(t, err)

	for _, ch := range []ChangeRequest{updateChange(missing, 1, m{"x": 1}), deleteChange(missing, 1)} {
		_, err = h.run(updateChange(exists, 1, m{"x": 5}), ch)
		var ce *ConflictError
		require.ErrorAs(t, err, &ce)
		assert.Equal(t, CodeGone, ce.Code)
		assert.Equal(t, h.repo.seq, ce.Seq)
		// Current lists the touched ids that are still present; the missing one is absent.
		require.Len(t, ce.Current, 1)
		assert.Contains(t, string(ce.Current[0]), exists)
	}
}

func TestCommandIsAllOrNothing(t *testing.T) {
	h := newHarness()
	a, b := h.uuid(), h.uuid()
	_, err := h.run(createChange(a, rectBody(a)))
	require.NoError(t, err)

	t.Run("stale second change leaves the first unapplied", func(t *testing.T) {
		_, err := h.run(updateChange(a, 1, m{"x": 500}), updateChange(b, 1, m{"x": 1}))
		require.Error(t, err)
		assert.Contains(t, string(h.repo.objects[a].Body), `"x":10`)
		assert.Equal(t, int64(1), h.repo.seq)
	})
	t.Run("invalid patch in the second change rolls back the first create", func(t *testing.T) {
		c := h.uuid()
		_, err := h.run(createChange(c, rectBody(c)), updateChange(a, 1, m{"w": -4}))
		assert.Equal(t, 400, httpCode(t, err))
		_, exists := h.repo.objects[c]
		assert.False(t, exists)
		assert.Equal(t, int64(1), h.repo.seq)
	})
	t.Run("invalid body is rejected before anything is written", func(t *testing.T) {
		c := h.uuid()
		bad := rectBody(c)
		bad["kind"] = "triangle"
		_, err := h.run(createChange(a, rectBody(a)), createChange(c, bad))
		assert.Equal(t, 400, httpCode(t, err))
		assert.Equal(t, 1, h.repo.commits)
	})
}

func TestOpIDResendReturnsOriginalResult(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	req := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}

	first, err := h.svc.Execute(context.Background(), userID, chID, req)
	require.NoError(t, err)
	second, err := h.svc.Execute(context.Background(), userID, chID, req)
	require.NoError(t, err)

	assert.Equal(t, first, second)
	assert.Equal(t, 1, h.repo.commits, "no second commit")
	assert.Len(t, h.pub.payloads, 1, "no second broadcast")
	assert.Equal(t, int64(1), h.repo.seq)
}

func TestOpIDOfAnotherUserOrChannelIsRejected(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	req := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}
	_, err := h.svc.Execute(context.Background(), userID, chID, req)
	require.NoError(t, err)

	other := "44444444-4444-4444-8444-444444444444"
	_, err = h.svc.Execute(context.Background(), other, chID, CommandRequest{OpID: req.OpID, Changes: []ChangeRequest{
		createChange(h.uuid(), rectBody("x")),
	}})
	assert.Equal(t, 400, httpCode(t, err))
}

func TestRedisOutageDoesNotBlockWrites(t *testing.T) {
	h := newHarness()
	h.ops.getErr = errors.New("redis down")
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
}

func TestCommitFailureIsGenericAndNotRemembered(t *testing.T) {
	h := newHarness()
	h.repo.failNext = errors.New("pq: secret internals")
	id := h.uuid()
	req := CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}
	_, err := h.svc.Execute(context.Background(), userID, chID, req)
	var fe *fiber.Error
	require.ErrorAs(t, err, &fe)
	assert.Equal(t, 500, fe.Code)
	assert.NotContains(t, fe.Message, "secret")
	assert.Empty(t, h.ops.records)
}

func TestAccessChecks(t *testing.T) {
	t.Run("non-member is forbidden on read and write", func(t *testing.T) {
		h := newHarness()
		h.svc = NewService(h.repo, fakeMembers{member: false}, h.ops)
		_, err := h.svc.GetBoard(context.Background(), userID, chID)
		assert.Equal(t, 403, httpCode(t, err))
		id := h.uuid()
		_, err = h.run(createChange(id, rectBody(id)))
		assert.Equal(t, 403, httpCode(t, err))
		assert.Zero(t, h.repo.commits)
	})
	t.Run("non-whiteboard channel is rejected", func(t *testing.T) {
		for _, typ := range []string{"text", "voice"} {
			h := newHarness()
			h.repo.channels[chID].Type = typ
			_, err := h.svc.GetBoard(context.Background(), userID, chID)
			assert.Equal(t, 404, httpCode(t, err))
			id := h.uuid()
			_, err = h.run(createChange(id, rectBody(id)))
			assert.Equal(t, 404, httpCode(t, err))
		}
	})
	t.Run("unknown channel is 404", func(t *testing.T) {
		h := newHarness()
		_, err := h.svc.GetBoard(context.Background(), userID, "99999999-9999-4999-8999-999999999999")
		assert.Equal(t, 404, httpCode(t, err))
	})
}

func TestLimits(t *testing.T) {
	t.Run("too many changes per command", func(t *testing.T) {
		h := newHarness()
		var changes []ChangeRequest
		for i := 0; i <= MaxChangesPerCommand; i++ {
			id := h.uuid()
			changes = append(changes, createChange(id, rectBody(id)))
		}
		_, err := h.run(changes...)
		assert.Equal(t, 413, httpCode(t, err))
		assert.Zero(t, h.repo.commits)
	})
	t.Run("empty command", func(t *testing.T) {
		_, err := newHarness().run()
		assert.Equal(t, 400, httpCode(t, err))
	})
	t.Run("objects per board", func(t *testing.T) {
		h := newHarness()
		for i := 0; i < MaxObjectsPerBoard; i++ {
			h.repo.objects[fmt.Sprintf("bbbbbbbb-0000-4000-8000-%012d", i)] = Object{Version: 1, Body: raw(m{"kind": "rect"})}
		}
		h.repo.objectCount, h.repo.bodyBytes = objectTotals(t, h.repo.objects)
		id := h.uuid()
		_, err := h.run(createChange(id, rectBody(id)))
		assert.Equal(t, 413, httpCode(t, err))
		// Deleting in the same command frees room.
		victim := "bbbbbbbb-0000-4000-8000-000000000000"
		h.repo.objects[victim] = Object{ID: victim, Version: 1, Body: raw(m{"kind": "rect"})}
		_, err = h.run(createChange(id, rectBody(id)), deleteChange(victim, 1))
		require.NoError(t, err)
	})
	t.Run("bytes per board", func(t *testing.T) {
		h := newHarness()
		h.repo.objects["bbbbbbbb-0000-4000-8000-000000000000"] = Object{Version: 1, Body: raw(m{"text": strings.Repeat("x", MaxBoardBytes)})}
		h.repo.objectCount, h.repo.bodyBytes = objectTotals(t, h.repo.objects)
		id := h.uuid()
		_, err := h.run(createChange(id, rectBody(id)))
		assert.Equal(t, 413, httpCode(t, err))
	})
	t.Run("bytes per object", func(t *testing.T) {
		h := newHarness()
		id := h.uuid()
		body := m{
			"id": id, "kind": "text", "rank": "1:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 100, "h": 20, "text": strings.Repeat("😀", 9000),
			"style": m{"colour": "ink", "size": "M", "font": "app", "bold": false, "italic": false, "align": "left"},
		}
		_, err := h.run(createChange(id, body))
		assert.Equal(t, 413, httpCode(t, err))
	})
	t.Run("update that grows an object past the cap", func(t *testing.T) {
		h := newHarness()
		id := h.uuid()
		body := m{
			"id": id, "kind": "text", "rank": "1:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 100, "h": 20, "text": "hi",
			"style": m{"colour": "ink", "size": "M", "font": "app", "bold": false, "italic": false, "align": "left"},
		}
		_, err := h.run(createChange(id, body))
		require.NoError(t, err)
		_, err = h.run(updateChange(id, 1, m{"text": strings.Repeat("😀", 9000)}))
		assert.Equal(t, 413, httpCode(t, err))
	})
	t.Run("stroke points", func(t *testing.T) {
		h := newHarness()
		id := h.uuid()
		pts := make([]m, maxStrokePoints+1)
		for i := range pts {
			pts[i] = m{"x": 1, "y": 1, "pressure": 0.5}
		}
		body := m{
			"id": id, "kind": "stroke", "rank": "1:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 1, "h": 1, "points": pts, "preset": "pen",
			"style": m{"colour": "ink", "weight": "thin"},
		}
		_, err := h.run(createChange(id, body))
		assert.Equal(t, 413, httpCode(t, err))
	})
}

func TestBodyValidation(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	mutate := func(f func(b m)) m {
		b := rectBody(id)
		f(b)
		return b
	}
	for name, body := range map[string]m{
		"unknown kind":       mutate(func(b m) { b["kind"] = "circle" }),
		"id mismatch":        mutate(func(b m) { b["id"] = h.uuid() }),
		"nonzero version":    mutate(func(b m) { b["version"] = 3 }),
		"spoofed createdBy":  mutate(func(b m) { b["createdBy"] = "44444444-4444-4444-8444-444444444444" }),
		"unknown field":      mutate(func(b m) { b["evil"] = 1 }),
		"missing field":      mutate(func(b m) { delete(b, "style") }),
		"null field":         mutate(func(b m) { b["x"] = nil }),
		"string number":      mutate(func(b m) { b["x"] = "10" }),
		"huge coordinate":    mutate(func(b m) { b["x"] = 1e30 }),
		"negative size":      mutate(func(b m) { b["w"] = -1 }),
		"zero size rect":     mutate(func(b m) { b["h"] = 0 }),
		"bad colour":         mutate(func(b m) { b["style"] = m{"colour": "rgb(255,0,0)", "weight": "thin", "fill": "none"} }),
		"bad fill":           mutate(func(b m) { b["style"] = m{"colour": "red", "weight": "thin", "fill": "gradient"} }),
		"extra style key":    mutate(func(b m) { b["style"] = m{"colour": "red", "weight": "thin", "fill": "none", "css": "x"} }),
		"frame rank on rect": mutate(func(b m) { b["rank"] = "0:a" }),
		"bad rank":           mutate(func(b m) { b["rank"] = "1:" }),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := h.run(createChange(id, body))
			assert.Equal(t, 400, httpCode(t, err))
		})
	}

	t.Run("overflowing number is rejected by JSON parsing", func(t *testing.T) {
		b := ChangeRequest{ID: id, Action: ActionCreate, Body: json.RawMessage(strings.Replace(string(raw(rectBody(id))), `"x":10`, `"x":1e999`, 1))}
		_, err := h.run(b)
		assert.Equal(t, 400, httpCode(t, err))
	})
	t.Run("frame needs a frame rank and may not be zero-sized", func(t *testing.T) {
		f := m{
			"id": id, "kind": "frame", "rank": "0:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 300, "h": 200, "label": "Sprint",
			"style": m{"colour": "ink", "weight": "thin"},
		}
		_, err := h.run(createChange(id, f))
		require.NoError(t, err)
	})
	t.Run("zero-extent line is fine", func(t *testing.T) {
		lid := h.uuid()
		l := m{
			"id": lid, "kind": "line", "rank": "1:a1", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 0, "h": 40, "start": m{"x": 0, "y": 0}, "end": m{"x": 0, "y": 40},
			"style": m{"colour": "ink", "weight": "thin"},
		}
		_, err := h.run(createChange(lid, l))
		require.NoError(t, err)
	})
}

func TestPatchValidation(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)

	for name, patch := range map[string]m{
		"empty":               {},
		"immutable id":        {"id": h.uuid()},
		"immutable kind":      {"kind": "ellipse"},
		"immutable version":   {"version": 9},
		"immutable createdBy": {"createdBy": userID},
		"foreign key":         {"text": "nope"},
		"null":                {"x": nil},
		"bad enum":            {"style": m{"colour": "red", "weight": "thin", "fill": "plaid"}},
		"partial style":       {"style": m{"colour": "red"}},
		"wrong rank prefix":   {"rank": "0:a"},
		"zero width":          {"w": 0},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := h.run(updateChange(id, 1, patch))
			assert.Equal(t, 400, httpCode(t, err))
		})
	}
	assert.Equal(t, int64(1), h.repo.seq)
}

func TestCommandShapeValidation(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	one := int64(1)
	for name, req := range map[string]CommandRequest{
		"bad opId":              {OpID: "nope", Changes: []ChangeRequest{createChange(id, rectBody(id))}},
		"bad change id":         {OpID: h.uuid(), Changes: []ChangeRequest{{ID: "x", Action: ActionDelete, ExpectedVersion: &one}}},
		"duplicate ids":         {OpID: h.uuid(), Changes: []ChangeRequest{deleteChange(id, 1), deleteChange(id, 1)}},
		"unknown action":        {OpID: h.uuid(), Changes: []ChangeRequest{{ID: id, Action: "upsert"}}},
		"update without expect": {OpID: h.uuid(), Changes: []ChangeRequest{{ID: id, Action: ActionUpdate, Patch: raw(m{"x": 1})}}},
		"zero expectedVersion":  {OpID: h.uuid(), Changes: []ChangeRequest{updateChange(id, 0, m{"x": 1})}},
		"delete with body":      {OpID: h.uuid(), Changes: []ChangeRequest{{ID: id, Action: ActionDelete, ExpectedVersion: &one, Body: raw(m{})}}},
		"create with expected":  {OpID: h.uuid(), Changes: []ChangeRequest{{ID: id, Action: ActionCreate, ExpectedVersion: &one, Body: raw(rectBody(id))}}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := h.svc.Execute(context.Background(), userID, chID, req)
			assert.Equal(t, 400, httpCode(t, err))
		})
	}
}

func TestImageAssetMustBelongToBoard(t *testing.T) {
	h := newHarness()
	asset := h.uuid()
	image := func(id string) m {
		return m{
			"id": id, "kind": "image", "rank": "1:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 64, "h": 64, "assetId": asset, "url": "/uploads/board-assets/x/y.png",
			"width": 64, "height": 64, "crop": m{"x": 0, "y": 0, "w": 1, "h": 1}, "pixelated": true,
		}
	}
	id := h.uuid()
	_, err := h.run(createChange(id, image(id)))
	assert.Equal(t, 400, httpCode(t, err))

	h.repo.assets[asset] = Asset{ID: asset, BoardID: chID, StorageKey: "board-assets/x/y.png", Width: 64, Height: 64}
	_, err = h.run(createChange(id, image(id)))
	require.NoError(t, err)

	t.Run("rejects script urls", func(t *testing.T) {
		bad := image(h.uuid())
		bad["url"] = "javascript:alert(1)"
		_, err := h.run(createChange(bad["id"].(string), bad))
		assert.Equal(t, 400, httpCode(t, err))
	})
}

func TestKeyedMutexSerializesAndCleansUp(t *testing.T) {
	var k keyedMutex
	unlock := k.lock("a")
	done := make(chan struct{})
	go func() {
		u := k.lock("a")
		u()
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("second lock acquired while first is held")
	default:
	}
	unlock()
	<-done
	assert.Empty(t, k.m)
}
