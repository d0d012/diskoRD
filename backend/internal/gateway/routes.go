package gateway

import (
	"github.com/gofiber/fiber/v2"
	fiberws "github.com/gofiber/websocket/v2"
)

// RegisterRoutes mounts the WebSocket gateway endpoint.
// authMw is optional — token can also be passed as ?token= query param.
func RegisterRoutes(app *fiber.App, h *Handler) {
	app.Use("/gateway", func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/gateway", fiberws.New(h.ServeWS))
}
