package guild

import (
	"testing"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
)

func TestCreateGuildRequestValidation(t *testing.T) {
	v := validator.New()

	t.Run("valid request", func(t *testing.T) {
		req := CreateGuildRequest{Name: "My Guild"}
		assert.NoError(t, v.Struct(req))
	})

	t.Run("empty name rejected", func(t *testing.T) {
		req := CreateGuildRequest{Name: ""}
		assert.Error(t, v.Struct(req))
	})

	t.Run("name over 100 chars rejected", func(t *testing.T) {
		longName := ""
		for i := 0; i < 101; i++ {
			longName += "a"
		}
		req := CreateGuildRequest{Name: longName}
		assert.Error(t, v.Struct(req))
	})
}

func TestGuildToResponse(t *testing.T) {
	g := &Guild{
		ID:        "guild-1",
		Name:      "Test Guild",
		OwnerID:   "user-1",
		CreatedAt: time.Now(),
	}
	channels := []Channel{
		{ID: "ch-1", GuildID: "guild-1", Name: "general", Type: "text", Position: 0},
		{ID: "ch-2", GuildID: "guild-1", Name: "voice", Type: "voice", Position: 1},
	}

	resp := g.ToResponse(channels)

	assert.Equal(t, "guild-1", resp.ID)
	assert.Equal(t, "Test Guild", resp.Name)
	assert.Equal(t, "user-1", resp.OwnerID)
	assert.Len(t, resp.Channels, 2)
	assert.Equal(t, "general", resp.Channels[0].Name)
	assert.Equal(t, "text", resp.Channels[0].Type)
	assert.Equal(t, "voice", resp.Channels[1].Name)
}

func TestGuildToListItem(t *testing.T) {
	iconURL := "https://example.com/icon.png"
	g := &Guild{
		ID:      "guild-1",
		Name:    "Test Guild",
		IconURL: &iconURL,
		OwnerID: "user-1",
	}

	item := g.ToListItem()

	assert.Equal(t, "guild-1", item.ID)
	assert.Equal(t, "Test Guild", item.Name)
	assert.Equal(t, &iconURL, item.IconURL)
	assert.Equal(t, "user-1", item.OwnerID)
}

func TestFormatValidationError(t *testing.T) {
	v := validator.New()

	t.Run("required field", func(t *testing.T) {
		req := CreateGuildRequest{}
		err := v.Struct(req)
		msg := formatValidationError(err)
		assert.Contains(t, msg, "is required")
	})

	t.Run("too long", func(t *testing.T) {
		longName := ""
		for i := 0; i < 101; i++ {
			longName += "a"
		}
		req := CreateGuildRequest{Name: longName}
		err := v.Struct(req)
		msg := formatValidationError(err)
		assert.Contains(t, msg, "at most")
	})
}
