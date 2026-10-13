package guild

import (
	"errors"
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v2"

	"github.com/d0d012/diskord/internal/storage"
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

func (h *Handler) UpdateGuild(c *fiber.Ctx) error {
	guildID := c.Params("id")
	if guildID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "guild id is required")
	}

	var req UpdateGuildRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, formatValidationError(err))
	}

	userID := c.Locals("userID").(string)
	result, err := h.service.Update(c.Context(), userID, guildID, req)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) UploadIcon(c *fiber.Ctx) error {
	guildID := c.Params("id")
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "file is required")
	}
	if file.Size > storage.MaxFileSize {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "file exceeds 8MB limit")
	}

	src, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "could not read uploaded file")
	}
	defer src.Close()

	mimeType, err := storage.SniffImage(src)
	if errors.Is(err, storage.ErrUnsupportedImage) {
		return fiber.NewError(fiber.StatusBadRequest, "unsupported image type: PNG, JPEG, GIF or WebP only")
	}
	if err != nil {
		return fmt.Errorf("guild.Handler.UploadIcon: %w", err)
	}

	result, err := h.service.SetIcon(c.Context(), c.Locals("userID").(string), guildID, mimeType, src)
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: result})
}

func (h *Handler) DeleteIcon(c *fiber.Ctx) error {
	result, err := h.service.RemoveIcon(c.Context(), c.Locals("userID").(string), c.Params("id"))
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
			case "url":
				return fe.Field() + " must be a valid URL"
			}
		}
	}
	return "validation failed"
}
