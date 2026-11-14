package whiteboard

import (
	"context"
	"encoding/json"
	"time"
)

// Contract revision 2. Mirrored from frontend/src/features/whiteboard/contract/limits.ts;
// contract_test.go checks cross-language parity (Go cannot import TypeScript).
const (
	ChannelTypeWhiteboard = "whiteboard"

	MaxObjectsPerBoard          = 5000
	MaxBoardBytes               = 10_000_000
	MaxObjectBytes              = 32 * 1024
	MaxChangesPerCommand        = 500
	maxCoord                    = 10_000_000
	maxStrokePoints             = 2048
	maxTextRunes                = 10000
	maxStickyRunes              = 5000
	maxLabelRunes               = 256
	maxURLLen                   = 2048
	maxImageDim                 = 32768
	maxImagePixels              = 16_000_000
	MaxImageBytes               = 8 * 1024 * 1024
	MaxImageMegapixels          = 16
	MaxReferencedAssetsPerBoard = 100
	MaxUploadsPerMinute         = 10
	UploadRateWindow            = time.Minute
	geometryEpsilon             = 1e-9
	maxRankSuffixLength         = 64
	rankAlphabet                = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	frameRankPrefix             = "0:"
	objectRankPrefix            = "1:"
	rankPattern                 = `^[01]:[0-9A-Za-z]{1,64}$`
	uuidPattern                 = `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
	hexColourPattern            = `^#[0-9a-f]{6}$`
	maxStickyReactionEmojis     = 16
	maxStickyReactionUsers      = 100
	maxReactionEmojiRunes       = 16

	// OpTTL is how long a command result is remembered for resends.
	OpTTL = 10 * time.Minute
)

// Change actions.
const (
	ActionCreate = "create"
	ActionUpdate = "update"
	ActionDelete = "delete"
)

// ChannelInfo is the slice of a channel the service needs.
type ChannelInfo struct {
	ID      string
	GuildID string
	Type    string
}

// Object is a stored board object. Body is the JSON object without its id and
// version, which live in columns.
type Object struct {
	ID      string
	Version int64
	Body    json.RawMessage
}

// Asset is metadata persisted in whiteboard_assets. The public URL is derived
// from StorageKey using the same storage configuration as chat attachments.
type Asset struct {
	ID, BoardID, StorageKey, MIME, UploadedBy string
	Bytes, Width, Height                      int
}

// UploadedAsset is the multipart endpoint's response data.
type UploadedAsset struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// ChangeRequest is one change of a command, exactly as the client sent it.
type ChangeRequest struct {
	ID              string          `json:"id"`
	Action          string          `json:"action"`
	ExpectedVersion *int64          `json:"expectedVersion,omitempty"` // create: required 0 (absent)
	ExpectedSeq     *int64          `json:"expectedSeq,omitempty"`     // create only: exact board seq guard
	Body            json.RawMessage `json:"body,omitempty"`
	Patch           json.RawMessage `json:"patch,omitempty"`
}

// CommandRequest is the POST /channels/:id/board/ops body.
type CommandRequest struct {
	OpID    string          `json:"opId"`
	Changes []ChangeRequest `json:"changes"`
}

// ChangeResult acknowledges one change; version equals the command's seq.
type ChangeResult struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	Version int64  `json:"version"`
}

// CommandResult is the success data of the ops endpoint.
type CommandResult struct {
	Seq     int64          `json:"seq"`
	Changes []ChangeResult `json:"changes"`
}

// Snapshot is the GET /channels/:id/board data.
type Snapshot struct {
	Seq     int64             `json:"seq"`
	Objects []json.RawMessage `json:"objects"`
}

// CommittedChange is one change of a BOARD_COMMIT payload. Create carries the
// full body (version == seq), update the patch as submitted, delete neither.
type CommittedChange struct {
	ID      string          `json:"id"`
	Action  string          `json:"action"`
	Version int64           `json:"version"`
	Body    json.RawMessage `json:"body,omitempty"`
	Patch   json.RawMessage `json:"patch,omitempty"`
}

// CommitPayload is the BOARD_COMMIT event data.
type CommitPayload struct {
	ChannelID string            `json:"channelId"`
	OpID      string            `json:"opId"`
	Seq       int64             `json:"seq"`
	UserID    string            `json:"userId"`
	Changes   []CommittedChange `json:"changes"`
}

// Publisher broadcasts a committed command to the board's subscribers.
type Publisher interface {
	PublishBoardCommit(ctx context.Context, guildID, channelID string, payload CommitPayload)
}

// OpRecord is what the idempotency store remembers about a command.
type OpRecord struct {
	ChannelID string        `json:"channelId"`
	UserID    string        `json:"userId"`
	Result    CommandResult `json:"result"`
}

// OpStore remembers command results so a resend returns the original result.
type OpStore interface {
	Get(ctx context.Context, opID string) (*OpRecord, error) // nil, nil when unknown
	Put(ctx context.Context, opID string, rec OpRecord) error
}

// GuildMembership is the membership check the service needs.
type GuildMembership interface {
	IsMember(ctx context.Context, guildID, userID string) (bool, error)
}

// Response is the standard envelope.
type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// Rejection codes carried in the 409 body.
const (
	CodeConflict = "conflict"
	CodeGone     = "gone"
)

// ConflictError reports a stale or impossible write. Current holds the
// authoritative objects (full wire bodies) for every touched id still present.
type ConflictError struct {
	Seq     int64 // board seq at evaluation; does not advance on rejection
	Code    string
	Message string
	Current []json.RawMessage
}

func (e *ConflictError) Error() string { return "whiteboard: " + e.Code + ": " + e.Message }

// ConflictResponse is the 409 body: the error envelope plus current objects.
type ConflictResponse struct {
	Seq     int64             `json:"seq"`
	Error   string            `json:"error"`
	Code    string            `json:"code"`
	Current []json.RawMessage `json:"current"`
}
