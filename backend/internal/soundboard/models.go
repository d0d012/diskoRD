package soundboard

import "time"

const MaxAudioBytes = 720044 // 15 seconds, mono PCM16 at 24 kHz, plus WAV header
const MaxGuildSounds = 64

type Sound struct {
	ID        string    `json:"id"`
	GuildID   string    `json:"guildId"`
	CreatorID *string   `json:"creatorId"`
	Name      string    `json:"name"`
	CanDelete bool      `json:"canDelete"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type CreateRequest struct {
	Name  string `json:"name"`
	Audio []byte `json:"audio"` // base64 canonical WAV; bounded independently on the server
}
