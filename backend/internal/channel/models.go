package channel

import "time"

type Channel struct {
	ID        string
	GuildID   string
	Name      string
	Type      string
	Position  int
	CreatedAt time.Time
	UpdatedAt time.Time
}

type CreateChannelRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100"`
	Type string `json:"type" validate:"required,oneof=text voice"`
}

type UpdateChannelRequest struct {
	Name     *string `json:"name" validate:"omitempty,min=1,max=100"`
	Position *int    `json:"position" validate:"omitempty,min=0"`
}

type ChannelResponse struct {
	ID        string    `json:"id"`
	GuildID   string    `json:"guildId"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (c *Channel) ToResponse() ChannelResponse {
	return ChannelResponse{
		ID:        c.ID,
		GuildID:   c.GuildID,
		Name:      c.Name,
		Type:      c.Type,
		Position:  c.Position,
		CreatedAt: c.CreatedAt,
		UpdatedAt: c.UpdatedAt,
	}
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
