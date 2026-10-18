package pixelart

import (
	"encoding/json"
	"time"
)

const (
	// MaxGallery caps how many pieces one user can save.
	MaxGallery = 50
	// MaxShowcase caps the public, ordered showcase on a profile.
	MaxShowcase = 15
	// MaxBuddies caps the characters placed on a profile card.
	MaxBuddies  = 5
	MaxTitleLen = 40

	MinBuddyHeight = 16
	MaxBuddyHeight = 128
	MaxBuddyY      = 1000
)

// UserRef is the minimal public identity shown in remix credits.
type UserRef struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
}

// Art is one saved piece in a user's gallery.
type Art struct {
	ID      string          `json:"id"`
	OwnerID string          `json:"ownerId"`
	Title   string          `json:"title"`
	Doc     json.RawMessage `json:"doc"`
	// ShowcasePosition is 0-14 when the piece is shown on the profile, nil otherwise.
	ShowcasePosition *int      `json:"showcasePosition"`
	RemixOf          *string   `json:"remixOf"`
	RemixAuthor      *UserRef  `json:"remixAuthor"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// Buddy is a gallery piece placed on the owner's profile card.
type Buddy struct {
	ArtID string `json:"artId"`
	// X is the left edge in percent of the card width; Y is px from the card top.
	X      int  `json:"x"`
	Y      int  `json:"y"`
	Height int  `json:"height"`
	Flip   bool `json:"flip"`
	// Front draws the buddy over the card's content boxes instead of behind them.
	Front bool `json:"front"`
}

// PlacedBuddy is a buddy with its art, as shown to anyone viewing the card.
type PlacedBuddy struct {
	Buddy
	Doc json.RawMessage `json:"doc"`
}

// Profile is everything a profile card needs from this package, in one request.
type Profile struct {
	Showcase []Art         `json:"showcase"`
	Buddies  []PlacedBuddy `json:"buddies"`
}

type CreateRequest struct {
	Title string          `json:"title"`
	Doc   json.RawMessage `json:"doc"`
	// RemixOf is the id of a showcased (public) piece this one was copied from.
	RemixOf *string `json:"remixOf"`
}

// UpdateRequest changes a piece; nil fields stay as they are.
type UpdateRequest struct {
	Title *string         `json:"title"`
	Doc   json.RawMessage `json:"doc"`
}

type ShowcaseRequest struct {
	IDs []string `json:"ids"`
}

type BuddiesRequest struct {
	Buddies []Buddy `json:"buddies"`
}

// ProfileEvent tells clients a user's showcase or buddies changed; they refetch.
type ProfileEvent struct {
	UserID string `json:"userId"`
}

// Publisher fans profile changes out to everyone who can see the user (same
// audience as USER_UPDATE: their guilds, DM partners and own sessions).
type Publisher interface {
	PublishToUserAudience(userID, op string, data any)
}
