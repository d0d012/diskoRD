package message

import (
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v2"

	"github.com/d0d012/diskord/internal/storage"
)

var validate = validator.New()

type Handler struct {
	svc        *Service
	storageSvc *storage.Service
}

func (h *Handler) SetStorage(s *storage.Service) {
	h.storageSvc = s
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Send(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("id")

	var req CreateMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.(validator.ValidationErrors)[0].Translate(nil))
	}

	msg, err := h.svc.Send(c.Context(), userID, channelID, req)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": msg})
}

func (h *Handler) List(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("id")

	var beforeID *string
	if b := c.Query("before"); b != "" {
		beforeID = &b
	}

	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}

	page, err := h.svc.List(c.Context(), userID, channelID, beforeID, limit)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": page})
}

func (h *Handler) Edit(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")

	var req EditMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.(validator.ValidationErrors)[0].Translate(nil))
	}

	msg, err := h.svc.Edit(c.Context(), userID, messageID, req)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": msg})
}

func (h *Handler) Delete(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	messageID := c.Params("id")

	if err := h.svc.Delete(c.Context(), userID, messageID); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}

func (h *Handler) Upload(c *fiber.Ctx) error {
	if h.storageSvc == nil {
		return fiber.NewError(fiber.StatusNotImplemented, "storage not configured")
	}

	userID := c.Locals("userID").(string)
	channelID := c.Params("id")

	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "file is required")
	}
	if file.Size > storage.MaxFileSize {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "file exceeds 8MB limit")
	}

	mimeType := file.Header.Get("Content-Type")
	f, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to read file")
	}
	defer f.Close()

	// Create the message first to get an ID, then save file under that ID
	caption := c.FormValue("caption", "")
	msg, err := h.svc.Send(c.Context(), userID, channelID, CreateMessageRequest{Content: caption})
	if err != nil {
		return err
	}

	url, err := h.storageSvc.Save(mimeType, file.Filename, msg.ID, f)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	msg.Attachments = []string{url}

	// Re-publish the message with attachment
	h.svc.PublishWithAttachment(c.Context(), msg)

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"data": msg})
}
