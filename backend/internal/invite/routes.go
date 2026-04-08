package invite

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/d0d012/diskord/pkg/middleware"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler, db *pgxpool.Pool) {
	app.Post("/guilds/:id/invites", authMiddleware, middleware.RequireRole(db, "moderator"), h.CreateInvite)
	app.Post("/invites/:code/join", authMiddleware, h.JoinGuild)
}
