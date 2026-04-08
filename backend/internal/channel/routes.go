package channel

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/d0d012/diskord/pkg/middleware"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler, db *pgxpool.Pool) {
	guilds := app.Group("/guilds", authMiddleware)
	guilds.Post("/:id/channels", middleware.RequireRole(db, "moderator"), h.CreateChannel)
	guilds.Get("/:id/channels", h.ListChannels)

	channels := app.Group("/channels", authMiddleware)
	channels.Patch("/:id", h.UpdateChannel)
	channels.Delete("/:id", h.DeleteChannel)
}
