package guild

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

func (h *Handler) CreateGuild(c *fiber.Ctx) error {
	var req CreateGuildRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.Create(c.Context(), userID, req)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(Response{Data: result})
}

func (h *Handler) GetGuild(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.Get(c.Context(), userID, guildID)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) DeleteGuild(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	userID := c.Locals("userID").(string)

	if err := h.service.Delete(c.Context(), userID, guildID); err != nil {
		return err
	}

	return c.JSON(Response{Data: "guild deleted"})
}

func (h *Handler) ListMyGuilds(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

	result, err := h.service.ListByUser(c.Context(), userID)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func formatValidationError(err error) string {
	if ve, ok := err.(validator.ValidationErrors); ok {
		for _, fe := range ve {
			switch fe.Tag() {
			case "required":
				return fe.Field() + " is required"
			case "min":
				return fe.Field() + " must be at least " + fe.Param() + " characters"
			case "max":
				return fe.Field() + " must be at most " + fe.Param() + " characters"
			}
		}
	}
	return "validation failed"
}
