package user

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

func (h *Handler) SearchByUsername(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return fiber.NewError(fiber.StatusBadRequest, "username query param required")
	}
	result, err := h.service.FindByUsername(c.Context(), username)
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

	userID := c.Locals("userID").(string)

	result, err := h.service.UpdateProfile(c.Context(), userID, UpdateProfileParams{
		DisplayName: req.DisplayName,
		Bio:         req.Bio,
		BannerColor: req.BannerColor,
	})
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) UploadAvatar(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

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
		return fmt.Errorf("user.Handler.UploadAvatar: %w", err)
	}

	result, err := h.service.SetAvatar(c.Context(), userID, mimeType, src)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) DeleteAvatar(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

	result, err := h.service.RemoveAvatar(c.Context(), userID)
	if err != nil {
		return err
	}

	return c.JSON(Response{Data: result})
}

func (h *Handler) SetPresence(c *fiber.Ctx) error {
	var req SetPresenceRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}

	userID := c.Locals("userID").(string)

	if err := h.service.SetPreferredStatus(c.Context(), userID, req.Status); err != nil {
		return err
	}

	return c.JSON(Response{Data: fiber.Map{"status": req.Status}})
}
