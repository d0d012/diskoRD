package message

import (
	"github.com/gofiber/fiber/v2"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Post("/channels/:id/ack", authMw, h.Ack)
	app.Post("/dms/:id/ack", authMw, h.Ack)
	app.Post("/channels/:id/messages", authMw, h.Send)
	app.Post("/channels/:id/upload", authMw, h.Upload)
	app.Get("/channels/:id/messages", authMw, h.List)
	app.Patch("/messages/:id", authMw, h.Edit)
	app.Delete("/messages/:id", authMw, h.Delete)
}
