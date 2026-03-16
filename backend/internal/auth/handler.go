package auth

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

func (h *Handler) Register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	result, err := h.service.Register(c.Context(), req)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(Response{Data: result})
}

func (h *Handler) Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	result, err := h.service.Login(c.Context(), req)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) Refresh(c *fiber.Ctx) error {
	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	result, err := h.service.RefreshToken(c.Context(), req.RefreshToken)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) Logout(c *fiber.Ctx) error {
	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}

	if err := h.service.Logout(c.Context(), req.RefreshToken); err != nil {
		return err
	}

	return c.JSON(Response{Data: "logged out"})
}

func formatValidationError(err error) string {
	if ve, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range ve {
			switch fe.Tag() {
			case "required":
				return fe.Field() + " is required"
			case "email":
				return "invalid email format"
			case "min":
				return fe.Field() + " must be at least " + fe.Param() + " characters"
			case "max":
				return fe.Field() + " must be at most " + fe.Param() + " characters"
			case "alphanum":
				return fe.Field() + " must contain only letters and numbers"
			}
		}
	}
	return "validation failed"
}
