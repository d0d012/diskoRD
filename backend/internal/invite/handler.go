package invite

import (
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateInvite(c *fiber.Ctx) error {
	guildID := c.Params("id")
	creatorID := c.Locals("userID").(string)

	var req CreateInviteRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}

	inv, err := h.service.CreateInvite(c.Context(), guildID, creatorID, req)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(Response{Data: inv.ToResponse()})
}

func (h *Handler) JoinGuild(c *fiber.Ctx) error {
	code := c.Params("code")
	userID := c.Locals("userID").(string)

	g, err := h.service.JoinGuild(c.Context(), code, userID)
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusOK).JSON(Response{Data: g.ToListItem()})
}
