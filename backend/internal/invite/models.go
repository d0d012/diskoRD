package invite

import "time"

type Invite struct {
	Code      string
	GuildID   string
	CreatorID string
	MaxUses   *int
	UseCount  int
	ExpiresAt *time.Time
	CreatedAt time.Time
}

type CreateInviteRequest struct {
	MaxUses   *int       `json:"maxUses"`
	ExpiresAt *time.Time `json:"expiresAt"`
}

type InviteResponse struct {
	Code      string     `json:"code"`
	GuildID   string     `json:"guildId"`
	CreatorID string     `json:"creatorId"`
	MaxUses   *int       `json:"maxUses,omitempty"`
	UseCount  int        `json:"useCount"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

func (i *Invite) ToResponse() InviteResponse {
	return InviteResponse{
		Code:      i.Code,
		GuildID:   i.GuildID,
		CreatorID: i.CreatorID,
		MaxUses:   i.MaxUses,
		UseCount:  i.UseCount,
		ExpiresAt: i.ExpiresAt,
		CreatedAt: i.CreatedAt,
	}
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
