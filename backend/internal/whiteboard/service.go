package whiteboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/d0d012/diskord/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

type Service struct {
	repo    Repository
	members GuildMembership
	ops     OpStore
	pub     Publisher
	locks   keyedMutex
	storage *storage.Service
}

func NewService(repo Repository, members GuildMembership, ops OpStore) *Service {
	return &Service{repo: repo, members: members, ops: ops, pub: NoopPublisher{}}
}

// SetStorage is called during server wiring, before requests are served.
func (s *Service) SetStorage(files *storage.Service) { s.storage = files }

func (s *Service) SetPublisher(pub Publisher) {
	if pub == nil {
		pub = NoopPublisher{}
	}
	s.pub = pub
}

// NoopPublisher drops commits when no realtime transport is configured (tests).
type NoopPublisher struct{}

func (NoopPublisher) PublishBoardCommit(_ context.Context, guildID, channelID string, payload CommitPayload) {
	log.Debug().Str("guildID", guildID).Str("channelID", channelID).Int64("seq", payload.Seq).
		Msg("whiteboard: BOARD_COMMIT not broadcast (gateway rooms not wired)")
}

// access checks that the channel exists, is a board and that the user is a
// member of its guild.
func (s *Service) access(ctx context.Context, userID, channelID string) (*ChannelInfo, error) {
	ch, err := s.repo.GetChannel(ctx, channelID)
	if err != nil {
		return nil, err
	}
	ok, err := s.members.IsMember(ctx, ch.GuildID, userID)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.Service.access: check membership: %w", err)
	}
	if !ok {
		return nil, fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
	}
	if ch.Type != ChannelTypeWhiteboard {
		return nil, fiber.NewError(fiber.StatusNotFound, "channel is not a board")
	}
	return ch, nil
}

// BoardSubscription implements gateway's narrow reader interface without a
// package dependency. Authorization is identical to the HTTP endpoints; no
// objects are loaded and the board need not be materialised yet.
func (s *Service) BoardSubscription(ctx context.Context, userID, channelID string) (string, int64, error) {
	ch, err := s.access(ctx, userID, channelID)
	if err != nil {
		return "", 0, err
	}
	seq, err := s.repo.CurrentSeq(ctx, channelID)
	if err != nil {
		return "", 0, fmt.Errorf("whiteboard.Service.BoardSubscription: %w", err)
	}
	return ch.GuildID, seq, nil
}

// GetBoard returns the board's seq and objects, read in one transaction.
func (s *Service) GetBoard(ctx context.Context, userID, channelID string) (*Snapshot, error) {
	if _, err := s.access(ctx, userID, channelID); err != nil {
		return nil, err
	}
	seq, objects, err := s.repo.Snapshot(ctx, channelID)
	if err != nil {
		log.Error().Err(err).Str("channelID", channelID).Msg("whiteboard.Service.GetBoard")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to load board")
	}
	wire, err := toWireAll(objects)
	if err != nil {
		log.Error().Err(err).Str("channelID", channelID).Msg("whiteboard.Service.GetBoard: encode")
		return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to load board")
	}
	return &Snapshot{Seq: seq, Objects: wire}, nil
}

// prepared is a change that passed stateless validation.
type prepared struct {
	req   ChangeRequest
	body  storedBody                 // create
	patch map[string]json.RawMessage // update
}

