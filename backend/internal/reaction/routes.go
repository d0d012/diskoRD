package reaction

import (
	"github.com/gofiber/fiber/v2"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Put("/messages/:id/reactions/:emoji", authMw, h.Add)
	app.Delete("/messages/:id/reactions/:emoji", authMw, h.Remove)
}
