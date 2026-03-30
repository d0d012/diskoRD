package invite

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler) {
	app.Post("/guilds/:id/invites", authMiddleware, h.CreateInvite)
	app.Post("/invites/:code/join", authMiddleware, h.JoinGuild)
}
