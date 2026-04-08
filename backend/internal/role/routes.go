package role

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMiddleware fiber.Handler) {
	guilds := app.Group("/guilds", authMiddleware)
	guilds.Get("/:id/roles", h.ListRoles)
	guilds.Post("/:id/roles", h.CreateRole)
	guilds.Patch("/:id/roles/:roleId", h.UpdateRole)
	guilds.Delete("/:id/roles/:roleId", h.DeleteRole)
	guilds.Put("/:id/roles/reorder", h.ReorderRoles)
	guilds.Get("/:id/members/:userId/roles", h.GetMemberRoles)
	guilds.Put("/:id/members/:userId/roles/:roleId", h.AssignRole)
	guilds.Delete("/:id/members/:userId/roles/:roleId", h.RemoveRole)
	guilds.Get("/:id/roles/:roleId/members", h.GetRoleMembers)
}
