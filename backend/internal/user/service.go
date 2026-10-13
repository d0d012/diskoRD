package user

import (
	"context"
	"fmt"
	"io"
	"path"
	"regexp"
	"sync"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

const (
	maxDisplayNameRunes = 64
	maxBioRunes         = 190
)

var bannerColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var validPreferredStatuses = map[string]bool{
	"online":    true,
	"idle":      true,
	"dnd":       true,
	"invisible": true,
}

// repository is the subset of the persistence layer the service uses. It is an
// interface so the service can be unit-tested with testify mocks.
type repository interface {
	GetByID(ctx context.Context, id string) (*User, error)
	FindByUsername(ctx context.Context, username string) (*User, error)
	UpdateProfile(ctx context.Context, id string, p UpdateProfileParams) (*User, error)
	SetAvatarURL(ctx context.Context, id string, url *string) (*User, error)
	SetPreferredStatus(ctx context.Context, id, status string) (*User, error)
	GetPreferredStatus(ctx context.Context, id string) (string, error)
}

// Storage is the file-storage subset used for avatars.
type Storage interface {
	SaveAvatar(userID, mimeType string, r io.Reader) (string, error)
	DeleteAvatars(userID string) error
	DeleteAvatarsExcept(userID, keepFilename string) error
}

// Publisher fans a user's public profile changes out to other users. It is
// implemented by the gateway hub.
type Publisher interface {
	PublishUserUpdate(userID string, public any, self any)
	PublishPresenceChange(userID, status string, self any)
}

type Service struct {
	repo    repository
	storage Storage
	pub     Publisher
	// avatarMu serialises per-user avatar file + database operations so a
	// concurrent upload and delete cannot remove each other's file.
	avatarMu sync.Map // userID -> *sync.Mutex
}

func NewService(repo repository, storage Storage) *Service {
	return &Service{repo: repo, storage: storage}
}

func (s *Service) avatarLock(userID string) *sync.Mutex {
	mu, _ := s.avatarMu.LoadOrStore(userID, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

func (s *Service) SetPublisher(p Publisher) {
	s.pub = p
}

func (s *Service) GetProfile(ctx context.Context, id string) (*UserResponse, error) {
	u, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	resp := u.ToPublicResponse()
	return &resp, nil
}

func (s *Service) FindByUsername(ctx context.Context, username string) (*UserResponse, error) {
	u, err := s.repo.FindByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	resp := u.ToPublicResponse()
	return &resp, nil
}

func (s *Service) GetPreferredStatus(ctx context.Context, id string) (string, error) {
	return s.repo.GetPreferredStatus(ctx, id)
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, p UpdateProfileParams) (*SelfUserResponse, error) {
	if err := validateProfile(p); err != nil {
		return nil, err
	}
	u, err := s.repo.UpdateProfile(ctx, userID, p)
	if err != nil {
		return nil, err
	}
	s.publishUserUpdate(u)
	resp := u.ToSelfResponse()
	return &resp, nil
}

// SetAvatar stores the uploaded image and points the user at it. The database is
// updated before the previous files are removed, so a database failure never
// leaves the account pointing at a deleted file.
func (s *Service) SetAvatar(ctx context.Context, userID, mimeType string, r io.Reader) (*SelfUserResponse, error) {
	lock := s.avatarLock(userID)
	lock.Lock()
	defer lock.Unlock()

	url, err := s.storage.SaveAvatar(userID, mimeType, r)
	if err != nil {
		return nil, fmt.Errorf("user.Service.SetAvatar: %w", err)
	}
	u, err := s.repo.SetAvatarURL(ctx, userID, &url)
	if err != nil {
		return nil, err
	}
	// Best-effort cleanup; the new file is already the one the database serves.
	_ = s.storage.DeleteAvatarsExcept(userID, path.Base(url))

	s.publishUserUpdate(u)
	resp := u.ToSelfResponse()
	return &resp, nil
}

func (s *Service) RemoveAvatar(ctx context.Context, userID string) (*SelfUserResponse, error) {
	lock := s.avatarLock(userID)
	lock.Lock()
	defer lock.Unlock()

	u, err := s.repo.SetAvatarURL(ctx, userID, nil)
	if err != nil {
		return nil, err
	}
	_ = s.storage.DeleteAvatars(userID)

	s.publishUserUpdate(u)
	resp := u.ToSelfResponse()
	return &resp, nil
}

// SetPreferredStatus persists the user's chosen status and tells the hub so it
// can update the presence value and broadcast a visible status.
func (s *Service) SetPreferredStatus(ctx context.Context, userID, status string) error {
	if !validPreferredStatuses[status] {
		return fiber.NewError(fiber.StatusBadRequest, "status must be one of online, idle, dnd, invisible")
	}
	u, err := s.repo.SetPreferredStatus(ctx, userID, status)
	if err != nil {
		return err
	}
	if s.pub != nil {
		s.pub.PublishPresenceChange(userID, status, u.SelfPayload())
	}
	return nil
}

func (s *Service) publishUserUpdate(u *User) {
	if s.pub == nil {
		return
	}
	s.pub.PublishUserUpdate(u.ID, u.PublicPayload(), u.SelfPayload())
}

func validateProfile(p UpdateProfileParams) error {
	if p.DisplayName != nil && utf8.RuneCountInString(*p.DisplayName) > maxDisplayNameRunes {
		return fiber.NewError(fiber.StatusBadRequest, "display name must be at most 64 characters")
	}
	if p.Bio != nil && utf8.RuneCountInString(*p.Bio) > maxBioRunes {
		return fiber.NewError(fiber.StatusBadRequest, "about me must be at most 190 characters")
	}
	if p.BannerColor != nil && *p.BannerColor != "" && !bannerColorRe.MatchString(*p.BannerColor) {
		return fiber.NewError(fiber.StatusBadRequest, "banner color must be a hex color like #5865f2")
	}
	return nil
}
