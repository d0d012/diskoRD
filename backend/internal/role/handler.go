package role

import (
	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v2"
)

type Handler struct {
	service  *Service
	validate *validator.Validate
}

func NewHandler(svc *Service) *Handler {
	return &Handler{service: svc, validate: validator.New()}
}

func (h *Handler) ListRoles(c *fiber.Ctx) error {
	guildID := c.Params("id")
	callerID := c.Locals("userID").(string)
	roles, err := h.service.ListByGuild(c.Context(), callerID, guildID)
	if err != nil {
		return err
	}
	if roles == nil {
		roles = []RoleResponse{}
	}
	return c.JSON(Response{Data: roles})
}

func (h *Handler) CreateRole(c *fiber.Ctx) error {
	guildID := c.Params("id")
	callerID := c.Locals("userID").(string)

	var req CreateRoleRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "validation failed")
	}

	role, err := h.service.Create(c.Context(), callerID, guildID, req)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(Response{Data: role})
}

func (h *Handler) UpdateRole(c *fiber.Ctx) error {
	guildID := c.Params("id")
	roleID := c.Params("roleId")
	callerID := c.Locals("userID").(string)

	var req UpdateRoleRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "validation failed")
	}

	role, err := h.service.Update(c.Context(), callerID, guildID, roleID, req)
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: role})
}

func (h *Handler) DeleteRole(c *fiber.Ctx) error {
	guildID := c.Params("id")
	roleID := c.Params("roleId")
	callerID := c.Locals("userID").(string)

	if err := h.service.Delete(c.Context(), callerID, guildID, roleID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "role deleted"})
}

func (h *Handler) ReorderRoles(c *fiber.Ctx) error {
	guildID := c.Params("id")
	callerID := c.Locals("userID").(string)

	var req ReorderRequest
	if err := c.BodyParser(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := h.validate.Struct(req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "validation failed")
	}

	if err := h.service.Reorder(c.Context(), callerID, guildID, req); err != nil {
		return err
	}
	return c.JSON(Response{Data: "roles reordered"})
}

func (h *Handler) AssignRole(c *fiber.Ctx) error {
	guildID := c.Params("id")
	userID := c.Params("userId")
	roleID := c.Params("roleId")
	callerID := c.Locals("userID").(string)

	role, err := h.service.AssignToMember(c.Context(), callerID, guildID, userID, roleID)
	if err != nil {
		return err
	}
	return c.JSON(Response{Data: role})
}

func (h *Handler) RemoveRole(c *fiber.Ctx) error {
	guildID := c.Params("id")
	userID := c.Params("userId")
	roleID := c.Params("roleId")
	callerID := c.Locals("userID").(string)

	if err := h.service.RemoveFromMember(c.Context(), callerID, guildID, userID, roleID); err != nil {
		return err
	}
	return c.JSON(Response{Data: "role removed"})
}

func (h *Handler) GetMemberRoles(c *fiber.Ctx) error {
	guildID := c.Params("id")
	userID := c.Params("userId")
	callerID := c.Locals("userID").(string)

	roles, err := h.service.GetMemberRoles(c.Context(), callerID, guildID, userID)
	if err != nil {
		return err
	}
	if roles == nil {
		roles = []RoleResponse{}
	}
	return c.JSON(Response{Data: roles})
}

func (h *Handler) GetRoleMembers(c *fiber.Ctx) error {
	guildID := c.Params("id")
	roleID := c.Params("roleId")
	callerID := c.Locals("userID").(string)

	members, err := h.service.GetRoleMembers(c.Context(), callerID, guildID, roleID)
	if err != nil {
		return err
	}
	if members == nil {
		members = []struct {
			ID       string `json:"id"`
			Username string `json:"username"`
		}{}
	}
	return c.JSON(Response{Data: members})
}
