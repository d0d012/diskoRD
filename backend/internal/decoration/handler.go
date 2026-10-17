package decoration

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func validID(c *fiber.Ctx) error {
	if _, err := uuid.Parse(c.Params("id")); err != nil || len(c.Params("id")) != 36 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid id")
	}
	return c.Next()
}

func (h *Handler) Create(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	var req CreateRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	d, err := h.svc.Create(c.Context(), userID, c.Params("id"), req)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": d})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	if err := h.svc.Delete(c.Context(), userID, c.Params("id")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}
