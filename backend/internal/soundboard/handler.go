package soundboard

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }
func (h *Handler) List(c *fiber.Ctx) error {
	sounds, err := h.service.List(c.Context(), c.Locals("userID").(string), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": sounds})
}
func (h *Handler) Create(c *fiber.Ctx) error {
	// Base64 adds 4/3 overhead. Reject oversized JSON before allocating decoded media.
	if len(c.Body()) > MaxAudioBytes*4/3+1024 {
		return fiber.NewError(413, "sound upload is too large")
	}
	var req CreateRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(400, "invalid sound upload")
	}
	sound, err := h.service.Create(c.Context(), c.Locals("userID").(string), c.Params("id"), req)
	if err != nil {
		return err
	}
	return c.Status(201).JSON(fiber.Map{"data": sound})
}
func (h *Handler) Audio(c *fiber.Ctx) error {
	audio, err := h.service.Audio(c.Context(), c.Locals("userID").(string), c.Params("id"), c.Params("soundId"))
	if err != nil {
		return err
	}
	c.Set("Cache-Control", "private, no-store")
	return c.JSON(fiber.Map{"data": fiber.Map{"audio": audio}})
}
func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.service.Delete(c.Context(), c.Locals("userID").(string), c.Params("id"), c.Params("soundId")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "sound deleted"})
}
