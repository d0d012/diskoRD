package reaction

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Add(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")
	emoji := c.Params("emoji")

	if emoji == "" {
		return fiber.NewError(fiber.StatusBadRequest, "emoji is required")
	}

	err := h.svc.AddReaction(c.Context(), userID, messageID, emoji)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) Remove(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")
	emoji := c.Params("emoji")

	if emoji == "" {
		return fiber.NewError(fiber.StatusBadRequest, "emoji is required")
	}

	err := h.svc.RemoveReaction(c.Context(), userID, messageID, emoji)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": "ok"})
}
