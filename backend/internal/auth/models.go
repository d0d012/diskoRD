package auth

import "time"

type RegisterRequest struct {
	Username string `json:"username" validate:"required,min=3,max=32,alphanum"`
	Email    string `json:"email" validate:"required,email,max=255"`
	Password string `json:"password" validate:"required,min=8,max=128"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
	// RememberMe defaults to true when omitted.
	RememberMe *bool `json:"rememberMe"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
}

type AuthResponse struct {
	AccessToken  string       `json:"accessToken"`
	RefreshToken string       `json:"refreshToken"`
	User         UserResponse `json:"user"`
}

type UserResponse struct {
	ID              string    `json:"id"`
	Username        string    `json:"username"`
	Email           string    `json:"email,omitempty"`
	DisplayName     *string   `json:"displayName"`
	AvatarURL       *string   `json:"avatarUrl"`
	Bio             *string   `json:"bio"`
	BannerColor     *string   `json:"bannerColor"`
	PreferredStatus string    `json:"preferredStatus"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
}

type User struct {
	ID              string
	Username        string
	Email           string
	PasswordHash    string
	DisplayName     *string
	AvatarURL       *string
	Bio             *string
	BannerColor     *string
	PreferredStatus string
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (u *User) ToResponse(includeEmail bool) UserResponse {
	resp := UserResponse{
		ID:              u.ID,
		Username:        u.Username,
		DisplayName:     u.DisplayName,
		AvatarURL:       u.AvatarURL,
		Bio:             u.Bio,
		BannerColor:     u.BannerColor,
		PreferredStatus: u.PreferredStatus,
		Status:          u.Status,
		CreatedAt:       u.CreatedAt,
	}
	if includeEmail {
		resp.Email = u.Email
	}
	return resp
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
