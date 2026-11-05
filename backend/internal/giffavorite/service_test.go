package giffavorite

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type mockRepo struct{ mock.Mock }

func (m *mockRepo) List(ctx context.Context, user string, cursor *Cursor, limit int) ([]Favorite, error) {
	a := m.Called(ctx, user, cursor, limit)
	f, _ := a.Get(0).([]Favorite)
	return f, a.Error(1)
}
func (m *mockRepo) Put(ctx context.Context, user, slug string, d Dimensions) error {
	return m.Called(ctx, user, slug, d).Error(0)
}
func (m *mockRepo) Delete(ctx context.Context, user, slug string) error {
	return m.Called(ctx, user, slug).Error(0)
}
func TestPagination(t *testing.T) {
	r := &mockRepo{}
	s := NewService(r)
	now := time.Now().UTC()
	r.On("List", mock.Anything, "me", (*Cursor)(nil), 3).Return([]Favorite{{Slug: "z", CreatedAt: now}, {Slug: "y", CreatedAt: now}, {Slug: "x", CreatedAt: now}}, nil).Once()
	page, err := s.List(context.Background(), "me", "", 2)
	require.NoError(t, err)
	assert.True(t, page.HasMore)
	assert.Len(t, page.Items, 2)
	assert.NotEmpty(t, page.NextCursor)
	r.On("List", mock.Anything, "me", mock.MatchedBy(func(c *Cursor) bool { return c.Slug == "y" && c.CreatedAt.Equal(now) }), 3).Return([]Favorite{{Slug: "x", CreatedAt: now}}, nil).Once()
	page, err = s.List(context.Background(), "me", page.NextCursor, 2)
	require.NoError(t, err)
	assert.False(t, page.HasMore)
	assert.Empty(t, page.NextCursor)
	r.AssertExpectations(t)
}
func TestValidation(t *testing.T) {
	r := &mockRepo{}
	s := NewService(r)
	for _, slug := range []string{"", "a/b", "space here", strings.Repeat("x", 201), "日本"} {
		assert.Error(t, s.Put(context.Background(), "me", slug, Dimensions{}))
		assert.Error(t, s.Delete(context.Background(), "me", slug))
	}
	zero := 0
	assert.Error(t, s.Put(context.Background(), "me", "good", Dimensions{Width: &zero}))
	_, err := s.List(context.Background(), "me", "invalid", 100)
	assert.Error(t, err)
	for _, n := range []int{0, 101} {
		_, err := s.List(context.Background(), "me", "", n)
		assert.Error(t, err)
	}
	r.AssertNotCalled(t, "Put", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
func TestPutCapAndIdempotence(t *testing.T) {
	r := &mockRepo{}
	s := NewService(r)
	r.On("Put", mock.Anything, "me", "full", Dimensions{}).Return(ErrFull)
	err := s.Put(context.Background(), "me", "full", Dimensions{})
	var fe *fiber.Error
	require.ErrorAs(t, err, &fe)
	assert.Equal(t, 409, fe.Code)
	assert.Contains(t, fe.Message, "500")
	r.On("Put", mock.Anything, "me", "existing", Dimensions{}).Return(nil).Twice()
	require.NoError(t, s.Put(context.Background(), "me", "existing", Dimensions{}))
	require.NoError(t, s.Put(context.Background(), "me", "existing", Dimensions{}))
	r.On("Delete", mock.Anything, "me", "existing").Return(nil)
	require.NoError(t, s.Delete(context.Background(), "me", "existing"))
	r.AssertExpectations(t)
}
func TestInternalErrorsWrapped(t *testing.T) {
	r := &mockRepo{}
	s := NewService(r)
	failure := errors.New("database unavailable")
	r.On("Put", mock.Anything, "me", "ok", Dimensions{}).Return(failure)
	err := s.Put(context.Background(), "me", "ok", Dimensions{})
	assert.ErrorIs(t, err, failure)
	assert.Contains(t, err.Error(), "giffavorite.Service.Put")
}
func TestHandlerRoutes(t *testing.T) {
	r := &mockRepo{}
	app := fiber.New()
	h := NewHandler(NewService(r))
	RegisterRoutes(app, h, func(c *fiber.Ctx) error {
		if c.Get("Authorization") == "" {
			return fiber.NewError(401, "unauthorized")
		}
		c.Locals("userID", "me")
		return c.Next()
	})
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		path := "/users/me/gif-favorites"
		if method != "GET" {
			path += "/slug"
		}
		resp, err := app.Test(httptest.NewRequest(method, path, nil))
		require.NoError(t, err)
		assert.Equal(t, 401, resp.StatusCode)
		resp.Body.Close()
	}
	r.On("List", mock.Anything, "me", (*Cursor)(nil), 101).Return([]Favorite{}, nil)
	req := httptest.NewRequest("GET", "/users/me/gif-favorites", nil)
	req.Header.Set("Authorization", "test")
	resp, err := app.Test(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, 200, resp.StatusCode)
	var payload struct {
		Data Page `json:"data"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&payload))
	assert.NotNil(t, payload.Data.Items)
	assert.False(t, payload.Data.HasMore)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{{"PUT", "/users/me/gif-favorites/slug", `{"width":120,"height":80}`, 200}, {"PUT", "/users/me/gif-favorites/slug", `not json`, 400}, {"DELETE", "/users/me/gif-favorites/slug", "", 200}, {"DELETE", "/users/me/gif-favorites/bad!", "", 400}} {
		if tc.method == "PUT" && tc.status == 200 {
			w, h := 120, 80
			r.On("Put", mock.Anything, "me", "slug", Dimensions{Width: &w, Height: &h}).Return(nil)
		}
		if tc.method == "DELETE" && tc.status == 200 {
			r.On("Delete", mock.Anything, "me", "slug").Return(nil)
		}
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Authorization", "test")
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		require.NoError(t, err)
		assert.Equal(t, tc.status, resp.StatusCode)
		resp.Body.Close()
	}
	r.AssertExpectations(t)
}
