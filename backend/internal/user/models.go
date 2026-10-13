package user

import "time"

// UpdateProfileRequest is the JSON body for PATCH /users/me. Avatars are only
// settable through upload, so there is deliberately no avatarUrl field here.
type UpdateProfileRequest struct {
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	BannerColor *string `json:"bannerColor"`
}

// SetPresenceRequest is the JSON body for PUT /users/me/presence.
type SetPresenceRequest struct {
	Status string `json:"status"`
}

// UpdateProfileParams carries the fields to change. A nil field is left
// unchanged; a pointer to "" clears the column to NULL.
type UpdateProfileParams struct {
	DisplayName *string
	Bio         *string
	BannerColor *string
}

// UserResponse is the public view of a user. Live presence is never part of it:
// clients learn status from PRESENCE_UPDATE / READY.
type UserResponse struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName *string   `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl"`
	Bio         *string   `json:"bio"`
	BannerColor *string   `json:"bannerColor"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

// SelfUserResponse is returned to the user themself and additionally carries the
// stored preferred status so the status picker is correct after a reload.
type SelfUserResponse struct {
	UserResponse
	PreferredStatus string `json:"preferredStatus"`
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

func (u *User) ToPublicResponse() UserResponse {
	return UserResponse{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Bio:         u.Bio,
		BannerColor: u.BannerColor,
		Status:      u.Status,
		CreatedAt:   u.CreatedAt,
	}
}

func (u *User) ToSelfResponse() SelfUserResponse {
	return SelfUserResponse{
		UserResponse:    u.ToPublicResponse(),
		PreferredStatus: u.PreferredStatus,
	}
}

// PublicPayload is the USER_UPDATE broadcast body sent to other users.
func (u *User) PublicPayload() map[string]any {
	return map[string]any{
		"id":          u.ID,
		"username":    u.Username,
		"displayName": u.DisplayName,
		"avatarUrl":   u.AvatarURL,
		"bio":         u.Bio,
		"bannerColor": u.BannerColor,
	}
}

// SelfPayload is the USER_UPDATE copy sent back to the user's own connections.
func (u *User) SelfPayload() map[string]any {
	payload := u.PublicPayload()
	payload["preferredStatus"] = u.PreferredStatus
	return payload
}

type Response struct {
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}
