package whiteboard

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The allow-lists below are the frozen v1 contract
// (frontend/src/features/whiteboard/contract/types.ts).
var (
	paletteColours = []string{"ink", "gray", "red", "orange", "yellow", "green", "blue", "purple", "pink"}
	stickyTones    = []string{"yellow", "pink", "mint", "sky"}
	fillModes      = []string{"none", "tint", "solid"}
	strokeWeights  = []string{"thin", "thick", "bold", "heavy"}
	strokePresets  = []string{"pen", "marker"}
	textSizes      = []string{"S", "M", "L", "XL"}
	textAligns     = []string{"left", "center", "right"}
)

var (
	uuidRe      = regexp.MustCompile(uuidPattern)
	rankRe      = regexp.MustCompile(rankPattern)
	hexColourRe = regexp.MustCompile(hexColourPattern)
)

// validationError is a problem with client input (HTTP 400).
type validationError struct{ msg string }

func (e *validationError) Error() string { return e.msg }

// limitError is a configured limit being exceeded (HTTP 413).
type limitError struct{ msg string }

func (e *limitError) Error() string { return e.msg }

func invalidf(format string, args ...any) error {
	return &validationError{msg: fmt.Sprintf(format, args...)}
}

func limitf(format string, args ...any) error {
	return &limitError{msg: fmt.Sprintf(format, args...)}
}

func isUUID(s string) bool { return uuidRe.MatchString(s) }

// fieldFn validates one JSON value.
type fieldFn func(raw json.RawMessage) error

func isNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func decodeNumber(raw json.RawMessage) (float64, error) {
	var v float64
	if isNull(raw) || json.Unmarshal(raw, &v) != nil {
		return 0, errors.New("must be a number")
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, errors.New("must be finite")
	}
	return v, nil
}

func coord(raw json.RawMessage) error {
	v, err := decodeNumber(raw)
	if err != nil {
		return err
	}
	if math.Abs(v) > maxCoord {
		return errors.New("out of range")
	}
	return nil
}

func extent(raw json.RawMessage) error {
	v, err := decodeNumber(raw)
	if err != nil {
		return err
	}
	if v < 0 || v > maxCoord {
		return errors.New("out of range")
	}
	return nil
}

func unitInterval(raw json.RawMessage) error {
	v, err := decodeNumber(raw)
	if err != nil {
		return err
	}
	if v < 0 || v > 1 {
		return errors.New("must be within [0, 1]")
	}
	return nil
}

func boolean(raw json.RawMessage) error {
	var v bool
	if isNull(raw) || json.Unmarshal(raw, &v) != nil {
		return errors.New("must be a boolean")
	}
	return nil
}

func cleanString(raw json.RawMessage, maxRunes int) (string, error) {
	var s string
	if isNull(raw) || json.Unmarshal(raw, &s) != nil {
		return "", errors.New("must be a string")
	}
	if !utf8.ValidString(s) || strings.ContainsRune(s, 0) {
		return "", errors.New("contains invalid characters")
	}
	if utf8.RuneCountInString(s) > maxRunes {
		return "", limitf("text exceeds %d characters", maxRunes)
	}
	return s, nil
}

func text(maxRunes int) fieldFn {
	return func(raw json.RawMessage) error {
		_, err := cleanString(raw, maxRunes)
		return err
	}
}

func oneOf(values ...string) fieldFn {
	return func(raw json.RawMessage) error {
		var s string
		if isNull(raw) || json.Unmarshal(raw, &s) != nil {
			return errors.New("must be a string")
		}
		for _, v := range values {
			if s == v {
				return nil
			}
		}
		return errors.New("unsupported value")
	}
}

func colourOrHex(values ...string) fieldFn {
	return func(raw json.RawMessage) error {
		var s string
		if isNull(raw) || json.Unmarshal(raw, &s) != nil {
			return errors.New("must be a string")
		}
		for _, v := range values {
			if s == v {
				return nil
			}
		}
		if hexColourRe.MatchString(s) {
			return nil
		}
		return errors.New("unsupported colour value")
	}
}

