package friend

import "github.com/gofiber/fiber/v2"

func RegisterRoutes(app *fiber.App, h *Handler, authMw fiber.Handler) {
	app.Post("/users/:id/friend-request", authMw, h.SendRequest)
	app.Post("/friend-requests/:id/accept", authMw, h.AcceptRequest)
	app.Post("/friend-requests/:id/decline", authMw, h.DeclineRequest)
	app.Delete("/friends/:id", authMw, h.RemoveFriend)
	app.Get("/users/me/friends", authMw, h.ListFriends)
	app.Get("/users/me/friend-requests", authMw, h.ListRequests)
	app.Post("/dms/:userId", authMw, h.OpenDM)
	app.Get("/users/me/dms", authMw, h.ListDMs)
}
