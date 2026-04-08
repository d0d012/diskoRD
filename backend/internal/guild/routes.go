package guild

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/d0d012/diskord/pkg/middleware"
)

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler, db *pgxpool.Pool) {
	guilds := app.Group("/guilds", authMiddleware)
	guilds.Post("/", h.CreateGuild)
	guilds.Get("/:id", h.GetGuild)
	guilds.Delete("/:id", h.DeleteGuild)
	guilds.Get("/:id/members", h.ListMembers)
	guilds.Delete("/:id/members/:userId", middleware.RequireRole(db, "moderator"), h.KickMember)
	guilds.Patch("/:id/members/:userId/role", middleware.RequireRole(db, "admin"), h.UpdateMemberRole)

	app.Get("/users/me/guilds", authMiddleware, h.ListMyGuilds)
}
