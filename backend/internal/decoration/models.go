package decoration

import (
	"encoding/json"
	"time"
)

// MaxPerMessage caps how many decorations one message can carry.
const MaxPerMessage = 3

// AllowedSizes are the display sizes in CSS pixels.
var AllowedSizes = map[int]bool{32: true, 48: true, 64: true, 96: true, 128: true}

// Decoration is a pixel art piece pinned behind a message.
type Decoration struct {
	ID        string          `json:"id"`
	MessageID string          `json:"messageId"`
	AuthorID  *string         `json:"authorId"`
	Doc       json.RawMessage `json:"doc"`
	// X is the horizontal center in percent of the message row width (0-100).
	X int `json:"x"`
	// Y is the top offset in pixels below the row top (0-64).
	Y         int       `json:"y"`
	Size      int       `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreateRequest struct {
	Doc  json.RawMessage `json:"doc"`
	X    int             `json:"x"`
	Y    int             `json:"y"`
	Size int             `json:"size"`
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