// Execute applies a command to the board. It returns a *ConflictError (with the
// current objects) for stale or missing targets, and fiber errors otherwise.
func (s *Service) Execute(ctx context.Context, userID, channelID string, req CommandRequest) (*CommandResult, error) {
	ch, err := s.access(ctx, userID, channelID)
	if err != nil {
		return nil, err
	}
	if err := validateCommandShape(req); err != nil {
		return nil, httpError(err)
	}
	changes, err := prepareChanges(req, userID)
	if err != nil {
		return nil, httpError(err)
	}

	unlock := s.locks.lock(channelID)
	defer unlock()

	// A resend returns the original result without a second commit.
	if rec, err := s.ops.Get(ctx, req.OpID); err != nil {
		log.Warn().Err(err).Str("opID", req.OpID).Msg("whiteboard.Service.Execute: op lookup failed, continuing")
	} else if rec != nil {
		if rec.ChannelID != channelID || rec.UserID != userID {
			return nil, fiber.NewError(fiber.StatusBadRequest, "opId was already used")
		}
		result := rec.Result
		return &result, nil
	}

	var result CommandResult
	var payload CommitPayload
	err = s.repo.Commit(ctx, channelID, func(ctx context.Context, tx BoardTx) error {
		r, p, err := s.apply(ctx, tx, userID, channelID, req.OpID, changes)
		if err != nil {
			return err
		}
		result, payload = *r, *p
		return nil
	})
	if err != nil {
		return nil, s.commitError(err, channelID)
	}

	// The commit is durable; from here on nothing may fail the request.
	bg := context.WithoutCancel(ctx)
	if err := s.ops.Put(bg, req.OpID, OpRecord{ChannelID: channelID, UserID: userID, Result: result}); err != nil {
		log.Warn().Err(err).Str("opID", req.OpID).Msg("whiteboard.Service.Execute: remember op failed")
	}
	s.pub.PublishBoardCommit(bg, ch.GuildID, channelID, payload)
	return &result, nil
}

func (s *Service) commitError(err error, channelID string) error {
	var ce *ConflictError
	var fe *fiber.Error
	var ve *validationError
	var le *limitError
	switch {
	case errors.As(err, &ce), errors.As(err, &fe):
		return err
	case errors.As(err, &ve), errors.As(err, &le):
		return httpError(err)
	case errors.Is(err, ErrObjectIDTaken):
		return fiber.NewError(fiber.StatusBadRequest, "object id is already in use")
	}
	log.Error().Err(err).Str("channelID", channelID).Msg("whiteboard.Service.Execute: commit")
	return fiber.NewError(fiber.StatusInternalServerError, "failed to apply changes")
}

func prepareChanges(req CommandRequest, userID string) ([]prepared, error) {
	out := make([]prepared, len(req.Changes))
	for i, ch := range req.Changes {
		out[i].req = ch
		switch ch.Action {
		case ActionCreate:
			body, err := validateCreateBody(ch.Body, ch.ID, userID)
			if err != nil {
				return nil, err
			}
			if _, err := body.marshal(); err != nil {
				return nil, err
			}
			out[i].body = body
		case ActionUpdate:
			patch, err := validatePatchShape(ch.Patch)
			if err != nil {
				return nil, err
			}
			out[i].patch = patch
		}
	}
	return out, nil
}

func httpError(err error) error {
	var ve *validationError
	var le *limitError
	switch {
	case errors.As(err, &ve):
		return fiber.NewError(fiber.StatusBadRequest, ve.msg)
	case errors.As(err, &le):
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, le.msg)
	}
	return fiber.NewError(fiber.StatusBadRequest, "invalid change")
}

