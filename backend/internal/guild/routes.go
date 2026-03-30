package guild

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler) {
	guilds := app.Group("/guilds", authMiddleware)
	guilds.Post("/", h.CreateGuild)
	guilds.Get("/:id", h.GetGuild)
	guilds.Delete("/:id", h.DeleteGuild)
	guilds.Get("/:id/members", h.ListMembers)
	guilds.Delete("/:id/members/:userId", h.KickMember)

	app.Get("/users/me/guilds", authMiddleware, h.ListMyGuilds)
}
