package user

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware, uploadLimit fiber.Handler) {
	users := app.Group("/users", authMiddleware)
	users.Get("/search", h.SearchByUsername)
	users.Get("/me/guilds", func(c *fiber.Ctx) error { return c.Next() }) // handled by guild package
	// /users/me/... must stay before /users/:id.
	users.Patch("/me", h.UpdateProfile)
	users.Post("/me/avatar", uploadLimit, h.UploadAvatar)
	users.Delete("/me/avatar", h.DeleteAvatar)
	users.Put("/me/presence", h.SetPresence)
	users.Get("/:id", h.GetProfile)
}
