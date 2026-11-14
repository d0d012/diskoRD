package whiteboard

import "github.com/gofiber/fiber/v2"

// RegisterRoutes mounts the board endpoints. The ops limiter is per authenticated
// user across channels, not the IP + path key used by legacy rate middleware.
func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Get("/channels/:id/board", authMw, h.GetBoard)
	app.Post("/channels/:id/board/ops", authMw, newCommandLimiter().middleware, h.PostOps)
	app.Post("/channels/:id/board/assets", authMw, newUploadLimiter().middleware, h.PostAsset)
}
