package voice

import "github.com/gofiber/fiber/v2"

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) JoinVoice(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("id")

	resp, err := h.svc.JoinVoice(c.Context(), userID, channelID)
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: resp})
}

func (h *Handler) ViewerToken(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	res, err := h.svc.ViewerToken(c.Context(), userID, c.Params("id"))
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: res})
}

func (h *Handler) LeaveVoice(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	channelID := c.Params("id")

	if err := h.svc.LeaveVoice(c.Context(), userID, channelID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "ok"})
}
