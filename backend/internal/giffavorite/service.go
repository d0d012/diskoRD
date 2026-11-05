package giffavorite

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const MaxFavorites = 500

var ErrFull = errors.New("GIF favorites full")
var slugPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)

type Favorite struct {
	Slug      string    `json:"slug"`
	Width     *int      `json:"width"`
	Height    *int      `json:"height"`
	CreatedAt time.Time `json:"createdAt"`
}
type Dimensions struct {
	Width  *int `json:"width"`
	Height *int `json:"height"`
}
type Cursor struct {
	CreatedAt time.Time
	Slug      string
}
type Page struct {
	Items      []Favorite `json:"items"`
	HasMore    bool       `json:"hasMore"`
	NextCursor string     `json:"nextCursor,omitempty"`
}
type FavoriteRepository interface {
	List(context.Context, string, *Cursor, int) ([]Favorite, error)
	Put(context.Context, string, string, Dimensions) error
	Delete(context.Context, string, string) error
}
type Service struct{ repo FavoriteRepository }

func NewService(repo FavoriteRepository) *Service { return &Service{repo: repo} }
func (s *Service) List(ctx context.Context, userID, cursor string, limit int) (*Page, error) {
	if limit < 1 || limit > 100 {
		return nil, fiber.NewError(400, "limit must be between 1 and 100")
	}
	var after *Cursor
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		parts := strings.SplitN(string(raw), "|", 2)
		if err != nil || len(parts) != 2 || !slugPattern.MatchString(parts[1]) {
			return nil, fiber.NewError(400, "invalid cursor")
		}
		t, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			return nil, fiber.NewError(400, "invalid cursor")
		}
		after = &Cursor{t, parts[1]}
	}
	items, err := s.repo.List(ctx, userID, after, limit+1)
	if err != nil {
		return nil, fmt.Errorf("giffavorite.Service.List: %w", err)
	}
	if items == nil {
		items = []Favorite{}
	}
	page := &Page{Items: items, HasMore: len(items) > limit}
	if page.HasMore {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.CreatedAt.Format(time.RFC3339Nano) + "|" + last.Slug))
	}
	return page, nil
}
func (s *Service) Put(ctx context.Context, userID, slug string, d Dimensions) error {
	if !slugPattern.MatchString(slug) {
		return fiber.NewError(400, "invalid GIF slug")
	}
	for _, n := range []*int{d.Width, d.Height} {
		if n != nil && (*n < 1 || *n > 10000) {
			return fiber.NewError(400, "GIF dimensions must be between 1 and 10000")
		}
	}
	if err := s.repo.Put(ctx, userID, slug, d); err != nil {
		if errors.Is(err, ErrFull) {
			return fiber.NewError(409, "You can save up to 500 GIF favorites. Remove one first.")
		}
		return fmt.Errorf("giffavorite.Service.Put: %w", err)
	}
	return nil
}
func (s *Service) Delete(ctx context.Context, userID, slug string) error {
	if !slugPattern.MatchString(slug) {
		return fiber.NewError(400, "invalid GIF slug")
	}
	if err := s.repo.Delete(ctx, userID, slug); err != nil {
		return fmt.Errorf("giffavorite.Service.Delete: %w", err)
	}
	return nil
}