// apply checks every change against the locked board and, only if all pass,
// writes them. Nothing is written before every check has succeeded.
func (s *Service) apply(ctx context.Context, tx BoardTx, userID, channelID, opID string, changes []prepared) (*CommandResult, *CommitPayload, error) {
	ids := make([]string, len(changes))
	for i, c := range changes {
		ids[i] = c.req.ID
	}
	existing, err := tx.Objects(ctx, ids)
	if err != nil {
		return nil, nil, fmt.Errorf("whiteboard.Service.apply: load objects: %w", err)
	}

	// Phase 1: optimistic concurrency.
	gone, stale := false, false
	for _, c := range changes {
		obj, found := existing[c.req.ID]
		switch {
		case c.req.Action == ActionCreate:
			// Absence alone cannot detect an unseen recreate/delete (ABA). Undo
			// supplies the seq at which the client verified its local tombstone.
			if found || (c.req.ExpectedSeq != nil && *c.req.ExpectedSeq != tx.Seq()) {
				stale = true
			}
		case c.req.Action != ActionCreate && !found:
			gone = true
		case c.req.Action != ActionCreate && obj.Version != *c.req.ExpectedVersion:
			stale = true
		}
	}
	code, msg := "", ""
	switch {
	case gone:
		code, msg = CodeGone, "object no longer exists"
	case stale:
		code, msg = CodeConflict, "object was changed by someone else"
	}
	if code != "" {
		current := make([]Object, 0, len(existing))
		for _, id := range ids {
			if o, ok := existing[id]; ok {
				current = append(current, o)
			}
		}
		wire, err := toWireAll(current)
		if err != nil {
			return nil, nil, fmt.Errorf("whiteboard.Service.apply: encode current: %w", err)
		}
		return nil, nil, &ConflictError{Seq: tx.Seq(), Code: code, Message: msg, Current: wire}
	}

	// Phase 2: build the new state and check content and limits.
	count, bytes, err := tx.Totals(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("whiteboard.Service.apply: totals: %w", err)
	}
	seq := tx.Seq() + 1

	type write struct {
		action string
		obj    Object
		patch  json.RawMessage
		body   storedBody
	}
	writes := make([]write, len(changes))
	var assetIDs []string
	for i, c := range changes {
		w := write{action: c.req.Action, obj: Object{ID: c.req.ID, Version: seq}}
		var previousBytes int64
		if c.req.Action != ActionCreate {
			raw, err := canonicalStoredBody(existing[c.req.ID].Body)
			if err != nil {
				return nil, nil, fmt.Errorf("whiteboard.Service.apply: size stored body: %w", err)
			}
			previousBytes = int64(len(raw))
		}
		switch c.req.Action {
		case ActionCreate:
			raw, err := c.body.marshal()
			if err != nil {
				return nil, nil, err
			}
			w.obj.Body, w.body = raw, c.body
			count++
			bytes += int64(len(raw))
			if c.body.kind() == "image" {
				var assetID string
				_ = json.Unmarshal(c.body["assetId"], &assetID)
				assetIDs = append(assetIDs, assetID)
			}
		case ActionUpdate:
			old := existing[c.req.ID]
			var stored storedBody
			if err := json.Unmarshal(old.Body, &stored); err != nil {
				return nil, nil, fmt.Errorf("whiteboard.Service.apply: decode stored body %s: %w", old.ID, err)
			}
			merged, err := applyPatch(stored, c.patch)
			if err != nil {
				return nil, nil, err
			}
			if merged.kind() == "sticky" && c.patch["reactions"] != nil {
				if err := checkReactionOwnership(stored["reactions"], c.patch["reactions"], userID); err != nil {
					return nil, nil, err
				}
			}
			raw, err := merged.marshal()
			if err != nil {
				return nil, nil, err
			}
			w.obj.Body, w.body = raw, merged
			w.patch = c.req.Patch
			bytes += int64(len(raw)) - previousBytes
			if merged.kind() == "image" {
				var assetID string
				_ = json.Unmarshal(merged["assetId"], &assetID)
				assetIDs = append(assetIDs, assetID)
			}
		case ActionDelete:
			count--
			bytes -= previousBytes
		}
		writes[i] = w
	}
	if count > MaxObjectsPerBoard {
		return nil, nil, limitf("a board can hold at most %d objects", MaxObjectsPerBoard)
	}
	if bytes > MaxBoardBytes {
		return nil, nil, limitf("board exceeds %d bytes", MaxBoardBytes)
	}
	if len(assetIDs) > 0 {
		unique := dedupe(assetIDs)
		assets, err := tx.Assets(ctx, unique)
		if err != nil {
			return nil, nil, fmt.Errorf("whiteboard.Service.apply: assets: %w", err)
		}
		for _, w := range writes {
			if w.action == ActionDelete || w.body.kind() != "image" {
				continue
			}
			var image UploadedAsset
			_ = json.Unmarshal(w.body["assetId"], &image.ID)
			_ = json.Unmarshal(w.body["url"], &image.URL)
			_ = json.Unmarshal(w.body["width"], &image.Width)
			_ = json.Unmarshal(w.body["height"], &image.Height)
			a, ok := assets[image.ID]
			if !ok {
				return nil, nil, invalidf("image asset does not belong to this board")
			}
			if s.storage == nil {
				return nil, nil, fmt.Errorf("whiteboard.Service.apply: image storage not configured")
			}
			if image.URL != s.storage.PublicURL(a.StorageKey) || image.Width != a.Width || image.Height != a.Height {
				return nil, nil, invalidf("image URL and natural dimensions must match its asset")
			}
		}
		remaining, err := tx.ReferencedAssets(ctx, ids)
		if err != nil {
			return nil, nil, fmt.Errorf("whiteboard.Service.apply: referenced assets: %w", err)
		}
		if len(dedupe(append(remaining, unique...))) > MaxReferencedAssetsPerBoard {
			return nil, nil, limitf("a board can reference at most %d image assets", MaxReferencedAssetsPerBoard)
		}
	}

	// Phase 3: write.
	result := &CommandResult{Seq: seq, Changes: make([]ChangeResult, len(writes))}
	payload := &CommitPayload{
		ChannelID: channelID, OpID: opID, Seq: seq, UserID: userID,
		Changes: make([]CommittedChange, len(writes)),
	}
	for i, w := range writes {
		cc := CommittedChange{ID: w.obj.ID, Action: w.action, Version: seq}
		switch w.action {
		case ActionCreate:
			err = tx.Insert(ctx, w.obj)
			wire, werr := toWire(Object{ID: w.obj.ID, Version: seq, Body: w.obj.Body})
			if err == nil {
				err = werr
			}
			cc.Body = wire
		case ActionUpdate:
			err = tx.Update(ctx, w.obj)
			cc.Patch = w.patch
		case ActionDelete:
			err = tx.Delete(ctx, w.obj.ID)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("whiteboard.Service.apply: %s %s: %w", w.action, w.obj.ID, err)
		}
		result.Changes[i] = ChangeResult{ID: w.obj.ID, Action: w.action, Version: seq}
		payload.Changes[i] = cc
	}
	if err := tx.SetSeq(ctx, seq); err != nil {
		return nil, nil, fmt.Errorf("whiteboard.Service.apply: %w", err)
	}
	return result, payload, nil
}

