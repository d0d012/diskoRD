package message

import (
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v2"
)

var validate = validator.New()

type Handler struct {
	svc *Service
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
