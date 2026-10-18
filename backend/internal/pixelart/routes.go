package pixelart

import (
	"github.com/gofiber/fiber/v2"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMw, writeLimit fiber.Handler) {
	app.Get("/users/me/pixel-arts", authMw, h.List)
	app.Post("/users/me/pixel-arts", authMw, writeLimit, h.Create)
	app.Patch("/users/me/pixel-arts/:id", authMw, writeLimit, h.Update)
	app.Delete("/users/me/pixel-arts/:id", authMw, writeLimit, h.Delete)
	app.Put("/users/me/showcase", authMw, writeLimit, h.SetShowcase)
	app.Put("/users/me/buddies", authMw, writeLimit, h.SetBuddies)
	app.Put("/users/me/banner", authMw, writeLimit, h.SetBanner)
	app.Delete("/users/me/banner", authMw, writeLimit, h.DeleteBanner)
	app.Get("/users/:id/pixel-profile", authMw, h.Profile)
}
