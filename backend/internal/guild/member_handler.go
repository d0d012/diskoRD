package guild

import "github.com/gofiber/fiber/v2"

func (h *Handler) ListMembers(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.ListMembers(c.Context(), userID, guildID)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) KickMember(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	targetID := c.Params("userId")
	if targetID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "user id is required")
	}

	callerID := c.Locals("userID").(string)

	if err := h.service.KickMember(c.Context(), callerID, guildID, targetID); err != nil {
		return err
	}

	return c.JSON(Response{Data: "member kicked"})
}