func stickyReactions(raw json.RawMessage) error {
	var m map[string]json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &m) != nil || m == nil {
		return errors.New("must be an object")
	}
	if len(m) > maxStickyReactionEmojis {
		return limitf("sticky exceeds %d reaction types", maxStickyReactionEmojis)
	}
	for emoji, usersRaw := range m {
		if !utf8.ValidString(emoji) || emoji == "" || strings.TrimSpace(emoji) != emoji ||
			strings.ContainsAny(emoji, "\x00\r\n\t") {
			return errors.New("invalid reaction emoji")
		}
		if utf8.RuneCountInString(emoji) > maxReactionEmojiRunes {
			return limitf("reaction emoji exceeds %d characters", maxReactionEmojiRunes)
		}
		var users []string
		if isNull(usersRaw) || json.Unmarshal(usersRaw, &users) != nil || len(users) == 0 {
			return errors.New("reaction users must be a non-empty array")
		}
		if len(users) > maxStickyReactionUsers {
			return limitf("reaction exceeds %d users", maxStickyReactionUsers)
		}
		seen := make(map[string]bool, len(users))
		for _, uid := range users {
			if !isUUID(uid) || seen[uid] {
				return errors.New("reaction users must be unique UUIDs")
			}
			seen[uid] = true
		}
	}
	return nil
}

func checkReactionOwnership(prevRaw, nextRaw json.RawMessage, userID string) error {
	decode := func(raw json.RawMessage) map[string][]string {
		if len(raw) == 0 {
			return nil
		}
		var m map[string][]string
		_ = json.Unmarshal(raw, &m)
		return m
	}
	prev := decode(prevRaw)
	next := decode(nextRaw)
	emojis := make(map[string]bool, len(prev)+len(next))
	for k := range prev {
		emojis[k] = true
	}
	for k := range next {
		emojis[k] = true
	}
	filterOthers := func(users []string) []string {
		var out []string
		for _, u := range users {
			if u != userID {
				out = append(out, u)
			}
		}
		return out
	}
	for emoji := range emojis {
		p := filterOthers(prev[emoji])
		n := filterOthers(next[emoji])
		if len(p) != len(n) {
			return invalidf("reaction changes may only modify the requesting user")
		}
		for i := range p {
			if p[i] != n[i] {
				return invalidf("reaction changes may only modify the requesting user")
			}
		}
	}
	return nil
}

func imageDim(raw json.RawMessage) error {
	v, err := decodeNumber(raw)
	if err != nil {
		return err
	}
	if v != math.Trunc(v) || v < 1 || v > maxImageDim {
		return errors.New("must be an integer from 1 to 32768")
	}
	return nil
}

func uuidField(raw json.RawMessage) error {
	s, err := cleanString(raw, 36)
	if err != nil {
		return err
	}
	if !isUUID(s) {
		return errors.New("must be a UUID")
	}
	return nil
}

func assetURL(raw json.RawMessage) error {
	var s string
	if isNull(raw) || json.Unmarshal(raw, &s) != nil {
		return errors.New("must be a string")
	}
	if len(s) == 0 || len(s) > maxURLLen || !utf8.ValidString(s) || strings.ContainsRune(s, 0) {
		return errors.New("invalid url")
	}
	if !strings.HasPrefix(s, "/uploads/") && !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		return errors.New("invalid url")
	}
	return nil
}

func validateRank(raw json.RawMessage, kind string) error {
	var s string
	if isNull(raw) || json.Unmarshal(raw, &s) != nil {
		return errors.New("must be a string")
	}
	if !rankRe.MatchString(s) || !validRankSuffix(s[2:]) {
		return errors.New("invalid rank")
	}
	// Frames sort behind everything else: "0:" for frames, "1:" for the rest.
	if (kind == "frame") != strings.HasPrefix(s, frameRankPrefix) {
		return errors.New("rank prefix does not match kind")
	}
	return nil
}

// Canonical fractional-indexing integer head + tail, shared with core/rank.ts.
func validRankSuffix(key string) bool {
	if len(key) < 2 || len(key) > maxRankSuffixLength {
		return false
	}
	for _, c := range key {
		if !strings.ContainsRune(rankAlphabet, c) {
			return false
		}
	}
	length := 0
	switch head := key[0]; {
	case head >= 'a' && head <= 'z':
		length = int(head-'a') + 2
	case head >= 'A' && head <= 'Z':
		length = int('Z'-head) + 2
	default:
		return false
	}
	return len(key) >= length && key != "A"+strings.Repeat("0", 26) &&
		!(len(key) > length && strings.HasSuffix(key, "0"))
}

// validateObject decodes raw as a JSON object and runs the field validators.
// Unknown keys and null values are rejected. With requireAll every field must
// be present (create); without it the keys are a subset (patch).
func validateObject(raw json.RawMessage, fields map[string]fieldFn, requireAll bool) error {
	return validateObjectWithOptional(raw, fields, nil, requireAll)
}

