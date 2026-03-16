package user

import "time"

type UpdateProfileRequest struct {
	DisplayName *string `json:"displayName" validate:"omitempty,max=64"`
	AvatarURL   *string `json:"avatarUrl" validate:"omitempty,url,max=512"`
}

type UserResponse struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName *string   `json:"displayName,omitempty"`
	AvatarURL   *string   `json:"avatarUrl,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type User struct {
	ID           string
	Username     string
	Email        string
	PasswordHash string
	DisplayName  *string
	AvatarURL    *string
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (u *User) ToPublicResponse() UserResponse {
	return UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Status:      u.Status,
		CreatedAt:   u.CreatedAt,
	}
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
