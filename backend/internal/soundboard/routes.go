package soundboard

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func RegisterRoutes(app *fiber.App, h *Handler, auth, uploadLimit fiber.Handler) {
	group := app.Group("/guilds/:id/sounds", auth, func(c *fiber.Ctx) error {
		if _, err := uuid.Parse(c.Params("id")); err != nil || len(c.Params("id")) != 36 {
			return fiber.NewError(fiber.StatusBadRequest, "invalid guild id")
		}
		return c.Next()
	})
	group.Get("/", h.List)
	group.Post("/", uploadLimit, h.Create)
	validateSoundID := func(c *fiber.Ctx) error {
		if _, err := uuid.Parse(c.Params("soundId")); err != nil || len(c.Params("soundId")) != 36 {
			return fiber.NewError(fiber.StatusBadRequest, "invalid sound id")
		}
		return c.Next()
	}
	group.Get("/:soundId", validateSoundID, h.Audio)
	group.Delete("/:soundId", validateSoundID, h.Delete)
}