func validateObjectWithOptional(raw json.RawMessage, fields map[string]fieldFn, optional map[string]bool, requireAll bool) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return errors.New("must be an object")
	}
	for k, v := range m {
		fn, ok := fields[k]
		if !ok {
			return fmt.Errorf("unknown field %q", k)
		}
		if isNull(v) {
			return fmt.Errorf("field %q must not be null", k)
		}
		if err := fn(v); err != nil {
			var le *limitError
			if errors.As(err, &le) {
				return err
			}
			return fmt.Errorf("field %q: %w", k, err)
		}
	}
	if requireAll {
		for k := range fields {
			if optional[k] {
				continue
			}
			if _, ok := m[k]; !ok {
				return fmt.Errorf("missing field %q", k)
			}
		}
	}
	return nil
}

func objectOf(fields map[string]fieldFn) fieldFn {
	return func(raw json.RawMessage) error { return validateObject(raw, fields, true) }
}

var point = objectOf(map[string]fieldFn{"x": coord, "y": coord})

func strokePoints(raw json.RawMessage) error {
	var pts []json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &pts) != nil {
		return errors.New("must be an array")
	}
	if len(pts) == 0 {
		return errors.New("must not be empty")
	}
	if len(pts) > maxStrokePoints {
		return limitf("stroke exceeds %d points", maxStrokePoints)
	}
	pointFn := objectOf(map[string]fieldFn{"x": coord, "y": coord, "pressure": unitInterval})
	for _, p := range pts {
		if err := pointFn(p); err != nil {
			return err
		}
	}
	return nil
}

func normalizedCrop(raw json.RawMessage) error {
	if err := objectOf(map[string]fieldFn{"x": unitInterval, "y": unitInterval, "w": unitInterval, "h": unitInterval})(raw); err != nil {
		return err
	}
	var c struct{ X, Y, W, H float64 }
	if err := json.Unmarshal(raw, &c); err != nil {
		return errors.New("must be an object")
	}
	// Contract GEOMETRY_EPSILON tolerates floating-point noise only.
	if c.W <= 0 || c.H <= 0 || c.X+c.W > 1+geometryEpsilon || c.Y+c.H > 1+geometryEpsilon {
		return errors.New("crop must be a positive rectangle inside the image")
	}
	return nil
}

var strokeStyle = objectOf(map[string]fieldFn{
	"colour": colourOrHex(paletteColours...),
	"weight": oneOf(strokeWeights...),
})

var shapeStyle = objectOf(map[string]fieldFn{
	"colour": colourOrHex(paletteColours...),
	"weight": oneOf(strokeWeights...),
	"fill":   oneOf(fillModes...),
})

var textStyle = objectOf(map[string]fieldFn{
	"colour": colourOrHex(paletteColours...),
	"size":   oneOf(textSizes...),
	"font":   oneOf("app"),
	"bold":   boolean,
	"italic": boolean,
	"align":  oneOf(textAligns...),
})

var stickyStyle = objectOf(map[string]fieldFn{
	"tone": colourOrHex(stickyTones...),
	"font": oneOf("handwriting"),
})

// kindFields lists the kind-specific fields. Every object also has the base
// geometry and rank (see baseFields).
var kindFields = map[string]map[string]fieldFn{
	"stroke": {
		"points": strokePoints,
		"preset": oneOf(strokePresets...),
		"style":  strokeStyle,
	},
	"rect":    {"style": shapeStyle},
	"ellipse": {"style": shapeStyle},
	"line":    {"start": point, "end": point, "style": strokeStyle},
	"arrow":   {"start": point, "end": point, "style": strokeStyle},
	"text":    {"text": text(maxTextRunes), "style": textStyle},
	"sticky":  {"text": text(maxStickyRunes), "style": stickyStyle, "reactions": stickyReactions},
	"image": {
		"assetId":   uuidField,
		"url":       assetURL,
		"width":     imageDim,
		"height":    imageDim,
		"crop":      normalizedCrop,
		"pixelated": boolean,
	},
	"frame": {"label": text(maxLabelRunes), "style": strokeStyle},
}

// optionalKindFields lists fields that may be omitted on create.
var optionalKindFields = map[string]map[string]bool{
	"sticky": {"reactions": true},
}

// zeroExtentKinds may have a zero width or height; all others need both > 0.
var zeroExtentKinds = map[string]bool{"stroke": true, "line": true, "arrow": true}

