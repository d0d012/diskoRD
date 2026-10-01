package call

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Post("/dms/:channelId/call", authMw, h.Initiate)
	app.Post("/dms/:channelId/call/accept", authMw, h.Accept)
	app.Post("/dms/:channelId/call/decline", authMw, h.Decline)
	app.Post("/dms/:channelId/call/end", authMw, h.End)
	app.Post("/dms/:channelId/call/keepalive", authMw, h.Keepalive)
}
