package whiteboard

import (
	"errors"

	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func channelParam(c *fiber.Ctx) (string, error) {
	id := c.Params("id")
	if !isUUID(id) {
		return "", fiber.NewError(fiber.StatusBadRequest, "invalid channel id")
	}
	return id, nil
}

func (h *Handler) GetBoard(c *fiber.Ctx) error {
	channelID, err := channelParam(c)
	if err != nil {
		return err
	}
	userID := c.Locals("userID").(string)

	snap, err := h.svc.GetBoard(c.Context(), userID, channelID)
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: snap})
}

func (h *Handler) PostAsset(c *fiber.Ctx) error {
	channelID, err := channelParam(c)
	if err != nil {
		return err
	}
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "multipart file is required")
	}
	r, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "cannot read uploaded file")
	}
	defer r.Close()
	asset, err := h.svc.UploadAsset(c.Context(), c.Locals("userID").(string), channelID, r)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(Response{Data: asset})
}

func (h *Handler) PostOps(c *fiber.Ctx) error {
	channelID, err := channelParam(c)
	if err != nil {
		return err
	}

	var req CommandRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	userID := c.Locals("userID").(string)

	result, err := h.svc.Execute(c.Context(), userID, channelID, req)
	if err != nil {
		var ce *ConflictError
		if errors.As(err, &ce) {
			return c.Status(fiber.StatusConflict).JSON(ConflictResponse{
				Error: ce.Message, Code: ce.Code, Seq: ce.Seq, Current: ce.Current,
			})
		}
		return err
	}
	return c.JSON(Response{Data: result})
}
