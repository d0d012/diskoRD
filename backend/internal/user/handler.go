package user

import (
	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	service  *Service
	validate *validator.Validate
}

func NewHandler(service *Service) *Handler {
	return &Handler{
		service:  service,
		validate: validator.New(),
	}
}

func (h *Handler) GetProfile(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return fiber.NewError(fiber.StatusBadRequest, "user id is required")
	}

	result, err := h.service.GetProfile(c.Context(), id)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) UpdateProfile(c *fiber.Ctx) error {
	var req UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "validation failed")
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.UpdateProfile(c.Context(), userID, req)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}
