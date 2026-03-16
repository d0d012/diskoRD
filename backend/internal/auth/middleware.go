package auth

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

func AuthMiddleware(svc *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "missing authorization header")
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid authorization format")
		}

		claims, err := svc.ValidateAccessToken(parts[1])
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid or expired token")
		}

		c.Locals("userID", claims["sub"])
		c.Locals("username", claims["username"])
		return c.Next()
	}
}
