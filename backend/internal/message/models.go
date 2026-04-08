package message

import "time"

type Message struct {
	ID        string     `db:"id"`
	ChannelID string     `db:"channel_id"`
	AuthorID  *string    `db:"author_id"`
	Content   string     `db:"content"`
	CreatedAt time.Time  `db:"created_at"`
	EditedAt  *time.Time `db:"edited_at"`
	DeletedAt *time.Time `db:"deleted_at"`
}

type AuthorInfo struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl"`
}

type MessageResponse struct {
	ID          string     `json:"id"`
	ChannelID   string     `json:"channelId"`
	GuildID     string     `json:"guildId"`
	Author      AuthorInfo `json:"author"`
	Content     string     `json:"content"`
	CreatedAt   time.Time  `json:"createdAt"`
	EditedAt    *time.Time `json:"editedAt,omitempty"`
	Mentions    []string   `json:"mentions,omitempty"`
	Attachments []string   `json:"attachments,omitempty"` // public URLs
}

type CreateMessageRequest struct {
	Content string `json:"content" validate:"required,min=1,max=2000"`
}

type EditMessageRequest struct {
	Content string `json:"content" validate:"required,min=1,max=2000"`
}

type MessagesPage struct {
	Items   []MessageResponse `json:"items"`
	HasMore bool              `json:"hasMore"`
}

// EventPublisher is implemented by the gateway hub.
// The message service calls this after a successful DB write.
type EventPublisher interface {
	PublishToGuild(guildID, op string, data interface{})
	// PublishToDM delivers an event directly to both DM participants.
	PublishToDM(user1ID, user2ID, op string, data interface{})
}
