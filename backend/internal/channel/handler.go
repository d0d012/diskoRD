package channel

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

func (h *Handler) CreateChannel(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	var req CreateChannelRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.Create(c.Context(), userID, guildID, req)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(Response{Data: result})
}

func (h *Handler) ListChannels(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.List(c.Context(), userID, guildID)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) UpdateChannel(c *fiber.Ctx) error {
	channelID := c.Params("id")
	if channelID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "channel id is required")
	}

	var req UpdateChannelRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	if req.Name == nil && req.Position == nil {
		return fiber.NewError(fiber.StatusBadRequest, "at least one field must be provided")
	}

	userID := c.Locals("userID").(string)

	result, err := h.service.Update(c.Context(), userID, channelID, req)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) DeleteChannel(c *fiber.Ctx) error {
	channelID := c.Params("id")
	if channelID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "channel id is required")
	}

	userID := c.Locals("userID").(string)

	if err := h.service.Delete(c.Context(), userID, channelID); err != nil {
		return err
	}

	return c.JSON(Response{Data: "channel deleted"})
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
			case "oneof":
				return fe.Field() + " must be one of: " + fe.Param()
			}
		}
	}
	return "validation failed"
}
