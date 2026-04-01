package gateway

import (
	"context"
	"encoding/json"
	"sync/atomic"

	fiberws "github.com/gofiber/websocket/v2"
	"github.com/rs/zerolog/log"

	"github.com/d0d012/diskord/internal/auth"
)

// Handler upgrades HTTP connections to WebSocket and wires up clients.
type Handler struct {
	hub         *Hub
	authService *auth.Service
}

func NewHandler(hub *Hub, authService *auth.Service) *Handler {
	return &Handler{hub: hub, authService: authService}
}

// ServeWS is the WebSocket handler. The authMw upstream must have already
// validated the token and stored userID in Locals, OR the token is passed
// as a query param for WS connections that can't set headers.
func (h *Handler) ServeWS(c *fiberws.Conn) {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		// Fallback: token passed as query param
		token := c.Query("token")
		if token == "" {
			c.WriteMessage(fiberws.CloseMessage, fiberws.FormatCloseMessage(4001, "unauthorized"))
			return
		}
		claims, err := h.authService.ValidateAccessToken(token)
		if err != nil {
			c.WriteMessage(fiberws.CloseMessage, fiberws.FormatCloseMessage(4001, "unauthorized"))
			return
		}
		sub, _ := claims.GetSubject()
		userID = sub
	}

	guilds, err := h.hub.loadUserGuilds(context.Background(), userID)
	if err != nil {
		log.Error().Err(err).Str("userID", userID).Msg("gateway: load user guilds")
		guilds = make(map[string]bool)
	}

	client := &Client{
		hub:    h.hub,
		conn:   c,
		send:   make(chan []byte, 256),
		userID: userID,
		guilds: guilds,
	}

	h.hub.register <- client

	// Send HELLO event with heartbeat interval
	seq := atomic.LoadInt64(&h.hub.seq)
	hello, _ := json.Marshal(Event{
		Op: OpHello,
		D:  mustMarshal(map[string]int{"heartbeatInterval": 30000}),
		S:  seq,
	})
	client.send <- hello

	// Send READY event with current presence and voice state snapshot
	h.hub.sendReadyEvent(context.Background(), client)

	go client.WritePump()
	client.ReadPump() // blocks until connection closes
}

func mustMarshal(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
