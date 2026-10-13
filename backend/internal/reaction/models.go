package reaction

type Reaction struct {
	MessageID   string `json:"messageId"`
	UserID      string `json:"userId"`
	Emoji       string `json:"emoji"`
	Count       int    `json:"count"`
	SelfReacted bool   `json:"selfReacted"`
}

type ReactionEvent struct {
	MessageID string `json:"messageId"`
	ChannelID string `json:"channelId"`
	GuildID   string `json:"guildId"`
	Emoji     string `json:"emoji"`
	UserID    string `json:"userId"`
	Action    string `json:"action"` // "add" or "remove"
	// Count is the total number of reactions for this emoji on this message
	// after the change (0 when the last one was removed).
	Count int `json:"count"`
}

// EventPublisher is implemented by the gateway hub.
type EventPublisher interface {
	PublishToGuild(guildID, op string, data interface{})
	PublishToDM(user1ID, user2ID, op string, data interface{})
}
