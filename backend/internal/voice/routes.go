package voice

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Post("/channels/:id/voice/token", authMw, h.JoinVoice)
	app.Delete("/channels/:id/voice/leave", authMw, h.LeaveVoice)
	app.Post("/channels/:id/voice/viewer", authMw, h.ViewerToken)
}
