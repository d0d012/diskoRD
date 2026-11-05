package giffavorite

import "github.com/gofiber/fiber/v2"

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }
func (h *Handler) List(c *fiber.Ctx) error {
	page, err := h.svc.List(c.Context(), c.Locals("userID").(string), c.Query("cursor"), c.QueryInt("limit", 100))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": page})
}
func (h *Handler) Put(c *fiber.Ctx) error {
	var d Dimensions
	if err := c.BodyParser(&d); err != nil {
		return fiber.NewError(400, "invalid request body")
	}
	if err := h.svc.Put(c.Context(), c.Locals("userID").(string), c.Params("slug"), d); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}
func (h *Handler) Delete(c *fiber.Ctx) error {
	if err := h.svc.Delete(c.Context(), c.Locals("userID").(string), c.Params("slug")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"data": "ok"})
}
func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Get("/users/me/gif-favorites", authMw, h.List)
	app.Put("/users/me/gif-favorites/:slug", authMw, h.Put)
	app.Delete("/users/me/gif-favorites/:slug", authMw, h.Delete)
}
