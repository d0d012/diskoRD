package decoration

import (
	"encoding/json"
	"time"
)

// MaxPerMessage caps how many decorations one message can carry.
const MaxPerMessage = 3

// Vertical offset bounds relative to the anchor message's top. Decorations are
// placed anywhere in the chat and anchored to the message under the pointer,
// so they may extend above it or down past tall (image) messages.
const (
	MinY = -256
	MaxY = 1024
)

// Opacity is a percentage. Clients from before migration 000022 send none
// and get the original faint default.
const (
	MinOpacity     = 10
	MaxOpacity     = 100
	DefaultOpacity = 35
)

// AllowedSizes are the display sizes in CSS pixels.
var AllowedSizes = map[int]bool{32: true, 48: true, 64: true, 96: true, 128: true, 192: true, 256: true}

// Decoration is a pixel art piece pinned behind a message.
type Decoration struct {
	ID        string          `json:"id"`
	MessageID string          `json:"messageId"`
	AuthorID  *string         `json:"authorId"`
	Doc       json.RawMessage `json:"doc"`
	// X is the horizontal center in percent of the message row width (0-100).
	X int `json:"x"`
	// Y is the top offset in pixels from the anchor row's top (MinY..MaxY).
	Y         int       `json:"y"`
	Size      int       `json:"size"`
	Opacity   int       `json:"opacity"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreateRequest struct {
	Doc  json.RawMessage `json:"doc"`
	X    int             `json:"x"`
	Y    int             `json:"y"`
	Size int             `json:"size"`
	// Opacity in percent; 0 (omitted) means DefaultOpacity.
	Opacity int `json:"opacity"`
}

// Target is what a delete needs to know about a decoration.
type Target struct {
	MessageID       string
	ChannelID       string
	GuildID         string
	AuthorID        *string
	MessageAuthorID *string
}

type AddEvent struct {
	Decoration
	ChannelID string `json:"channelId"`
	GuildID   string `json:"guildId"`
}

type RemoveEvent struct {
	ID        string `json:"id"`
	MessageID string `json:"messageId"`
	ChannelID string `json:"channelId"`
	GuildID   string `json:"guildId"`
}

// EventPublisher is implemented by the gateway hub.
type EventPublisher interface {
	PublishToGuild(guildID, op string, data interface{})
	PublishToDM(user1ID, user2ID, op string, data interface{})
}
