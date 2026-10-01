package call

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Initiate(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("channelId")
	if err := h.svc.Initiate(c.Context(), channelID, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

func (h *Handler) Accept(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("channelId")
	if err := h.svc.Accept(c.Context(), channelID, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

func (h *Handler) Decline(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("channelId")
	if err := h.svc.Decline(c.Context(), channelID, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

func (h *Handler) End(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("channelId")
	if err := h.svc.End(c.Context(), channelID, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}

func (h *Handler) Keepalive(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("channelId")
	if err := h.svc.Keepalive(c.Context(), channelID, userID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"ok": true}})
}
