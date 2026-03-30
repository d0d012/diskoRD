package friend

import "time"

type Friendship struct {
	ID         string
	SenderID   string
	ReceiverID string
	Status     string // pending | accepted | blocked
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type FriendResponse struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName,omitempty"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Status      string  `json:"status"` // presence status
}

type FriendRequestResponse struct {
	ID         string         `json:"id"`         // friendship ID
	Direction  string         `json:"direction"`  // "incoming" | "outgoing"
	User       FriendResponse `json:"user"`       // the other party
	CreatedAt  time.Time      `json:"createdAt"`
}

type DMChannel struct {
	ID        string    `json:"id"`
	UserAID   string    `json:"-"`
	UserBID   string    `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

type DMChannelResponse struct {
	ID           string         `json:"id"`
	Recipient    FriendResponse `json:"recipient"`
	CreatedAt    time.Time      `json:"createdAt"`
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// FriendNotifier is implemented by the gateway hub.
// The friend service calls this to push real-time events to users.
type FriendNotifier interface {
	NotifyUser(userID, op string, data interface{})
}
