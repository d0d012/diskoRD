package pixelart

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// OpProfileUpdate tells clients to refetch a user's showcase and buddies.
const OpProfileUpdate = "PIXEL_PROFILE_UPDATE"

// repository is the persistence the service needs, mockable in tests.
type repository interface {
	List(ctx context.Context, ownerID string) ([]Art, error)
	Get(ctx context.Context, id string) (*Art, error)
	Create(ctx context.Context, ownerID, title string, doc json.RawMessage, remixOf, remixAuthorID *string) (*Art, error)
	Update(ctx context.Context, ownerID, id string, title *string, doc json.RawMessage) (*Art, error)
	Delete(ctx context.Context, ownerID, id string) error
	SetShowcase(ctx context.Context, ownerID string, ids []string) error
	SetBuddies(ctx context.Context, ownerID string, buddies []Buddy) error
	Profile(ctx context.Context, userID string) (*Profile, error)
	UserExists(ctx context.Context, userID string) (bool, error)
	SetBanner(ctx context.Context, userID string, builtin *string, doc json.RawMessage) error
	DeleteBanner(ctx context.Context, userID string) error
}

// bannerSizes are the canvases that fill the 300×96 card banner at ×3 and ×2.
var bannerSizes = map[[2]int]bool{{100, 32}: true, {150, 48}: true}

type Service struct {
	repo repository
	pub  Publisher
}

func NewService(repo repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) SetPublisher(pub Publisher) {
	s.pub = pub
}

func (s *Service) changed(userID string) {
	if s.pub != nil {
		s.pub.PublishToUserAudience(userID, OpProfileUpdate, ProfileEvent{UserID: userID})
	}
}

func badRequest(msg string) error {
	return fiber.NewError(fiber.StatusBadRequest, msg)
}

func cleanTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if !utf8.ValidString(title) || utf8.RuneCountInString(title) > MaxTitleLen {
		return "", badRequest("title must be at most 40 characters")
	}
	return title, nil
}

func validUUID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil && len(id) == 36
}

func (s *Service) List(ctx context.Context, userID string) ([]Art, error) {
	return s.repo.List(ctx, userID)
}

// Create saves a piece to the user's gallery. A remix must come from a piece the
// user can see: their own, or one in someone's (public) showcase.
func (s *Service) Create(ctx context.Context, userID string, req CreateRequest) (*Art, error) {
	title, err := cleanTitle(req.Title)
	if err != nil {
		return nil, err
	}
	doc, err := Validate(req.Doc)
	if err != nil {
		return nil, err
	}

	var remixOf, remixAuthor *string
	if req.RemixOf != nil {
		if !validUUID(*req.RemixOf) {
			return nil, badRequest("invalid remix source")
		}
		src, err := s.repo.Get(ctx, *req.RemixOf)
		if err != nil {
			return nil, err
		}
		if src.OwnerID != userID && src.ShowcasePosition == nil {
			return nil, fiber.NewError(fiber.StatusNotFound, "pixel art not found")
		}
		remixOf = &src.ID
		if src.OwnerID != userID {
			remixAuthor = &src.OwnerID
		} else if src.RemixAuthor != nil {
			// Remixing your own remix keeps the original credit.
			remixAuthor = &src.RemixAuthor.ID
		}
	}
	return s.repo.Create(ctx, userID, title, doc, remixOf, remixAuthor)
}

func (s *Service) Update(ctx context.Context, userID, id string, req UpdateRequest) (*Art, error) {
	if !validUUID(id) {
		return nil, badRequest("invalid id")
	}
	var title *string
	if req.Title != nil {
		t, err := cleanTitle(*req.Title)
		if err != nil {
			return nil, err
		}
		title = &t
	}
	var doc json.RawMessage
	if len(req.Doc) > 0 && string(req.Doc) != "null" {
		v, err := Validate(req.Doc)
		if err != nil {
			return nil, err
		}
		doc = v
	}
	a, err := s.repo.Update(ctx, userID, id, title, doc)
	if err != nil {
		return nil, err
	}
	// Showcased pieces and buddies are public; let viewers refresh.
	s.changed(userID)
	return a, nil
}

func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if !validUUID(id) {
		return badRequest("invalid id")
	}
	if err := s.repo.Delete(ctx, userID, id); err != nil {
		return err
	}
	s.changed(userID)
	return nil
}

func (s *Service) SetShowcase(ctx context.Context, userID string, req ShowcaseRequest) error {
	if len(req.IDs) > MaxShowcase {
		return badRequest("a showcase holds at most 15 pieces")
	}
	seen := map[string]bool{}
	for _, id := range req.IDs {
		if !validUUID(id) {
			return badRequest("invalid id")
		}
		if seen[id] {
			return badRequest("a piece can appear in the showcase only once")
		}
		seen[id] = true
	}
	if err := s.repo.SetShowcase(ctx, userID, req.IDs); err != nil {
		return err
	}
	s.changed(userID)
	return nil
}

func (s *Service) SetBuddies(ctx context.Context, userID string, req BuddiesRequest) error {
	if len(req.Buddies) > MaxBuddies {
		return badRequest("a profile holds at most 5 buddies")
	}
	for _, b := range req.Buddies {
		if !validUUID(b.ArtID) {
			return badRequest("invalid id")
		}
		if b.X < 0 || b.X > 100 || b.Y < 0 || b.Y > MaxBuddyY || b.Height < MinBuddyHeight || b.Height > MaxBuddyHeight {
			return badRequest("invalid buddy placement")
		}
	}
	if err := s.repo.SetBuddies(ctx, userID, req.Buddies); err != nil {
		return err
	}
	s.changed(userID)
	return nil
}

// SetBanner sets a built-in scene or a banner-shaped drawing as the profile banner.
func (s *Service) SetBanner(ctx context.Context, userID string, req Banner) error {
	hasDoc := len(req.Doc) > 0 && string(req.Doc) != "null"
	if (req.Builtin != nil) == hasDoc {
		return badRequest("choose either a built-in banner or your own drawing")
	}
	var doc json.RawMessage
	if req.Builtin != nil {
		if !BuiltinBanners[*req.Builtin] {
			return badRequest("unknown banner")
		}
	} else {
		v, err := Validate(req.Doc)
		if err != nil {
			return err
		}
		var dims struct {
			Width  int `json:"width"`
			Height int `json:"height"`
		}
		if err := json.Unmarshal(v, &dims); err != nil || !bannerSizes[[2]int{dims.Width, dims.Height}] {
			return badRequest("banners must be 100 × 32 or 150 × 48")
		}
		doc = v
	}
	if err := s.repo.SetBanner(ctx, userID, req.Builtin, doc); err != nil {
		return err
	}
	s.changed(userID)
	return nil
}

func (s *Service) DeleteBanner(ctx context.Context, userID string) error {
	if err := s.repo.DeleteBanner(ctx, userID); err != nil {
		return err
	}
	s.changed(userID)
	return nil
}

// Profile is public to any signed-in user, like the profile itself.
func (s *Service) Profile(ctx context.Context, userID string) (*Profile, error) {
	if !validUUID(userID) {
		return nil, badRequest("invalid user id")
	}
	exists, err := s.repo.UserExists(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fiber.NewError(fiber.StatusNotFound, "user not found")
	}
	return s.repo.Profile(ctx, userID)
}
