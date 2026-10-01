package guild

import "time"

type Guild struct {
	ID        string
	Name      string
	IconURL   *string
	OwnerID   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type GuildMember struct {
	GuildID  string
	UserID   string
	Role     string
	JoinedAt time.Time
}

type Channel struct {
	ID        string
	GuildID   string
	Name      string
	Type      string
	Position  int
	CreatedAt time.Time
	UpdatedAt time.Time
}

type CreateGuildRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100"`
}

type UpdateGuildRequest struct {
	Name    *string `json:"name" validate:"omitempty,min=1,max=100"`
	IconURL *string `json:"iconUrl" validate:"omitempty,url"`
}

type GuildResponse struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	IconURL   *string           `json:"iconUrl,omitempty"`
	OwnerID   string            `json:"ownerId"`
	Channels  []ChannelResponse `json:"channels"`
	CreatedAt time.Time         `json:"createdAt"`
}

type ChannelResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Position int    `json:"position"`
}

type GuildListItem struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	IconURL   *string   `json:"iconUrl,omitempty"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
}

func (g *Guild) ToResponse(channels []Channel) GuildResponse {
	chResp := make([]ChannelResponse, len(channels))
	for i, ch := range channels {
		chResp[i] = ChannelResponse{
			ID:       ch.ID,
			Name:     ch.Name,
			Type:     ch.Type,
			Position: ch.Position,
		}
	}
	return GuildResponse{
		ID:        g.ID,
		Name:      g.Name,
		IconURL:   g.IconURL,
		OwnerID:   g.OwnerID,
		Channels:  chResp,
		CreatedAt: g.CreatedAt,
	}
}

func (g *Guild) ToListItem() GuildListItem {
	return GuildListItem{
		ID:        g.ID,
		Name:      g.Name,
		IconURL:   g.IconURL,
		OwnerID:   g.OwnerID,
		CreatedAt: g.CreatedAt,
	}
}

// RoleRef is a lightweight role reference embedded in MemberResponse.
type RoleRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Position int    `json:"position"`
	Hoist    bool   `json:"hoist"`
}

type MemberResponse struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName *string   `json:"displayName,omitempty"`
	AvatarURL   *string   `json:"avatarUrl,omitempty"`
	Role        string    `json:"role"`
	Roles       []RoleRef `json:"roles"`
	JoinedAt    time.Time `json:"joinedAt"`
	Status      string    `json:"status"` // presence: online | offline
}

type UpdateMemberRoleRequest struct {
	Role string `json:"role" validate:"required,oneof=admin moderator member"`
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// EventPublisher is implemented by the gateway hub.
type EventPublisher interface {
	PublishToGuild(guildID, op string, data interface{})
	NotifyUser(userID, op string, data interface{})
	RemoveClientGuild(userID, guildID string)
}
