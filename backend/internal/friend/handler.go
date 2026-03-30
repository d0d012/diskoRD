package friend

import "github.com/gofiber/fiber/v2"

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) SendRequest(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)
	targetID := c.Params("id")

	req, err := h.svc.SendRequest(c.Context(), callerID, targetID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(Response{Data: req})
}

func (h *Handler) AcceptRequest(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)
	friendshipID := c.Params("id")

	if err := h.svc.AcceptRequest(c.Context(), callerID, friendshipID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "ok"})
}

func (h *Handler) DeclineRequest(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)
	friendshipID := c.Params("id")

	if err := h.svc.DeclineRequest(c.Context(), callerID, friendshipID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "ok"})
}

func (h *Handler) RemoveFriend(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)
	friendshipID := c.Params("id")

	if err := h.svc.RemoveFriend(c.Context(), callerID, friendshipID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "ok"})
}

func (h *Handler) ListFriends(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)

	friends, err := h.svc.ListFriends(c.Context(), callerID)
	if err != nil {
		return err
	}
	if friends == nil {
		friends = []FriendResponse{}
	}
	return c.JSON(Response{Data: friends})
}

func (h *Handler) ListRequests(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)

	reqs, err := h.svc.ListRequests(c.Context(), callerID)
	if err != nil {
		return err
	}
	if reqs == nil {
		reqs = []FriendRequestResponse{}
	}
	return c.JSON(Response{Data: reqs})
}

func (h *Handler) OpenDM(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)
	targetID := c.Params("userId")

	dm, err := h.svc.OpenDM(c.Context(), callerID, targetID)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(Response{Data: dm})
}

func (h *Handler) ListDMs(c *fiber.Ctx) error {
	callerID := c.Locals("userID").(string)

	dms, err := h.svc.ListDMs(c.Context(), callerID)
	if err != nil {
		return err
	}
	if dms == nil {
		dms = []DMChannelResponse{}
	}
	return c.JSON(Response{Data: dms})
}
