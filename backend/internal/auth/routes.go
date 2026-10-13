package auth

import "github.com/gofiber/fiber/v2"

type RouteConfig struct {
	AuthMiddleware    fiber.Handler
	LoginRateLimit    fiber.Handler
	RegisterRateLimit fiber.Handler
}

func RegisterRoutes(app *fiber.App, h *Handler, cfg RouteConfig) {
	auth := app.Group("/auth")
	auth.Post("/register", cfg.RegisterRateLimit, h.Register)
	auth.Post("/login", cfg.LoginRateLimit, h.Login)
	auth.Post("/refresh", h.Refresh)
	auth.Post("/logout", cfg.AuthMiddleware, h.Logout)
}
