package whiteboard

import (
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Deliberately read the canonical TS contract: independent edits to a Go mirror
// must fail CI, not quietly produce a second protocol. No Node/tooling required.
func TestContractRevision2Parity(t *testing.T) {
	raw, err := os.ReadFile("../../../frontend/src/features/whiteboard/contract/limits.ts")
	require.NoError(t, err)
	source := string(raw)
	value := func(name string) string {
		match := regexp.MustCompile(`(?m)^export const ` + name + ` = ([^;]+);`).FindStringSubmatch(source)
		require.Len(t, match, 2, name)
		return match[1]
	}
	for name, actual := range map[string]float64{
		"CONTRACT_REVISION":               2,
		"MAX_OBJECTS_PER_BOARD":           MaxObjectsPerBoard,
		"MAX_BOARD_BODY_BYTES":            MaxBoardBytes,
		"MAX_OBJECT_BODY_BYTES":           MaxObjectBytes,
		"MAX_CHANGES_PER_COMMAND":         MaxChangesPerCommand,
		"MAX_COMMANDS_PER_SECOND":         MaxCommandsPerSecond,
		"COMMAND_BURST":                   CommandBurst,
		"MAX_COORDINATE":                  maxCoord,
		"MAX_STROKE_POINTS":               maxStrokePoints,
		"MAX_TEXT_LENGTH":                 maxTextRunes,
		"MAX_STICKY_TEXT_LENGTH":          maxStickyRunes,
		"MAX_FRAME_LABEL_LENGTH":          maxLabelRunes,
		"MAX_ASSET_URL_BYTES":             maxURLLen,
		"MAX_IMAGE_DIMENSION":             maxImageDim,
		"MAX_IMAGE_PIXELS":                maxImagePixels,
		"MAX_IMAGE_BYTES":                 MaxImageBytes,
		"MAX_IMAGE_MEGAPIXELS":            MaxImageMegapixels,
		"MAX_REFERENCED_ASSETS_PER_BOARD": MaxReferencedAssetsPerBoard,
		"MAX_UPLOADS_PER_MINUTE":          MaxUploadsPerMinute,
		"UPLOAD_RATE_WINDOW_MS":           float64(UploadRateWindow.Milliseconds()),
		"GEOMETRY_EPSILON":                geometryEpsilon,
		"MAX_RANK_SUFFIX_LENGTH":          maxRankSuffixLength,
		"OP_IDEMPOTENCY_TTL_MS":           float64(OpTTL.Milliseconds()),
		"MAX_STICKY_REACTION_EMOJIS":      maxStickyReactionEmojis,
		"MAX_STICKY_REACTION_USERS":       maxStickyReactionUsers,
		"MAX_REACTION_EMOJI_LENGTH":       maxReactionEmojiRunes,
	} {
		t.Run(name, func(t *testing.T) {
			expected := 1.0
			for _, factor := range strings.Split(strings.ReplaceAll(value(name), "_", ""), "*") {
				n, err := strconv.ParseFloat(strings.TrimSpace(factor), 64)
				require.NoError(t, err)
				expected *= n
			}
			assert.Equal(t, expected, actual)
		})
	}
	for name, actual := range map[string]string{
		"RANK_ALPHABET": rankAlphabet, "RANK_PATTERN": rankPattern,
		"FRAME_RANK_PREFIX": frameRankPrefix, "OBJECT_RANK_PREFIX": objectRankPrefix,
		"UUID_PATTERN": uuidPattern, "HEX_COLOUR_PATTERN": hexColourPattern,
	} {
		assert.Equal(t, strings.Trim(value(name), "'"), actual, name)
	}
	for name, actual := range map[string][]string{
		"PALETTE_COLOURS": paletteColours, "STICKY_TONES": stickyTones,
		"ZERO_EXTENT_KINDS": {"stroke", "line", "arrow"},
	} {
		text := source
		if name != "ZERO_EXTENT_KINDS" {
			body, err := os.ReadFile("../../../frontend/src/features/whiteboard/contract/types.ts")
			require.NoError(t, err)
			text = string(body)
		}
		match := regexp.MustCompile(`(?s)export const ` + name + ` = \[(.*?)\] as const;`).FindStringSubmatch(text)
		require.Len(t, match, 2, name)
		var expected []string
		for _, quoted := range regexp.MustCompile(`'([^']+)'`).FindAllStringSubmatch(match[1], -1) {
			expected = append(expected, quoted[1])
		}
		assert.Equal(t, expected, actual, name)
		if name == "ZERO_EXTENT_KINDS" {
			assert.Len(t, zeroExtentKinds, len(expected))
			for _, kind := range expected {
				assert.True(t, zeroExtentKinds[kind])
			}
		}
	}
}

func TestCanonicalRankGrammar(t *testing.T) {
	for _, suffix := range []string{"a0", "Zz", "a0V", "a0G", "b00", "a0" + strings.Repeat("V", 62), "A" + strings.Repeat("0", 26) + "V"} {
		assert.NoError(t, validateRank(raw("1:"+suffix), "rect"), suffix)
		assert.NoError(t, validateRank(raw("0:"+suffix), "frame"), suffix)
	}
	for _, suffix := range []string{"a", "9x", "a0!", "a0V0", "a0" + strings.Repeat("V", 63), "A" + strings.Repeat("0", 26)} {
		assert.Error(t, validateRank(raw("1:"+suffix), "rect"), suffix)
	}
	assert.Error(t, validateRank(raw("0:a0"), "rect"))
	assert.Error(t, validateRank(raw("1:a0"), "frame"))
}

func TestGuardedCreateRejectsABAAtomically(t *testing.T) {
	h := newHarness()
	id, other := h.uuid(), h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	_, err = h.run(deleteChange(id, 1))
	require.NoError(t, err)
	guard := int64(2)
	restore := createChange(id, rectBody(id))
	restore.ExpectedSeq = &guard
	// Another client recreated and deleted this id while our undo was in flight.
	_, err = h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	_, err = h.run(deleteChange(id, 3))
	require.NoError(t, err)
	_, err = h.run(restore, createChange(other, rectBody(other)))
	var conflict *ConflictError
	require.ErrorAs(t, err, &conflict)
	assert.Equal(t, CodeConflict, conflict.Code)
	assert.EqualValues(t, 4, conflict.Seq)
	assert.Empty(t, conflict.Current)
	assert.Empty(t, h.repo.objects)
	assert.EqualValues(t, 4, h.repo.seq)
	assert.Len(t, h.pub.payloads, 4)
}

func TestGuardedCreateAndExplicitAbsence(t *testing.T) {
	h := newHarness()
	id := h.uuid()
	zero, one, negative := int64(0), int64(1), int64(-1)
	create := createChange(id, rectBody(id))
	create.ExpectedSeq = &zero
	_, err := h.run(create)
	require.NoError(t, err)
	_, err = h.run(deleteChange(id, 1))
	require.NoError(t, err)
	two := int64(2)
	create.ExpectedSeq = &two
	_, err = h.run(create)
	require.NoError(t, err)
	assert.EqualValues(t, 3, h.repo.seq)
	for name, change := range map[string]ChangeRequest{
		"missing absence":         {ID: h.uuid(), Action: ActionCreate, Body: raw(rectBody(id))},
		"positive create version": {ID: id, Action: ActionCreate, ExpectedVersion: &one, Body: raw(rectBody(id))},
		"negative seq":            {ID: id, Action: ActionCreate, ExpectedVersion: &zero, ExpectedSeq: &negative, Body: raw(rectBody(id))},
		"update with seq":         {ID: id, Action: ActionUpdate, ExpectedVersion: &one, ExpectedSeq: &one, Patch: raw(m{"x": 1})},
		"delete with seq":         {ID: id, Action: ActionDelete, ExpectedVersion: &one, ExpectedSeq: &one},
	} {
		t.Run(name, func(t *testing.T) { _, err := h.run(change); assert.Equal(t, 400, httpCode(t, err)) })
	}
}

func TestRevision2ValidationBoundaries(t *testing.T) {
	id := "aaaaaaaa-0000-4000-8000-000000000001"
	assert.False(t, isUUID(strings.ToUpper(id)))
	assert.True(t, isUUID(id))
	body := rectBody(id)
	body["x"], body["y"], body["w"] = maxCoord, -maxCoord, maxCoord
	_, err := validateCreateBody(raw(body), id, userID)
	require.NoError(t, err)
	body["x"] = maxCoord + 1
	_, err = validateCreateBody(raw(body), id, userID)
	require.Error(t, err)

	for _, tc := range []struct {
		kind string
		cap  int
	}{{"text", maxTextRunes}, {"sticky", maxStickyRunes}, {"frame", maxLabelRunes}} {
		t.Run(tc.kind+" text cap", func(t *testing.T) {
			b := rectBody(id)
			b["kind"] = tc.kind
			field := "text"
			switch tc.kind {
			case "text":
				b["style"] = m{"colour": "ink", "size": "M", "font": "app", "bold": false, "italic": false, "align": "left"}
			case "sticky":
				b["style"] = m{"tone": "yellow", "font": "handwriting"}
			case "frame":
				b["rank"], b["style"], field = "0:a0", m{"colour": "ink", "weight": "thin"}, "label"
			}
			b[field] = strings.Repeat("ğ", tc.cap)
			_, err := validateCreateBody(raw(b), id, userID)
			require.NoError(t, err)
			b[field] = strings.Repeat("ğ", tc.cap+1)
			_, err = validateCreateBody(raw(b), id, userID)
			var limit *limitError
			require.ErrorAs(t, err, &limit)
			b[field] = "bad\x00text"
			_, err = validateCreateBody(raw(b), id, userID)
			require.Error(t, err)
		})
	}

	image := m{"id": id, "kind": "image", "rank": "1:a0", "version": 0, "createdBy": userID,
		"x": 0, "y": 0, "w": 100, "h": 100, "assetId": id, "url": "/uploads/board-assets/a.png",
		"width": maxImageDim, "height": 1, "crop": m{"x": 0, "y": 0, "w": 1, "h": 1}, "pixelated": false}
	_, err = validateCreateBody(raw(image), id, userID)
	require.NoError(t, err)
	image["width"] = maxImageDim + 1
	_, err = validateCreateBody(raw(image), id, userID)
	require.Error(t, err)
	image["width"], image["height"] = 4000, 4000
	_, err = validateCreateBody(raw(image), id, userID)
	require.NoError(t, err)
	image["width"] = 4001
	_, err = validateCreateBody(raw(image), id, userID)
	var limit *limitError
	require.ErrorAs(t, err, &limit)
}

func TestLocalGeometryAndZeroExtents(t *testing.T) {
	id := "aaaaaaaa-0000-4000-8000-000000000001"
	for kind := range zeroExtentKinds {
		b := m{"id": id, "kind": kind, "rank": "1:a0", "version": 0, "createdBy": userID,
			"x": 0, "y": 0, "w": 0, "h": 40, "style": m{"colour": "ink", "weight": "thin"}}
		if kind == "stroke" {
			b["points"], b["preset"] = []m{{"x": 0, "y": 0, "pressure": 0.5}, {"x": 0, "y": 40, "pressure": 0.5}}, "pen"
		} else {
			b["start"], b["end"] = m{"x": 0, "y": 0}, m{"x": 0, "y": 40}
		}
		stored, err := validateCreateBody(raw(b), id, userID)
		require.NoError(t, err, kind)
		_, err = applyPatch(stored, map[string]json.RawMessage{"w": raw(10)})
		require.Error(t, err, "bounds must stay tight after patches")
		b["w"] = 10
		_, err = validateCreateBody(raw(b), id, userID)
		require.Error(t, err, kind)
	}
	for kind := range kindFields {
		if zeroExtentKinds[kind] {
			continue
		}
		assert.Error(t, checkPositiveExtent(kind, map[string]json.RawMessage{"w": raw(0), "h": raw(1)}), kind)
	}
}

func TestCanonicalBodyByteAccounting(t *testing.T) {
	compact := json.RawMessage(`{"text":"ğ <hi>","x":1e-7,"y":2}`)
	jsonb := json.RawMessage(`{ "y": 2.0, "x": 0.0000001, "text": "ğ <hi>" }`)
	a, err := canonicalStoredBody(compact)
	require.NoError(t, err)
	b, err := canonicalStoredBody(jsonb)
	require.NoError(t, err)
	assert.Equal(t, a, b)
	h := newHarness()
	id := h.uuid()
	_, err = h.run(createChange(id, rectBody(id)))
	require.NoError(t, err)
	var spaced strings.Builder
	spaced.WriteString("{ ")
	spaced.WriteString(string(h.repo.objects[id].Body)[1:])
	o := h.repo.objects[id]
	o.Body = json.RawMessage(spaced.String())
	h.repo.objects[id] = o
	_, err = h.run(updateChange(id, 1, m{"x": 99}))
	require.NoError(t, err)
	_, err = h.run(deleteChange(id, 2))
	require.NoError(t, err)
	assert.Empty(t, h.repo.objects)
}

func TestGlobalObjectIDCollisionIsInvalidNotBoardConflict(t *testing.T) {
	h := newHarness()
	h.repo.failNext = ErrObjectIDTaken
	id := h.uuid()
	_, err := h.run(createChange(id, rectBody(id)))
	assert.Equal(t, 400, httpCode(t, err))
	assert.Empty(t, h.repo.objects)
}

func TestHexColoursAndStickyReactionsValidation(t *testing.T) {
	id := "aaaaaaaa-0000-4000-8000-000000000001"

	// Valid hex colour on rect and sticky.
	rect := rectBody(id)
	rect["style"] = m{"colour": "#3b82f6", "weight": "thin", "fill": "none"}
	_, err := validateCreateBody(raw(rect), id, userID)
	require.NoError(t, err)

	// Invalid hex colours rejected (including uppercase hex).
	for _, bad := range []string{"#fff", "#GGGGGG", "#3B82F6", "3b82f6", "#1234567"} {
		rect["style"] = m{"colour": bad, "weight": "thin", "fill": "none"}
		_, err = validateCreateBody(raw(rect), id, userID)
		assert.Error(t, err, bad)
	}

	// Sticky with custom hex tone and own reactions.
	sticky := m{
		"id": id, "kind": "sticky", "rank": "1:a0", "version": 0, "createdBy": userID,
		"x": 0, "y": 0, "w": 200, "h": 200, "text": "- [ ] task",
		"style":     m{"tone": "#ffe599", "font": "handwriting"},
		"reactions": m{"👍": []string{userID}, "🔥": []string{userID}},
	}
	stored, err := validateCreateBody(raw(sticky), id, userID)
	require.NoError(t, err)

	// Forging another user's reaction on create or patch must fail.
	sticky["reactions"] = m{"👍": []string{id}}
	_, err = validateCreateBody(raw(sticky), id, userID)
	assert.Error(t, err, "forging another user's reaction on create must fail")
	assert.Error(t, checkReactionOwnership(stored["reactions"], raw(m{"👍": []string{userID, id}}), userID))

	// Patching reactions onto a sticky without initial reactions works.
	delete(sticky, "reactions")
	storedNoReactions, err := validateCreateBody(raw(sticky), id, userID)
	require.NoError(t, err)
	patched, err := applyPatch(storedNoReactions, map[string]json.RawMessage{
		"reactions": raw(m{"❤️": []string{userID}}),
	})
	require.NoError(t, err)
	assert.Contains(t, patched, "reactions")

	// Clearing reactions to empty map works.
	_, err = applyPatch(stored, map[string]json.RawMessage{"reactions": raw(m{})})
	require.NoError(t, err)

	// Invalid reaction payloads rejected (duplicate user IDs, non-UUID user ID, non-sticky kind).
	_, err = applyPatch(stored, map[string]json.RawMessage{
		"reactions": raw(m{"👍": []string{userID, userID}}),
	})
	assert.Error(t, err, "duplicate reaction user IDs must fail")

	_, err = applyPatch(stored, map[string]json.RawMessage{
		"reactions": raw(m{"👍": []string{"not-a-uuid"}}),
	})
	assert.Error(t, err, "non-UUID reaction user ID must fail")

	rect["reactions"] = m{"👍": []string{userID}}
	rect["style"] = m{"colour": "ink", "weight": "thin", "fill": "none"}
	_, err = validateCreateBody(raw(rect), id, userID)
	assert.Error(t, err, "reactions on non-sticky must fail")
}

