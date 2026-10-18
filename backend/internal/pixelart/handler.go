package pixelart

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func userID(c *fiber.Ctx) string {
	return c.Locals("userID").(string)
}

func (h *Handler) List(c *fiber.Ctx) error {
	arts, err := h.svc.List(c.Context(), userID(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": arts})
}

func (h *Handler) Create(c *fiber.Ctx) error {
	var req CreateRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	a, err := h.svc.Create(c.Context(), userID(c), req)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": a})
}

func (h *Handler) Update(c *fiber.Ctx) error {
	var req UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	a, err := h.svc.Update(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": a})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), userID(c), c.Params("id")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) SetShowcase(c *fiber.Ctx) error {
	var req ShowcaseRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.svc.SetShowcase(c.Context(), userID(c), req); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) SetBuddies(c *fiber.Ctx) error {
	var req BuddiesRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.svc.SetBuddies(c.Context(), userID(c), req); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) Profile(c *fiber.Ctx) error {
	p, err := h.svc.Profile(c.Context(), c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": p})
}
