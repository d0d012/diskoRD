package user

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler) {
	users := app.Group("/users", authMiddleware)
	users.Get("/:id", h.GetProfile)
	users.Patch("/me", h.UpdateProfile)
}