// immutable keys can never appear in a patch.
var immutableKeys = []string{"id", "kind", "version", "createdBy"}

func fieldsFor(kind string) map[string]fieldFn {
	f := map[string]fieldFn{
		"x": coord, "y": coord, "w": extent, "h": extent,
		"rank": func(raw json.RawMessage) error { return validateRank(raw, kind) },
	}
	for k, fn := range kindFields[kind] {
		f[k] = fn
	}
	return f
}

// storedBody is an object body without id and version.
type storedBody map[string]json.RawMessage

func (b storedBody) kind() string {
	var k string
	_ = json.Unmarshal(b["kind"], &k)
	return k
}

// canonicalStoredBody makes byte accounting independent of JSONB whitespace,
// key order and numeric spelling. float64 matches the TS world's number values.
func canonicalStoredBody(raw json.RawMessage) (json.RawMessage, error) {
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func (b storedBody) marshal() (json.RawMessage, error) {
	raw, err := json.Marshal(map[string]json.RawMessage(b))
	if err != nil {
		return nil, err
	}
	raw, err = canonicalStoredBody(raw)
	if err != nil {
		return nil, err
	}
	if len(raw) > MaxObjectBytes {
		return nil, limitf("object exceeds %d bytes", MaxObjectBytes)
	}
	return raw, nil
}

func checkPositiveExtent(kind string, body map[string]json.RawMessage) error {
	if zeroExtentKinds[kind] {
		return nil
	}
	for _, k := range []string{"w", "h"} {
		raw, ok := body[k]
		if !ok {
			continue
		}
		v, err := decodeNumber(raw)
		if err != nil || v <= 0 {
			return fmt.Errorf("field %q must be greater than 0", k)
		}
	}
	return nil
}

// Cross-field checks run on FULL bodies, including after shallow patches.
func checkBodyGeometry(kind string, body map[string]json.RawMessage) error {
	if err := checkPositiveExtent(kind, body); err != nil {
		return invalidf("%s", err.Error())
	}
	if kind == "image" {
		width, _ := decodeNumber(body["width"])
		height, _ := decodeNumber(body["height"])
		if width*height > maxImagePixels {
			return limitf("image exceeds %d pixels", maxImagePixels)
		}
	}
	if !zeroExtentKinds[kind] {
		return nil
	}
	var points []struct{ X, Y float64 }
	if kind == "stroke" {
		_ = json.Unmarshal(body["points"], &points)
	} else {
		points = make([]struct{ X, Y float64 }, 2)
		_ = json.Unmarshal(body["start"], &points[0])
		_ = json.Unmarshal(body["end"], &points[1])
	}
	w, _ := decodeNumber(body["w"])
	h, _ := decodeNumber(body["h"])
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range points {
		minX, minY = math.Min(minX, p.X), math.Min(minY, p.Y)
		maxX, maxY = math.Max(maxX, p.X), math.Max(maxY, p.Y)
	}
	near := func(a, b float64) bool {
		return math.Abs(a-b) <= geometryEpsilon*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
	}
	if !near(minX, 0) || !near(minY, 0) || !near(maxX, w) || !near(maxY, h) {
		return invalidf("local points must tightly bound w and h")
	}
	return nil
}

// validateCreateBody checks a full object body for a create change and returns
// it without id and version, ready to store.
func validateCreateBody(raw json.RawMessage, id, userID string) (storedBody, error) {
	var m map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, invalidf("create requires a body object")
	}
	var kind string
	if err := json.Unmarshal(m["kind"], &kind); err != nil || kindFields[kind] == nil {
		return nil, invalidf("unsupported object kind")
	}
	var bodyID, createdBy string
	if err := json.Unmarshal(m["id"], &bodyID); err != nil || bodyID != id {
		return nil, invalidf("body id must match the change id")
	}
	var version float64
	if err := json.Unmarshal(m["version"], &version); err != nil || version != 0 {
		return nil, invalidf("body version must be 0")
	}
	if err := json.Unmarshal(m["createdBy"], &createdBy); err != nil || createdBy != userID {
		return nil, invalidf("body createdBy must be the requesting user")
	}

	fields := fieldsFor(kind)
	fields["kind"] = oneOf(kind)
	fields["id"] = uuidField
	fields["version"] = coord
	fields["createdBy"] = uuidField
	if err := validateObjectWithOptional(raw, fields, optionalKindFields[kind], true); err != nil {
		return nil, wrapFieldError(err)
	}
	if err := checkBodyGeometry(kind, m); err != nil {
		return nil, err
	}
	if kind == "sticky" && m["reactions"] != nil {
		if err := checkReactionOwnership(nil, m["reactions"], userID); err != nil {
			return nil, err
		}
	}

	delete(m, "id")
	delete(m, "version")
	return storedBody(m), nil
}

