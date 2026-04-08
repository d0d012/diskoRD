package role

import "time"

type Role struct {
	ID        string
	GuildID   string
	Name      string
	Color     string
	Position  int
	Hoist     bool
	CreatedAt time.Time
}

type RoleResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Color       string `json:"color"`
	Position    int    `json:"position"`
	Hoist       bool   `json:"hoist"`
	MemberCount int    `json:"memberCount"`
}

type CreateRoleRequest struct {
	Name  string `json:"name" validate:"required,min=1,max=100"`
	Color string `json:"color" validate:"omitempty,hexcolor"`
	Hoist bool   `json:"hoist"`
}

type UpdateRoleRequest struct {
	Name     *string `json:"name" validate:"omitempty,min=1,max=100"`
	Color    *string `json:"color" validate:"omitempty,hexcolor"`
	Position *int    `json:"position"`
	Hoist    *bool   `json:"hoist"`
}

type ReorderItem struct {
	ID       string `json:"id"`
	Position int    `json:"position"`
}

type ReorderRequest struct {
	Roles []ReorderItem `json:"roles" validate:"required,min=1"`
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

func (r *Role) ToResponse(memberCount int) RoleResponse {
	return RoleResponse{
		ID:          r.ID,
		Name:        r.Name,
		Color:       r.Color,
		Position:    r.Position,
		Hoist:       r.Hoist,
		MemberCount: memberCount,
	}
}
