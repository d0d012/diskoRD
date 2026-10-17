package decoration

import (
	"github.com/gofiber/fiber/v2"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMw, writeLimit fiber.Handler) {
	app.Post("/messages/:id/decorations", authMw, validID, writeLimit, h.Create)
	app.Delete("/decorations/:id", authMw, validID, writeLimit, h.Delete)
}
