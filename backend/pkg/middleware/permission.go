package middleware

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RoleLevel returns the numeric hierarchy level of a role.
// Higher number = more privileged.
func RoleLevel(role string) int {
	switch role {
	case "owner":
		return 4
	case "admin":
		return 3
	case "moderator":
		return 2
	case "member":
		return 1
	default:
		return 0
	}
}

// RequireRole returns a Fiber middleware that ensures the calling user has at
// least minRole within the guild identified by the ":id" route param.
// Must run after AuthMiddleware (which sets "userID" in Locals).
func RequireRole(db *pgxpool.Pool, minRole string) fiber.Handler {
	minLevel := RoleLevel(minRole)
	return func(c *fiber.Ctx) error {
		guildID := c.Params("id")
		if guildID == "" {
			return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
		}

		userID, ok := c.Locals("userID").(string)
		if !ok || userID == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}

		var role string
		err := db.QueryRow(
			context.Background(),
			`SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
			guildID, userID,
		).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return fiber.NewError(fiber.StatusForbidden, "not a member of this guild")
		}
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "failed to check permissions")
		}

		if RoleLevel(role) < minLevel {
			return fiber.NewError(fiber.StatusForbidden, "insufficient permissions")
		}

		c.Locals("callerRole", role)
		return c.Next()
	}
}
