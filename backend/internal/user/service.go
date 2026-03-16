package user

import "context"

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetProfile(ctx context.Context, id string) (*UserResponse, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	resp := u.ToPublicResponse()
	return &resp, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, req UpdateProfileRequest) (*UserResponse, error) {
	u, err := s.repo.UpdateProfile(ctx, userID, req.DisplayName, req.AvatarURL)
	if err != nil {
		return nil, err
	}
	resp := u.ToPublicResponse()
	return &resp, nil
}
