package channel

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler) {
	guilds := app.Group("/guilds", authMiddleware)
	guilds.Post("/:id/channels", h.CreateChannel)
	guilds.Get("/:id/channels", h.ListChannels)

	channels := app.Group("/channels", authMiddleware)
	channels.Patch("/:id", h.UpdateChannel)
	channels.Delete("/:id", h.DeleteChannel)
}