func dedupe(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// toWire merges the stored body with the id and version columns.
func toWire(o Object) (json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(o.Body, &m); err != nil {
		return nil, fmt.Errorf("whiteboard.toWire: object %s: %w", o.ID, err)
	}
	id, _ := json.Marshal(o.ID)
	version, _ := json.Marshal(o.Version)
	m["id"], m["version"] = id, version
	raw, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("whiteboard.toWire: object %s: %w", o.ID, err)
	}
	return raw, nil
}

func toWireAll(objects []Object) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, len(objects))
	for i, o := range objects {
		raw, err := toWire(o)
		if err != nil {
			return nil, err
		}
		out[i] = raw
	}
	return out, nil
}

// keyedMutex is a per-key lock that frees its entries when unused. Ordering of
// commit + publish relies on it, so it assumes one backend instance.
type keyedMutex struct {
	mu sync.Mutex
	m  map[string]*mutexEntry
}

type mutexEntry struct {
	mu   sync.Mutex
	refs int
}

func (k *keyedMutex) lock(key string) (unlock func()) {
	k.mu.Lock()
	if k.m == nil {
		k.m = make(map[string]*mutexEntry)
	}
	e := k.m[key]
	if e == nil {
		e = &mutexEntry{}
		k.m[key] = e
	}
	e.refs++
	k.mu.Unlock()

	e.mu.Lock()
	return func() {
		e.mu.Unlock()
		k.mu.Lock()
		e.refs--
		if e.refs == 0 {
			delete(k.m, key)
		}
		k.mu.Unlock()
	}
}
