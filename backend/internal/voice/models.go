package voice

// VoiceTokenResponse is returned when a user joins a voice channel.
type VoiceTokenResponse struct {
	Token string `json:"token"`
	URL   string `json:"url"`
}

// VoiceStateUpdate is broadcast via the gateway when a user joins or leaves a voice channel.
type VoiceStateUpdate struct {
	UserID    string `json:"userId"`
	Username  string `json:"username"`
	ChannelID string `json:"channelId"`
	GuildID   string `json:"guildId"`
	Joined    bool   `json:"joined"`
}

// Response wraps a data payload.
type Response struct {
	Data interface{} `json:"data"`
}
