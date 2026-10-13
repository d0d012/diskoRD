package reaction

import (
	"net/url"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// decodeEmoji unescapes the emoji route param. Browsers percent-encode non-ASCII
// path segments, and Fiber does not unescape route params itself.
func decodeEmoji(raw string) (string, error) {
	emoji, err := url.PathUnescape(raw)
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid emoji")
	}
	return emoji, nil
}

func (h *Handler) Add(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")

	emoji, err := decodeEmoji(c.Params("emoji"))
	if err != nil {
		return err
	}

	if err := h.svc.AddReaction(c.Context(), userID, messageID, emoji); err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) Remove(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")

	emoji, err := decodeEmoji(c.Params("emoji"))
	if err != nil {
		return err
	}

	if err := h.svc.RemoveReaction(c.Context(), userID, messageID, emoji); err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": "ok"})
}