// validatePatchShape checks the parts of a patch that do not depend on the
// stored object: it is a nonempty object without immutable keys.
func validatePatchShape(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &m) != nil || m == nil {
		return nil, invalidf("update requires a patch object")
	}
	if len(m) == 0 {
		return nil, invalidf("patch must not be empty")
	}
	for _, k := range immutableKeys {
		if _, ok := m[k]; ok {
			return nil, invalidf("field %q cannot be patched", k)
		}
	}
	return m, nil
}

// applyPatch validates the patch keys and values against the stored object's
// kind and returns the merged body (shallow merge: nested values are replaced).
func applyPatch(stored storedBody, patch map[string]json.RawMessage) (storedBody, error) {
	kind := stored.kind()
	if kindFields[kind] == nil {
		return nil, fmt.Errorf("stored object has unsupported kind %q", kind)
	}
	raw, err := json.Marshal(patch)
	if err != nil {
		return nil, invalidf("invalid patch")
	}
	if err := validateObject(raw, fieldsFor(kind), false); err != nil {
		return nil, wrapFieldError(err)
	}
	if err := checkPositiveExtent(kind, patch); err != nil {
		return nil, invalidf("%s", err.Error())
	}
	merged := make(storedBody, len(stored)+len(patch))
	for k, v := range stored {
		merged[k] = v
	}
	for k, v := range patch {
		merged[k] = v
	}
	if err := checkBodyGeometry(kind, merged); err != nil {
		return nil, err
	}
	return merged, nil
}

func wrapFieldError(err error) error {
	var le *limitError
	if errors.As(err, &le) {
		return le
	}
	return invalidf("%s", err.Error())
}

// validateCommandShape runs the checks that need no stored state.
func validateCommandShape(req CommandRequest) error {
	if !isUUID(req.OpID) {
		return invalidf("opId must be a UUID")
	}
	if len(req.Changes) == 0 {
		return invalidf("changes must not be empty")
	}
	if len(req.Changes) > MaxChangesPerCommand {
		return limitf("a command can hold at most %d changes", MaxChangesPerCommand)
	}
	// Count the submitted bodies/patches, including their JSON whitespace,
	// before content validation or either the in-process or database board lock.
	var size int
	for _, ch := range req.Changes {
		switch ch.Action {
		case ActionCreate:
			size += len(ch.Body)
		case ActionUpdate:
			size += len(ch.Patch)
		}
		if size > MaxCommandBytes {
			return limitf("command bodies and patches exceed %d bytes", MaxCommandBytes)
		}
	}
	seen := make(map[string]bool, len(req.Changes))
	for _, ch := range req.Changes {
		if !isUUID(ch.ID) {
			return invalidf("change id must be a UUID")
		}
		id := ch.ID
		if seen[id] {
			return invalidf("a command may change an object only once")
		}
		seen[id] = true
		switch ch.Action {
		case ActionCreate:
			if ch.ExpectedVersion == nil || *ch.ExpectedVersion != 0 || len(ch.Patch) > 0 {
				return invalidf("create requires expectedVersion 0 and a body")
			}
			if ch.ExpectedSeq != nil && *ch.ExpectedSeq < 0 {
				return invalidf("expectedSeq must be nonnegative")
			}
		case ActionUpdate:
			if ch.ExpectedSeq != nil {
				return invalidf("expectedSeq is create-only")
			}
			if ch.ExpectedVersion == nil || *ch.ExpectedVersion <= 0 {
				return invalidf("update requires a positive expectedVersion")
			}
			if len(ch.Body) > 0 {
				return invalidf("update takes only a patch")
			}
		case ActionDelete:
			if ch.ExpectedSeq != nil {
				return invalidf("expectedSeq is create-only")
			}
			if ch.ExpectedVersion == nil || *ch.ExpectedVersion <= 0 {
				return invalidf("delete requires a positive expectedVersion")
			}
			if len(ch.Body) > 0 || len(ch.Patch) > 0 {
				return invalidf("delete takes neither body nor patch")
			}
		default:
			return invalidf("action must be create, update or delete")
		}
	}
	return nil
}
